import { dadosDoCumprimento, descricaoCumprimento } from "./fulfillment";
import { coberturaHistorico } from "./historyCoverage";
import { instrucaoSuperada, laudoEfetivamenteJuntado, periciaSuperada } from "./followUpPolicy";
import { db } from "../../db";
import { normalizeProcesso } from "../../utils/processo";
import { parseBrazilianDate, type Pericia } from "../parserService";
import { registrarPericiaAgendadaComResultado } from "../periciasAgendadasService";
import { registrarHistoricoDjen } from "./history";
import { DjenInputError } from "./store";

type StatusControle =
  | "nao_cadastrada"
  | "cadastrada_nao_informada"
  | "duplicidade"
  | "redesignacao"
  | "cadastrada_a_conferir"
  | "dados_incompletos";

interface AnaliseAgendamento {
  agendamento?: {
    data?: string | null;
    horario?: string | null;
    local?: string | null;
  };
}

const canon = (value: string | null | undefined) =>
  (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const MESES: Record<string, number> = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12,
};

function dataPadrao(value: string | null) {
  if (!value) return null;
  const numerica = value.match(/\b(\d{1,2})\s*[/.\-]\s*(\d{1,2})\s*[/.\-]\s*(\d{4})\b/);
  if (numerica)
    return `${numerica[1].padStart(2, "0")}/${numerica[2].padStart(2, "0")}/${numerica[3]}`;
  const extensa = canon(value).match(
    /\b(\d{1,2})\s+de\s+(janeiro|fevereiro|marco|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)(?:\s*,?\s*de)?\s+(\d{4})\b/,
  );
  if (!extensa) return null;
  return `${extensa[1].padStart(2, "0")}/${String(MESES[extensa[2]]).padStart(2, "0")}/${extensa[3]}`;
}

function horarioPadrao(value: string | null) {
  if (!value) return null;
  const match = canon(value).match(/\b(\d{1,2})\s*(?::|h|horas?)\s*(\d{0,2})/);
  if (!match) return null;
  const hora = Number(match[1]);
  const minuto = Number(match[2] || 0);
  if (hora > 23 || minuto > 59) return null;
  return `${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}`;
}

function dataHoraAgendamento(data: string | null, horario: string | null) {
  const d = dataPadrao(data);
  const h = horarioPadrao(horario);
  return d && h ? parseBrazilianDate(d, h) : Number.NaN;
}

function publicacao(id: number) {
  return db
    .prepare(
      `SELECT p.id,p.processo_chave,p.categorias_json,p.ia_json,p.texto,
              pr.numero AS processo,pr.cliente_id,c.nome AS cliente_nome,c.telefone
         FROM djen_publicacoes p
         JOIN djen_processos pr ON pr.chave=p.processo_chave
         LEFT JOIN contacts c ON c.id=pr.cliente_id
        WHERE p.id=?`,
    )
    .get(id) as
    | {
        id: number;
        processo_chave: string;
        processo: string;
        categorias_json: string;
        ia_json: string | null;
        texto: string;
        cliente_id: number | null;
        cliente_nome: string | null;
        telefone: string | null;
      }
    | undefined;
}

function agendamentoDaPublicacao(p: NonNullable<ReturnType<typeof publicacao>>) {
  let analise: AnaliseAgendamento = {};
  try {
    analise = p.ia_json ? JSON.parse(p.ia_json) : {};
  } catch {
    analise = {};
  }
  return {
    data: analise.agendamento?.data?.trim() || null,
    horario: analise.agendamento?.horario?.trim() || null,
    local: analise.agendamento?.local?.trim() || null,
  };
}

