import { db } from "../db";
import { randomUUID } from "node:crypto";
import { normalizePhone } from "../utils/phone";
import { normalizeProcesso } from "../utils/processo";
import { parseBrazilianDate, type Pericia } from "./parserService";
import {
  scheduleGoogleCalendarDelete,
  scheduleGoogleCalendarSync,
  transferGoogleCalendarLinks,
} from "./googleCalendarService";

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
  whatsapp: string | null;
  profissional_perito: string | null;
  data_hora_ms: number;
  status: PericiaAgendadaStatus;
  substituida_por_id: number | null;
  fonte: PericiaAgendadaFonte;
  ultimo_lembrete_em: string | null;
  ultimo_lembrete_log_id: number | null;
  lembrete_ack: number | null;
  created_at: string;
}

export interface AtualizacaoPericiaAgendada {
  tipo: string;
  nome: string;
  telefone?: string | null;
  processo?: string | null;
  data: string;
  horario?: string | null;
  local?: string | null;
  whatsapp?: string | null;
  profissional_perito?: string | null;
}

export interface ResultadoAtualizacaoPericiaAgendada {
  pericia: PericiaAgendada;
  lembrete_resetado: boolean;
}

export interface RemarcacaoDetectada {
  agendamento_anterior_id: number;
  data_anterior: string;
  horario_anterior: string | null;
}

export class PericiaAgendadaInputError extends Error {}
export class PericiaAgendadaConflictError extends Error {}

/** Normaliza pra comparação: sem acento sensível a maiúscula/minúscula, espaços colapsados. */
function chave(valor: string | null | undefined): string {
  return (valor || "").trim().toLowerCase().replace(/\s+/g, " ");
}

const insertStmt = db.prepare(
  `INSERT INTO pericias_agendadas
     (card_id, tipo, tipo_chave, origem, nome, nome_chave, telefone, telefone_digits, processo, processo_chave, data, horario, local, whatsapp, profissional_perito, data_hora_ms, fonte, status)
   VALUES (@card_id, @tipo, @tipo_chave, @origem, @nome, @nome_chave, @telefone, @telefone_digits, @processo, @processo_chave, @data, @horario, @local, @whatsapp, @profissional_perito, @data_hora_ms, @fonte, 'ativa')`
);
const deleteStmt = db.prepare("DELETE FROM pericias_agendadas WHERE id = ?");
const SELECT_COM_LEMBRETE = `SELECT p.*, sl.ack AS lembrete_ack
  FROM pericias_agendadas p
  LEFT JOIN send_logs sl ON sl.id = p.ultimo_lembrete_log_id`;
