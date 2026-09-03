import { db } from "../db";
import { normalizePhone } from "../utils/phone";
import { parseBrazilianDate, type Pericia } from "./parserService";

export type PericiaAgendadaStatus = "ativa" | "substituida";
export type PericiaAgendadaFonte = "whatsapp" | "trello_sync";

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
  fonte: PericiaAgendadaFonte;
  created_at: string;
}

/** Normaliza pra comparação: sem acento sensível a maiúscula/minúscula, espaços colapsados. */
function chave(valor: string | null | undefined): string {
  return (valor || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const insertStmt = db.prepare(
  `INSERT INTO pericias_agendadas
     (card_id, tipo, tipo_chave, origem, nome, nome_chave, telefone, telefone_digits, processo, processo_chave, data, horario, local, data_hora_ms, fonte, status)
   VALUES (@card_id, @tipo, @tipo_chave, @origem, @nome, @nome_chave, @telefone, @telefone_digits, @processo, @processo_chave, @data, @horario, @local, @data_hora_ms, @fonte, 'ativa')`
);
const deleteStmt = db.prepare("DELETE FROM pericias_agendadas WHERE id = ?");
const getStmt = db.prepare("SELECT * FROM pericias_agendadas WHERE id = ?");
const findDuplicadaStmt = db.prepare(
  `SELECT * FROM pericias_agendadas
   WHERE tipo_chave = ? AND nome_chave = ? AND data_hora_ms = ?
   ORDER BY CASE WHEN status = 'ativa' THEN 0 ELSE 1 END, id DESC LIMIT 1`
);
const mergeDuplicadaStmt = db.prepare(
  `UPDATE pericias_agendadas SET
     card_id = CASE WHEN @fonte = 'whatsapp' THEN @card_id ELSE card_id END,
     origem = CASE
       WHEN (origem IS NULL OR origem = '' OR origem = 'geral') AND @origem <> '' THEN @origem
       ELSE origem
     END,
     telefone = CASE WHEN telefone_digits = '' AND @telefone_digits <> '' THEN @telefone ELSE telefone END,
     telefone_digits = CASE WHEN telefone_digits = '' THEN @telefone_digits ELSE telefone_digits END,
     processo = CASE WHEN processo_chave = '' AND @processo_chave <> '' THEN @processo ELSE processo END,
     processo_chave = CASE WHEN processo_chave = '' THEN @processo_chave ELSE processo_chave END,
     local = CASE WHEN (local IS NULL OR local = '') AND @local <> '' THEN @local ELSE local END,
     fonte = CASE WHEN @fonte = 'whatsapp' THEN 'whatsapp' ELSE fonte END
   WHERE id = @id`
);
const findAtivasPorChaveStmt = db.prepare(
  `SELECT * FROM pericias_agendadas
   WHERE status = 'ativa' AND tipo_chave = ? AND nome_chave = ? AND telefone_digits = ? AND processo_chave = ?`
);
const findAtivasPorCardStmt = db.prepare(
  `SELECT * FROM pericias_agendadas
   WHERE status = 'ativa' AND card_id = ? AND tipo_chave = ? AND nome_chave = ?`
);
const supersedeStmt = db.prepare(
  `UPDATE pericias_agendadas SET status = 'substituida', substituida_por_id = ? WHERE id = ?`
);
const relinkSubstituidasStmt = db.prepare(
  "UPDATE pericias_agendadas SET substituida_por_id = ? WHERE substituida_por_id = ?"
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
export type ResultadoRegistroPericia =
  | { status: "criada"; pericia: PericiaAgendada }
  | { status: "duplicada"; pericia: PericiaAgendada }
  | { status: "data_invalida"; pericia: null };

/**
 * Versão detalhada do registro. Além de validar a data, torna a operação idempotente:
 * eventos com o mesmo tipo, cliente, data e horário são o mesmo compromisso, mesmo que
 * venham de cards/fontes diferentes ou tenham campos complementares distintos.
 */
export function registrarPericiaAgendadaComResultado(
  cardId: string,
  pericia: Pericia,
  fonte: PericiaAgendadaFonte = "whatsapp"
): ResultadoRegistroPericia {
  const dataHoraMs = parseBrazilianDate(pericia.data, pericia.horario);
  if (!Number.isFinite(dataHoraMs)) return { status: "data_invalida", pericia: null };

  const tipoChave = chave(pericia.tipo);
  const nomeChave = chave(pericia.nome);
  const telefoneDigits = normalizePhone(pericia.telefone);
  const processoChave = chave(pericia.processo);

  // A identidade do evento é o que o usuário enxerga no calendário. Card, fonte, processo,
  // telefone e local são dados complementares e não podem gerar uma segunda entrada.
  const duplicada = findDuplicadaStmt.get(tipoChave, nomeChave, dataHoraMs) as PericiaAgendada | undefined;
  if (duplicada) {
    // Aproveita uma nova fonte para completar campos que estavam vazios, sem substituir dados
    // já preenchidos. Um envio real por WhatsApp prevalece sobre a marca de importação manual.
    mergeDuplicadaStmt.run({
      id: duplicada.id,
      card_id: cardId,
      origem: pericia.origem || "",
      telefone: pericia.telefone || "",
      telefone_digits: telefoneDigits,
      processo: pericia.processo || "",
      processo_chave: processoChave,
      local: pericia.local || "",
      fonte,
    });
    return { status: "duplicada", pericia: getStmt.get(duplicada.id) as PericiaAgendada };
  }

  // Sem telefone e processo, restringe a busca de reagendamento ao mesmo card para não unir
  // por engano duas pessoas homônimas importadas de cartões diferentes.
  const anteriores = telefoneDigits || processoChave
    ? (findAtivasPorChaveStmt.all(tipoChave, nomeChave, telefoneDigits, processoChave) as PericiaAgendada[])
    : (findAtivasPorCardStmt.all(cardId, tipoChave, nomeChave) as PericiaAgendada[]);

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
    fonte,
  });
  const nova = getStmt.get(info.lastInsertRowid) as PericiaAgendada;

  for (const anterior of anteriores) {
    supersedeStmt.run(nova.id, anterior.id);
  }

  return { status: "criada", pericia: nova };
}

export function registrarPericiaAgendada(
  cardId: string,
  pericia: Pericia,
  fonte: PericiaAgendadaFonte = "whatsapp"
): PericiaAgendada | null {
  return registrarPericiaAgendadaComResultado(cardId, pericia, fonte).pericia;
}

/** Apaga em definitivo. Retorna false se o id não existia. */
export function deletePericiaAgendada(id: number): boolean {
  return db.transaction((registroId: number) => {
    const atual = getStmt.get(registroId) as PericiaAgendada | undefined;
    if (!atual) return false;

    // Entradas substituídas apontam para a mais nova por FK. Antes de apagar, redireciona
    // essas referências para o próximo evento da cadeia (ou limpa a referência), evitando
    // SQLITE_CONSTRAINT_FOREIGNKEY e preservando o histórico restante.
    relinkSubstituidasStmt.run(atual.substituida_por_id ?? null, registroId);
    return deleteStmt.run(registroId).changes > 0;
  })(id);
}

/** Todas as entradas (ativas e substituídas) — a tela decide o que mostrar por padrão. */
export function listPericiasAgendadas(): PericiaAgendada[] {
  return listStmt.all() as PericiaAgendada[];
}

export function getPericiaAgendada(id: number): PericiaAgendada | undefined {
  return getStmt.get(id) as PericiaAgendada | undefined;
}

/**
 * Remove entradas com mais de diasRetencao dias, independente do status — é só isso que evita
 * a lista crescer para sempre. Retorna quantas linhas foram apagadas.
 */
export function podarPericiasAgendadasAntigas(diasRetencao: number): number {
  const info = deleteAntigasStmt.run(diasRetencao);
  return info.changes;
}