export function statusControlePericia(publicacaoId: number) {
  const p = publicacao(publicacaoId);
  if (!p) throw new DjenInputError("Publicação não encontrada.");
  const categorias = JSON.parse(p.categorias_json || "[]") as string[];
  if (!categorias.includes("pericia")) return null;

  const agendamento = agendamentoDaPublicacao(p);
  const dataHoraMs = dataHoraAgendamento(
    agendamento.data,
    agendamento.horario,
  );
  if (!Number.isFinite(dataHoraMs))
    return {
      status: "dados_incompletos" as StatusControle,
      informado: false,
      agendamento,
      mensagem: "A publicação não contém data e horário válidos para conferência no controle de perícias.",
    };

  const processoChave = normalizeProcesso(p.processo);
  const candidatas = processoChave
    ? (db
        .prepare(
          `SELECT * FROM pericias_agendadas
            WHERE processo_chave=?
            ORDER BY CASE WHEN status='ativa' THEN 0 ELSE 1 END,id DESC`,
        )
        .all(processoChave) as {
        id: number;
        nome: string;
        data: string;
        horario: string | null;
        local: string | null;
        data_hora_ms: number;
        status: string;
        fonte: string;
        ultimo_lembrete_em: string | null;
        ultimo_lembrete_log_id: number | null;
      }[])
    : [];

  const mesmoHorario = candidatas.find((item) => item.data_hora_ms === dataHoraMs);
  const localConfere =
    mesmoHorario &&
    Boolean(
      agendamento.local &&
        mesmoHorario.local &&
        canon(agendamento.local) === canon(mesmoHorario.local),
    );
  const informado = Boolean(
    mesmoHorario &&
      (mesmoHorario.fonte === "whatsapp" ||
        mesmoHorario.ultimo_lembrete_em ||
        mesmoHorario.ultimo_lembrete_log_id),
  );

  let status: StatusControle = "nao_cadastrada";
  let mensagem = "Ainda não consta no controle de perícias.";
  if (mesmoHorario && localConfere && informado) {
    status = "duplicidade";
    mensagem = "Já consta no calendário e o cliente já foi informado com a mesma data, horário e local.";
  } else if (mesmoHorario && !agendamento.local) {
    status = "cadastrada_a_conferir";
    mensagem = "A data e o horário já constam no calendário, mas o local não veio nesta publicação.";
  } else if (mesmoHorario) {
    status = "cadastrada_nao_informada";
    mensagem = informado
      ? "Data e horário coincidem, mas o local precisa ser conferido."
      : "Já consta no calendário, mas não há confirmação de que o cliente foi informado.";
  } else if (candidatas.some((item) => item.status === "ativa")) {
    status = "redesignacao";
    mensagem = "Existe outra perícia ativa para este processo. A publicação indica possível redesignação.";
  }

  return {
    status,
    informado,
    agendamento,
    mensagem,
    existente: mesmoHorario || candidatas.find((item) => item.status === "ativa") || null,
  };
}

export function adicionarPublicacaoAoControle(publicacaoId: number) {
  const p = publicacao(publicacaoId);
  if (!p) throw new DjenInputError("Publicação não encontrada.");
  const categorias = JSON.parse(p.categorias_json || "[]") as string[];
  if (!categorias.includes("pericia"))
    throw new DjenInputError("A publicação precisa estar classificada como perícia agendada.");
  if (!p.cliente_id || !p.cliente_nome)
    throw new DjenInputError("Vincule o cliente antes de adicionar a perícia ao controle.");

  const agendamento = agendamentoDaPublicacao(p);
  if (!agendamento.data || !agendamento.horario)
    throw new DjenInputError("A publicação não contém data e horário válidos.");

  const tipo = /per[ií]cia\s+social/i.test(p.texto)
    ? "Perícia social"
    : "Perícia médica";
  const data = dataPadrao(agendamento.data);
  const horario = horarioPadrao(agendamento.horario);
  if (!data || !horario)
    throw new DjenInputError("Não foi possível reconhecer a data e o horário da perícia.");
  const dados: Pericia = {
    tipo,
    data,
    horario,
    local: agendamento.local || "",
    nome: p.cliente_nome,
    telefone: p.telefone || "",
    processo: p.processo,
    origem: tipo === "Perícia social" ? "social" : "medica",
  };
  const resultado = registrarPericiaAgendadaComResultado(
    `djen:${publicacaoId}`,
    dados,
    "trello_sync",
  );
  if (resultado.status === "data_invalida")
    throw new DjenInputError("Não foi possível reconhecer a data e o horário da perícia.");

  registrarHistoricoDjen(
    publicacaoId,
    "pericia",
    resultado.status === "duplicada"
      ? "Perícia conferida no controle existente; nenhuma cópia foi criada."
      : "Perícia adicionada ao controle de perícias por ação do usuário.",
  );
  return {
    resultado: resultado.status,
    pericia: resultado.pericia,
    controle: statusControlePericia(publicacaoId),
  };
}