const getStmt = db.prepare(`${SELECT_COM_LEMBRETE} WHERE p.id = ?`);
const findDuplicadaStmt = db.prepare(
  `SELECT * FROM pericias_agendadas
   WHERE tipo_chave = ? AND nome_chave = ? AND data_hora_ms = ?
   ORDER BY CASE WHEN status = 'ativa' THEN 0 ELSE 1 END, id DESC LIMIT 1`
);
const findDuplicadaAoEditarStmt = db.prepare(
  `SELECT id FROM pericias_agendadas
   WHERE id <> ? AND status = 'ativa' AND tipo_chave = ? AND nome_chave = ? AND data_hora_ms = ?
   LIMIT 1`
);
const findAtivaDuplicadaStmt = db.prepare(
  `SELECT id FROM pericias_agendadas
   WHERE status = 'ativa' AND tipo_chave = ? AND nome_chave = ? AND data_hora_ms = ?
   LIMIT 1`
);
const updateStmt = db.prepare(
  `UPDATE pericias_agendadas SET
     tipo = @tipo,
     tipo_chave = @tipo_chave,
     origem = @origem,
     nome = @nome,
     nome_chave = @nome_chave,
     telefone = @telefone,
     telefone_digits = @telefone_digits,
     processo = @processo,
     processo_chave = @processo_chave,
     data = @data,
     horario = @horario,
     local = @local,
     whatsapp = @whatsapp,
     profissional_perito = @profissional_perito,
     data_hora_ms = @data_hora_ms,
     ultimo_lembrete_em = CASE WHEN @resetar_lembrete = 1 THEN NULL ELSE ultimo_lembrete_em END,
     ultimo_lembrete_log_id = CASE WHEN @resetar_lembrete = 1 THEN NULL ELSE ultimo_lembrete_log_id END
   WHERE id = @id`
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
     whatsapp = CASE WHEN (whatsapp IS NULL OR whatsapp = '') AND @whatsapp <> '' THEN @whatsapp ELSE whatsapp END,
     profissional_perito = CASE
       WHEN (profissional_perito IS NULL OR profissional_perito = '') AND @profissional_perito <> '' THEN @profissional_perito
       ELSE profissional_perito
     END,
     fonte = CASE WHEN @fonte = 'whatsapp' THEN 'whatsapp' ELSE fonte END
   WHERE id = @id`
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
const listStmt = db.prepare(`${SELECT_COM_LEMBRETE} ORDER BY p.data_hora_ms ASC`);
const deleteAntigasStmt = db.prepare(
  `DELETE FROM pericias_agendadas
    WHERE data_hora_ms <= (strftime('%s','now')*1000 - ?*86400000)
      AND (status<>'ativa' OR origem='audiencia'
        OR EXISTS (SELECT 1 FROM djen_acompanhamentos_pericia a WHERE a.pericia_id=pericias_agendadas.id AND a.status='resolvido')
        OR EXISTS (SELECT 1 FROM djen_publicacoes p, json_each(p.categorias_json) c
          WHERE pericias_agendadas.processo_chave<>'' AND p.processo_chave=pericias_agendadas.processo_chave
            AND p.cancelada=0 AND c.value='laudo_juntado'
            AND date(p.data_disponibilizacao)>=date(pericias_agendadas.data_hora_ms/1000,'unixepoch')))`
);

const findAtivasDoMesmoTipoStmt = db.prepare(
  `SELECT * FROM pericias_agendadas
   WHERE status = 'ativa' AND tipo_chave = ? AND id <> ?`
);

function nomeComparavel(valor: string | null | undefined): string {
  return (valor || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * O processo é a identidade principal de uma remarcação. Telefone igual ou nome compatível
 * confirma que se trata do mesmo cliente, sem exigir que o nome venha idêntico (ex.: sobrenome
 * omitido na nova comunicação). Sem processo, mantemos os critérios conservadores anteriores.
 */
function encontrarAnterioresAtivos(params: {
  idAtual?: number;
  cardId: string;
  tipoChave: string;
  nomeChave: string;
  nome: string;
  telefoneDigits: string;
  processo: string | null | undefined;
}): PericiaAgendada[] {
  const idAtual = params.idAtual || 0;
  const processo = normalizeProcesso(params.processo);
  const nome = nomeComparavel(params.nome);
  const candidatas = findAtivasDoMesmoTipoStmt.all(params.tipoChave, idAtual) as PericiaAgendada[];

  return candidatas.filter((anterior) => {
    const mesmoProcesso = Boolean(processo && normalizeProcesso(anterior.processo) === processo);
    const mesmoTelefone = Boolean(
      params.telefoneDigits && anterior.telefone_digits && anterior.telefone_digits === params.telefoneDigits
    );
    const nomeAnterior = nomeComparavel(anterior.nome);
    const nomeCompativel = Boolean(nome && nomeAnterior && (nome.includes(nomeAnterior) || nomeAnterior.includes(nome)));

    if (mesmoProcesso && (mesmoTelefone || nomeCompativel)) return true;
    if (!processo && anterior.card_id === params.cardId) return true;
    return !processo && mesmoTelefone && chave(anterior.nome) === params.nomeChave;
  });
}

function substituirAnteriores(nova: PericiaAgendada, anteriores: PericiaAgendada[]): void {
  for (const anterior of anteriores) {
    supersedeStmt.run(nova.id, anterior.id);
    transferGoogleCalendarLinks(anterior.id, nova.id);
  }
}

/**
 * Identifica uma remarcação para a Dashboard sem alterar o calendário. A baixa do compromisso
 * anterior continua acontecendo apenas depois que o novo envio for confirmado pelo WhatsApp.
 */
export function detectarRemarcacao(cardId: string, pericia: Pericia): RemarcacaoDetectada | null {
  const dataHoraNova = parseBrazilianDate(pericia.data, pericia.horario);
  if (!Number.isFinite(dataHoraNova)) return null;

  const tipoChave = chave(pericia.tipo);
  const nomeChave = chave(pericia.nome);
  const telefoneDigits = normalizePhone(pericia.telefone);
  const processo = normalizeProcesso(pericia.processo);
  const candidatas = telefoneDigits || processo
    ? encontrarAnterioresAtivos({
        cardId,
        tipoChave,
        nomeChave,
        nome: pericia.nome,
        telefoneDigits,
        processo: pericia.processo,
      })
    : (findAtivasPorCardStmt.all(cardId, tipoChave, nomeChave) as PericiaAgendada[]);

  const anterior = candidatas
    .filter((item) => item.data_hora_ms !== dataHoraNova)
    .sort((a, b) => b.id - a.id)[0];
  if (!anterior) return null;

  return {
    agendamento_anterior_id: anterior.id,
    data_anterior: anterior.data,
    horario_anterior: anterior.horario,
  };
}

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
  | { status: "criada"; pericia: PericiaAgendada; substituidas?: { id: number; data: string; horario: string | null }[] }
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
  const processoChave = normalizeProcesso(pericia.processo);

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
      whatsapp: pericia.whatsapp || "",
      profissional_perito: pericia.profissionalPerito || "",
      fonte,
    });
    const periciaAtualizada = getStmt.get(duplicada.id) as PericiaAgendada;
    scheduleGoogleCalendarSync(periciaAtualizada.id);
    return { status: "duplicada", pericia: periciaAtualizada };
  }

  // Sem telefone e processo, restringe a busca de reagendamento ao mesmo card para não unir
  // por engano duas pessoas homônimas importadas de cartões diferentes.
  const anteriores = telefoneDigits || processoChave
    ? encontrarAnterioresAtivos({
        cardId,
        tipoChave,
        nomeChave,
        nome: pericia.nome,
        telefoneDigits,
        processo: pericia.processo,
      })
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
    whatsapp: pericia.whatsapp || null,
    profissional_perito: pericia.profissionalPerito || null,
    data_hora_ms: dataHoraMs,
    fonte,
  });
  const nova = getStmt.get(info.lastInsertRowid) as PericiaAgendada;

  substituirAnteriores(nova, anteriores);

  scheduleGoogleCalendarSync(nova.id);

  return { status: "criada", pericia: nova, ...(anteriores.length ? { substituidas: anteriores.map((a) => ({ id: a.id, data: a.data, horario: a.horario ?? null })) } : {}) };
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
  const apagou = db.transaction((registroId: number) => {
    const atual = getStmt.get(registroId) as PericiaAgendada | undefined;
    if (!atual) return false;

    // Entradas substituídas apontam para a mais nova por FK. Antes de apagar, redireciona
    // essas referências para o próximo evento da cadeia (ou limpa a referência), evitando
    // SQLITE_CONSTRAINT_FOREIGNKEY e preservando o histórico restante.
    relinkSubstituidasStmt.run(atual.substituida_por_id ?? null, registroId);
    return deleteStmt.run(registroId).changes > 0;
  })(id);
  if (apagou) scheduleGoogleCalendarDelete(id);
  return apagou;
}

/** Todas as entradas (ativas e substituídas) — a tela decide o que mostrar por padrão. */
export function listPericiasAgendadas(): PericiaAgendada[] {
  return listStmt.all() as PericiaAgendada[];
}

export function getPericiaAgendada(id: number): PericiaAgendada | undefined {
  return getStmt.get(id) as PericiaAgendada | undefined;
}

function textoLimpo(valor: string | null | undefined): string {
  return (valor || "").trim();
}

function dataValida(data: string): boolean {
  const match = data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return false;
  const dia = Number(match[1]);
  const mes = Number(match[2]);
  const ano = Number(match[3]);
  if (ano < 1900 || ano > 2200 || mes < 1 || mes > 12 || dia < 1) return false;
  return dia <= new Date(Date.UTC(ano, mes, 0)).getUTCDate();
}

function horarioValido(horario: string): boolean {
  return horario === "" || /^([01]\d|2[0-3]):[0-5]\d$/.test(horario);
}

function origemPeloTipo(tipo: string, origemAtual: string | null): string {
  const valor = tipo.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
  if (/AUDIENCIA|ONLINE|VIRTUAL|REMOT[AO]|VIDEO\s*CONFERENCIA|VIDEOCONFERENCIA|TELEPRESENCIAL|HIBRID[AO]|SEMIPRESENCIAL|MEET|TEAMS|ZOOM/.test(valor)) {
    return "audiencia";
  }
  if (/SOCIAL/.test(valor)) return "social";
  if (/MEDIC[AO]/.test(valor)) return "medica";
  if (valor.trim() === "PERICIA") return "geral";
  return origemAtual || "geral";
}

/** Cria um evento diretamente pelo calendário, sem depender de um cartão do Trello. */
export function createPericiaAgendadaManual(dados: AtualizacaoPericiaAgendada): PericiaAgendada {
  const tipo = textoLimpo(dados.tipo);
  const nome = textoLimpo(dados.nome);
  const telefone = textoLimpo(dados.telefone);
  const processo = textoLimpo(dados.processo);
  const data = textoLimpo(dados.data);
  const horario = textoLimpo(dados.horario);
  const local = textoLimpo(dados.local);
  const whatsapp = textoLimpo(dados.whatsapp);
  const profissionalPerito = textoLimpo(dados.profissional_perito);

  if (!tipo) throw new PericiaAgendadaInputError("Informe o tipo do evento.");
  if (!nome) throw new PericiaAgendadaInputError("Informe o nome do cliente.");
  if (!dataValida(data)) throw new PericiaAgendadaInputError("Informe uma data válida.");
  if (!horarioValido(horario)) throw new PericiaAgendadaInputError("Informe um horário válido.");

  const dataHoraMs = parseBrazilianDate(data, horario);
  if (!Number.isFinite(dataHoraMs)) throw new PericiaAgendadaInputError("Não foi possível reconhecer a data e o horário.");

  const tipoChave = chave(tipo);
  const nomeChave = chave(nome);
  const duplicada = findAtivaDuplicadaStmt.get(tipoChave, nomeChave, dataHoraMs) as { id: number } | undefined;
  if (duplicada) {
    throw new PericiaAgendadaConflictError("Já existe um evento idêntico para este cliente na mesma data e horário.");
  }

  const cardId = `manual:${randomUUID()}`;
  const anteriores = encontrarAnterioresAtivos({
    cardId,
    tipoChave,
    nomeChave,
    nome,
    telefoneDigits: normalizePhone(telefone),
    processo,
  });

  const info = insertStmt.run({
    card_id: cardId,
    tipo,
    tipo_chave: tipoChave,
    origem: origemPeloTipo(tipo, null),
    nome,
    nome_chave: nomeChave,
    telefone,
    telefone_digits: normalizePhone(telefone),
    processo: processo || null,
    processo_chave: normalizeProcesso(processo),
    data,
    horario: horario || null,
    local: local || null,
    whatsapp: whatsapp || null,
    profissional_perito: profissionalPerito || null,
    data_hora_ms: dataHoraMs,
    // A coluna fonte de bancos antigos aceita apenas estes dois valores. O prefixo manual:
    // em card_id identifica a criação direta sem exigir migração destrutiva da tabela.
    fonte: "whatsapp",
  });
  const criada = getStmt.get(info.lastInsertRowid) as PericiaAgendada;
  substituirAnteriores(criada, anteriores);
  scheduleGoogleCalendarSync(criada.id);
  return criada;
}

/** Atualiza um evento existente sem criar uma nova linha no calendário. */
export function updatePericiaAgendada(
  id: number,
  dados: AtualizacaoPericiaAgendada
): ResultadoAtualizacaoPericiaAgendada | undefined {
  const resultado = db.transaction(() => {
    const atual = getStmt.get(id) as PericiaAgendada | undefined;
    if (!atual) return undefined;

    const tipo = textoLimpo(dados.tipo);
    const nome = textoLimpo(dados.nome);
    const telefone = textoLimpo(dados.telefone);
    const processo = textoLimpo(dados.processo);
    const data = textoLimpo(dados.data);
    const horario = textoLimpo(dados.horario);
    const local = textoLimpo(dados.local);
    const whatsapp = textoLimpo(dados.whatsapp);
    const profissionalPerito = textoLimpo(dados.profissional_perito);

    if (!tipo) throw new PericiaAgendadaInputError("Informe o tipo do evento.");
    if (!nome) throw new PericiaAgendadaInputError("Informe o nome do cliente.");
    if (!dataValida(data)) throw new PericiaAgendadaInputError("Informe uma data válida.");
    if (!horarioValido(horario)) throw new PericiaAgendadaInputError("Informe um horário válido.");

    const dataHoraMs = parseBrazilianDate(data, horario);
    if (!Number.isFinite(dataHoraMs)) throw new PericiaAgendadaInputError("Não foi possível reconhecer a data e o horário.");

    const tipoChave = chave(tipo);
    const nomeChave = chave(nome);
    const telefoneDigits = normalizePhone(telefone);
    const processoChave = normalizeProcesso(processo);
    const identidadeMudou =
      tipoChave !== chave(atual.tipo) ||
      nomeChave !== chave(atual.nome) ||
      dataHoraMs !== atual.data_hora_ms;
    if (identidadeMudou) {
      const duplicada = findDuplicadaAoEditarStmt.get(id, tipoChave, nomeChave, dataHoraMs) as { id: number } | undefined;
      if (duplicada) {
        throw new PericiaAgendadaConflictError("Já existe um evento idêntico para este cliente na mesma data e horário.");
      }
    }

    const mudouConteudo =
      tipo !== atual.tipo ||
      nome !== atual.nome ||
      telefone !== (atual.telefone || "") ||
      processo !== (atual.processo || "") ||
      data !== atual.data ||
      horario !== (atual.horario || "") ||
      local !== (atual.local || "") ||
      whatsapp !== (atual.whatsapp || "") ||
      profissionalPerito !== (atual.profissional_perito || "");
    const lembreteResetado = mudouConteudo && Boolean(atual.ultimo_lembrete_em);

    updateStmt.run({
      id,
      tipo,
      tipo_chave: tipoChave,
      origem: origemPeloTipo(tipo, atual.origem),
      nome,
      nome_chave: nomeChave,
      telefone,
      telefone_digits: telefoneDigits,
      processo: processo || null,
      processo_chave: processoChave,
      data,
      horario: horario || null,
      local: local || null,
      whatsapp: whatsapp || null,
      profissional_perito: profissionalPerito || null,
      data_hora_ms: dataHoraMs,
      resetar_lembrete: lembreteResetado ? 1 : 0,
    });

    return {
      pericia: getStmt.get(id) as PericiaAgendada,
      lembrete_resetado: lembreteResetado,
    };
  })();
  if (resultado) {
    const atual = resultado.pericia;
    const anteriores = encontrarAnterioresAtivos({
      idAtual: atual.id,
      cardId: atual.card_id,
      tipoChave: chave(atual.tipo),
      nomeChave: chave(atual.nome),
      nome: atual.nome,
      telefoneDigits: atual.telefone_digits,
      processo: atual.processo,
    });
    substituirAnteriores(atual, anteriores);
    scheduleGoogleCalendarSync(atual.id);
  }
  return resultado;
}

/**
 * Corrige registros antigos que permaneceram simultaneamente ativos porque uma remarcação veio
 * com o nome abreviado. Executada na inicialização; é idempotente e só consolida processo, tipo
 * e telefone iguais. O registro mais recente é mantido como ativo.
 */
export function reconciliarRemarcacoesAntigas(): number {
  const ativas = db.prepare(
    `SELECT * FROM pericias_agendadas
     WHERE status = 'ativa' AND processo IS NOT NULL AND processo <> '' AND telefone_digits <> ''
     ORDER BY id ASC`
  ).all() as PericiaAgendada[];
  const grupos = new Map<string, PericiaAgendada[]>();

  for (const pericia of ativas) {
    const processo = normalizeProcesso(pericia.processo);
    if (!processo) continue;
    const key = `${chave(pericia.tipo)}|${processo}|${pericia.telefone_digits}`;
    const grupo = grupos.get(key) || [];
    grupo.push(pericia);
    grupos.set(key, grupo);
  }

  let substituidas = 0;
  for (const grupo of grupos.values()) {
    if (grupo.length < 2) continue;
    const nova = grupo.reduce((maisRecente, atual) => atual.id > maisRecente.id ? atual : maisRecente);
    const anteriores = grupo.filter((item) => item.id !== nova.id);
    substituirAnteriores(nova, anteriores);
    scheduleGoogleCalendarSync(nova.id);
    substituidas += anteriores.length;
  }
  return substituidas;
}

export function marcarLembreteEnviado(ids: number[], logId: number): void {
  const idsUnicos = Array.from(new Set(ids.filter((id) => Number.isInteger(id) && id > 0)));
  if (idsUnicos.length === 0) return;
  const placeholders = idsUnicos.map(() => "?").join(",");
  db.prepare(
    `UPDATE pericias_agendadas
     SET ultimo_lembrete_em = CURRENT_TIMESTAMP, ultimo_lembrete_log_id = ?
     WHERE id IN (${placeholders})`
  ).run(logId, ...idsUnicos);
}

/**
 * Limpa eventos antigos pela data de realização, preservando os ativos sem laudo
 * ou sem processo e acompanhamentos não resolvidos. Nunca remove agendamentos futuros.
 */
export function podarPericiasAgendadasAntigas(diasRetencao: number): number {
  const info = deleteAntigasStmt.run(diasRetencao);
  return info.changes;
}

