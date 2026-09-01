import { db } from "../db";
import { normalizePhone } from "../utils/phone";
import { parseBrazilianDate, type Pericia } from "./parserService";

export type PericiaAgendadaStatus = "ativa" | "substituida";

export interface PericiaAgendada {
  id: number;
  card_id: string;
  tipo: string;
  origem: string | null;
  nome: string;
  telefone: string;
  telefone_digits: string;
  processo: string | null;
  data: string;
  horario: string | null;
  local: string | null;
  data_hora_ms: number;
  status: PericiaAgendadaStatus;
  substituida_por_id: number | null;
  created_at: string;
}

/** Normaliza pra comparação: sem acento sensível a maiúscula/minúscula, espaços colapsados. */
function chave(valor: string | null | undefined): string {
  return (valor || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const insertStmt = db.prepare(
  `INSERT INTO pericias_agendadas
     (card_id, tipo, tipo_chave, origem, nome, nome_chave, telefone, telefone_digits, processo, processo_chave, data, horario, local, data_hora_ms, status)
   VALUES (@card_id, @tipo, @tipo_chave, @origem, @nome, @nome_chave, @telefone, @telefone_digits, @processo, @processo_chave, @data, @horario, @local, @data_hora_ms, 'ativa')`
);
const getStmt = db.prepare("SELECT * FROM pericias_agendadas WHERE id = ?");
const findAtivasPorChaveStmt = db.prepare(
  `SELECT * FROM pericias_agendadas
   WHERE status = 'ativa' AND tipo_chave = ? AND nome_chave = ? AND telefone_digits = ? AND processo_chave = ?`
);
const supersedeStmt = db.prepare(
  `UPDATE pericias_agendadas SET status = 'substituida', substituida_por_id = ? WHERE id = ?`
);
const listStmt = db.prepare("SELECT * FROM pericias_agendadas ORDER BY data_hora_ms ASC");
const deleteAntigasStmt = db.prepare(
  `DELETE FROM pericias_agendadas WHERE created_at <= datetime('now', '-' || ? || ' days')`
);

/**
 * Registra uma perícia como "agendada e comunicada ao cliente" (chamado só após o envio de
 * WhatsApp ter dado certo — é isso que torna esse calendário confiável para dizer o que foi
 * de fato informado, diferente do board do Trello, que só reflete o estado atual do card).
 *
 * Se já existir uma entrada "ativa" com o mesmo tipo+nome+telefone+processo, ela é marcada
 * como "substituida" (mesmo padrão usado em pending_replies para reenvio ao mesmo telefone):
 * a mais nova é o reagendamento que valeu.
 *
 * Retorna null quando a data/horário da perícia não pôde ser reconhecida — sem uma data válida
 * não há como posicionar a perícia no calendário, então essa entrada é simplesmente ignorada.
 */
export function registrarPericiaAgendada(cardId: string, pericia: Pericia): PericiaAgendada | null {
  const dataHoraMs = parseBrazilianDate(pericia.data, pericia.horario);
  if (!Number.isFinite(dataHoraMs)) return null;

  const tipoChave = chave(pericia.tipo);
  const nomeChave = chave(pericia.nome);
  const telefoneDigits = normalizePhone(pericia.telefone);
  const processoChave = chave(pericia.processo);

  const anteriores = findAtivasPorChaveStmt.all(tipoChave, nomeChave, telefoneDigits, processoChave) as PericiaAgendada[];

  const info = insertStmt.run({
    card_id: cardId,
    tipo: pericia.tipo,
    tipo_chave: tipoChave,
    origem: pericia.origem ?? null,
    nome: pericia.nome,
    nome_chave: nomeChave,
    telefone: pericia.telefone,
    telefone_digits: telefoneDigits,
    processo: pericia.processo || null,
    processo_chave: processoChave,
    data: pericia.data,
    horario: pericia.horario || null,
    local: pericia.local || null,
    data_hora_ms: dataHoraMs,
  });
  const nova = getStmt.get(info.lastInsertRowid) as PericiaAgendada;

  for (const anterior of anteriores) {
    supersedeStmt.run(nova.id, anterior.id);
  }

  return nova;
}

/** Todas as entradas (ativas e substituídas) — a tela decide o que mostrar por padrão. */
export function listPericiasAgendadas(): PericiaAgendada[] {
  return listStmt.all() as PericiaAgendada[];
}

/**
 * Remove entradas com mais de diasRetencao dias, independente do status — é só isso que evita
 * a lista crescer para sempre. Retorna quantas linhas foram apagadas.
 */
export function podarPericiasAgendadasAntigas(diasRetencao: number): number {
  const info = deleteAntigasStmt.run(diasRetencao);
  return info.changes;
}