export function listarPericiasSemLaudo(diasAposPericia = 60) {
  const dias = Math.max(60, Math.min(180, Math.trunc(diasAposPericia) || 60));
  const candidatas = db
    .prepare(
      `SELECT pa.processo_chave,pa.origem,(SELECT COUNT(*) FROM pericias_agendadas outra WHERE outra.processo_chave=pa.processo_chave AND outra.status='ativa' AND COALESCE(outra.origem,'')<>'audiencia') AS ativas_no_processo,pa.id AS pericia_id,pa.nome,pa.processo,pa.data,pa.horario,pa.local,
              pa.data_hora_ms,pa.ultimo_lembrete_em,pr.cliente_id,c.telefone,
              COALESCE(ac.status,'pendente') AS acompanhamento_status,
              ac.ultima_cobranca_em,ac.observacoes,
              CAST((strftime('%s','now')*1000-pa.data_hora_ms)/86400000 AS INTEGER) AS dias_decorridos
         FROM pericias_agendadas pa
         LEFT JOIN djen_processos pr ON pr.chave=pa.processo_chave
         LEFT JOIN contacts c ON c.id=pr.cliente_id
         LEFT JOIN djen_acompanhamentos_pericia ac ON ac.pericia_id=pa.id
        WHERE pa.status='ativa'
          AND COALESCE(pa.origem,'')<>'audiencia'
          AND pa.processo_chave<>''
          AND pa.data_hora_ms <= (strftime('%s','now')*1000 - ?*86400000)
          AND COALESCE(ac.status,'pendente')<>'resolvido'
        ORDER BY pa.data_hora_ms ASC`,
    )
    .all(dias) as { processo_chave: string; data_hora_ms: number; [key: string]: unknown }[];
  if (!candidatas.length) return [];
  const porProcesso = new Map<string, { texto: string; data: string }[]>();
  const publicacoes = db.prepare(`SELECT processo_chave,texto,data_disponibilizacao FROM djen_publicacoes
    WHERE cancelada=0 ORDER BY data_disponibilizacao DESC,id DESC`).all() as { processo_chave: string; texto: string; data_disponibilizacao: string }[];
  const processos = new Set(candidatas.map(p => p.processo_chave));
  for (const p of publicacoes) if (processos.has(p.processo_chave)) {
    const lista = porProcesso.get(p.processo_chave) || [];
    lista.push({ texto: p.texto, data: p.data_disponibilizacao.slice(0,10) });
    porProcesso.set(p.processo_chave, lista);
  }
  return candidatas.filter(p => {
    const data = new Date(p.data_hora_ms).toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
    const posteriores = (porProcesso.get(p.processo_chave) || []).filter(pub => pub.data >= data).map(pub => pub.texto);
    // Supressão do alerta obsoleto; não altera a perícia nem afirma que houve laudo.
    return !instrucaoSuperada(posteriores) && !posteriores.some(laudoEfetivamenteJuntado) && !periciaSuperada(posteriores,data,String(p.origem || ""),Number(p.ativas_no_processo));
  }).map(p => ({ ...p, historico_djen: coberturaHistorico(p.processo_chave) }));
}

export function atualizarAcompanhamentoPericia(
  periciaId: number,
  data: Record<string, unknown>,
) {
  const status = String(data.status || "");
  if (!["pendente", "cobrado", "resolvido"].includes(status))
    throw new DjenInputError("Situação de acompanhamento inválida.");
  const existe = db.prepare("SELECT id FROM pericias_agendadas WHERE id=?").get(periciaId);
  if (!existe) throw new DjenInputError("Perícia não encontrada.");
  const confirmado = status === "resolvido" ? dadosDoCumprimento(data) : null;
  const observacoes = confirmado ? descricaoCumprimento(confirmado) :
    typeof data.observacoes === "string" ? data.observacoes.trim().slice(0, 2000) : "";
  db.prepare(
    `INSERT INTO djen_acompanhamentos_pericia(pericia_id,status,ultima_cobranca_em,observacoes,updated_at)
     VALUES (?,?,CASE WHEN ?='cobrado' THEN CURRENT_TIMESTAMP ELSE NULL END,?,CURRENT_TIMESTAMP)
     ON CONFLICT(pericia_id) DO UPDATE SET
       status=excluded.status,
       ultima_cobranca_em=CASE WHEN excluded.status='cobrado' THEN CURRENT_TIMESTAMP ELSE djen_acompanhamentos_pericia.ultima_cobranca_em END,
       observacoes=excluded.observacoes,
       updated_at=CURRENT_TIMESTAMP`,
  ).run(periciaId, status, status, observacoes);
  const pub = db.prepare(`SELECT p.id FROM djen_publicacoes p JOIN pericias_agendadas pa ON pa.processo_chave=p.processo_chave
    WHERE pa.id=? AND p.cancelada=0 ORDER BY p.data_disponibilizacao DESC,p.id DESC LIMIT 1`).get(periciaId) as { id: number } | undefined;
  if (pub) registrarHistoricoDjen(pub.id, "providencia", confirmado ? descricaoCumprimento(confirmado) : status === "cobrado" ? "Cobrança de laudo marcada como realizada; nenhum envio automático." : `Acompanhamento da perícia ${status} pelo usuário.`, { periciaId, status, observacoes, ...confirmado });
  return { ok: true };
}




