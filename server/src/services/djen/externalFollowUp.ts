import { dadosDoCumprimento, descricaoCumprimento, chaveDaOrdem } from "./fulfillment";
import { coberturaHistorico, type CoberturaHistorico } from "./historyCoverage";
import { instrucaoSuperada } from "./followUpPolicy";
import { prazoDoAcompanhamento, type PrazoAcompanhamento } from "./followUpDeadline";
import { registrarHistoricoDjen } from "./history";
import { db } from "../../db";
import { DjenInputError } from "./store";
import { cumprimentoIdentificado, identificarObrigacoesExternas, TIPOS_OBRIGACAO, type TipoObrigacao } from "./obligations";

const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const diasDesde = (data: string) =>
  Math.floor((Date.parse(`${hoje()}T12:00:00Z`) - Date.parse(`${data.slice(0, 10)}T12:00:00Z`)) / 86400000);

export interface ObrigacaoExternaAcompanhamento extends PrazoAcompanhamento {
  historico_djen: CoberturaHistorico; captured_at: string;
  publicacao_id: number; tipo: TipoObrigacao; responsavel: string; processo: string;
  cliente_nome: string | null; data_disponibilizacao: string; dias_decorridos: number;
  dias_espera: number | null; prazo_citado_dias: number | null; motivo: string; resumo: string;
  acompanhamento_status: string; ultima_cobranca_em: string | null;
}

/** Lembretes operacionais: a ausência de prova no DJEN não comprova descumprimento nos autos. */
function* calcularObrigacoesExternas(): Generator<void, ObrigacaoExternaAcompanhamento[], void> {
  const config = db.prepare("SELECT aguardo_dias FROM djen_config WHERE id=1").get() as { aguardo_dias: number };
  const rows = db.prepare(
    `SELECT p.id,p.captured_at,p.tribunal,p.orgao,p.processo_chave,p.data_disponibilizacao,p.texto,p.situacao,p.ia_json,
            pr.numero AS processo,c.nome AS cliente_nome
       FROM djen_publicacoes p JOIN djen_processos pr ON pr.chave=p.processo_chave
       LEFT JOIN contacts c ON c.id=pr.cliente_id
      WHERE p.cancelada=0
      ORDER BY p.processo_chave,p.data_disponibilizacao DESC,p.id DESC`,
  ).all() as {
    id: number; captured_at: string; tribunal: string; orgao: string; processo_chave: string; data_disponibilizacao: string; texto: string;
    situacao: string; ia_json: string | null; processo: string; cliente_nome: string | null;
  }[];
  const estados = new Map(
    (db.prepare("SELECT publicacao_id,tipo,status,ultima_cobranca_em FROM djen_acompanhamentos_obrigacoes").all() as {
      publicacao_id: number; tipo: string; status: string; ultima_cobranca_em: string | null;
    }[]).map((r) => [`${r.publicacao_id}:${r.tipo}`, r] as const),
  );
  const cumpridos = new Map<string, string>();
  const conferencias = db.prepare(`SELECT p.processo_chave,h.dados_json FROM djen_historico h
    JOIN djen_publicacoes p ON p.id=h.publicacao_id WHERE h.tipo='providencia' AND json_valid(h.dados_json)
    AND json_extract(h.dados_json,'$.cumprido_em') IS NOT NULL`).all() as { processo_chave: string; dados_json: string }[];
  for (const h of conferencias) {
    const d = JSON.parse(h.dados_json) as { tipo?: string; ordem_chave?: string; cumprido_em?: string };
    if (!d.tipo || !d.ordem_chave || !d.cumprido_em) continue;
    const chave = `${h.processo_chave}:${d.tipo}:${d.ordem_chave}`;
    if (d.cumprido_em > (cumpridos.get(chave) || '')) cumpridos.set(chave,d.cumprido_em);
  }
  const posteriores = new Map<string, string[]>();
  const acompanhados = new Set<string>();
  const saida: ObrigacaoExternaAcompanhamento[] = [];
  for (const row of rows) {
    const textosPosteriores = posteriores.get(row.processo_chave) || [];
    for (const ordem of identificarObrigacoesExternas(row.texto)) {
      const chave = `${row.processo_chave}:${ordem.tipo}:${ordem.trecho.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim()}`;
      if (acompanhados.has(chave)) continue;
      acompanhados.add(chave); // Reiteração idêntica reinicia; ordens diferentes seguem separadas.
      // Repetição histórica capturada depois da conferência não reabre a mesma ordem.
      // Uma nova ordem publicada após o cumprimento continua sendo acompanhada.
      const cumpridoEm = cumpridos.get(`${row.processo_chave}:${ordem.tipo}:${chaveDaOrdem(ordem.trecho)}`);
      if (cumpridoEm && cumpridoEm >= row.data_disponibilizacao.slice(0,10)) continue;
      const prazo = prazoDoAcompanhamento(ordem, row, config.aguardo_dias, hoje());
      const dias_decorridos = diasDesde(row.data_disponibilizacao);
      if (!prazo.exibir) continue;
      // Sentença supera a instrução anterior, mas não comprova implantação de benefício.
      if (ordem.tipo !== "inss_implantacao" && instrucaoSuperada(textosPosteriores)) continue;
      if (textosPosteriores.some((texto) => cumprimentoIdentificado(ordem.tipo, texto, ordem.trecho))) continue;
      const estado = estados.get(`${row.id}:${ordem.tipo}`);
      if (estado?.status === "resolvido") continue;
      let resumo = row.situacao || ordem.trecho;
      try {
        const ia = row.ia_json ? JSON.parse(row.ia_json) : null;
        if (typeof ia?.resumo === "string") resumo = ia.resumo;
      } catch { /* análise legada incompleta */ }
      saida.push({
        historico_djen: coberturaHistorico(row.processo_chave), captured_at: row.captured_at,
        publicacao_id: row.id, tipo: ordem.tipo, responsavel: ordem.responsavel,
        processo: row.processo, cliente_nome: row.cliente_nome,
        data_disponibilizacao: row.data_disponibilizacao, dias_decorridos,
        ...prazo, prazo_citado_dias: ordem.prazo_citado_dias,
        motivo: ordem.trecho, resumo,
        acompanhamento_status: estado?.status || "pendente",
        ultima_cobranca_em: estado?.ultima_cobranca_em || null,
      });
    }
    textosPosteriores.push(row.texto);
    posteriores.set(row.processo_chave, textosPosteriores);
    yield;
  }
  return saida.sort((a, b) => b.dias_decorridos - a.dias_decorridos);
}

/** Compatibilidade para diagnósticos e consumidores síncronos existentes. */
export function listarObrigacoesExternas(): ObrigacaoExternaAcompanhamento[] {
  const iterator = calcularObrigacoesExternas();
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value;
}

let consultaEmAndamento: Promise<ObrigacaoExternaAcompanhamento[]> | null = null;

/**
 * As rotas compartilham a consulta em execução e cedem tempo ao event loop entre
 * lotes. O resultado não fica cacheado: mudanças de status/dados aparecem na próxima leitura.
 */
export function listarObrigacoesExternasAsync(): Promise<ObrigacaoExternaAcompanhamento[]> {
  if (consultaEmAndamento) return consultaEmAndamento;
  consultaEmAndamento = (async () => {
    const iterator = calcularObrigacoesExternas();
    let step = iterator.next();
    let lote = 0;
    let inicio = Date.now();
    while (!step.done) {
      if (++lote >= 5 || Date.now() - inicio >= 8) {
        await new Promise<void>(resolve => setImmediate(resolve));
        lote = 0;
        inicio = Date.now();
      }
      step = iterator.next();
    }
    return step.value;
  })().finally(() => { consultaEmAndamento = null; });
  return consultaEmAndamento;
}

export function atualizarObrigacaoExterna(publicacaoId: number, tipo: unknown, status: unknown, dados?: Record<string, unknown>) {
  if (!TIPOS_OBRIGACAO.includes(tipo as TipoObrigacao)) throw new DjenInputError("Tipo de acompanhamento inválido.");
  if (status !== "pendente" && status !== "cobrado" && status !== "resolvido")
    throw new DjenInputError("Situação de acompanhamento inválida.");
  const confirmado = status === "resolvido" ? dadosDoCumprimento(dados) : null;
  const row = db.prepare("SELECT texto FROM djen_publicacoes WHERE id=? AND cancelada=0").get(publicacaoId) as { texto: string } | undefined;
  const ordem = row && identificarObrigacoesExternas(row.texto).find((ordem) => ordem.tipo === tipo);
  if (!row || !ordem)
    throw new DjenInputError("Obrigação não encontrada nesta publicação.");
  db.prepare(
    `INSERT INTO djen_acompanhamentos_obrigacoes(publicacao_id,tipo,status,ultima_cobranca_em)
     VALUES (?,?,?,CASE WHEN ?='cobrado' THEN CURRENT_TIMESTAMP ELSE NULL END)
     ON CONFLICT(publicacao_id,tipo) DO UPDATE SET
       status=excluded.status,
       ultima_cobranca_em=CASE WHEN excluded.status='cobrado' THEN CURRENT_TIMESTAMP ELSE djen_acompanhamentos_obrigacoes.ultima_cobranca_em END`,
  ).run(publicacaoId, tipo, status, status);
  registrarHistoricoDjen(publicacaoId, "providencia", confirmado ? descricaoCumprimento(confirmado) : status === "cobrado" ? "Cobrança marcada como realizada pelo usuário; nenhum envio automático." : `Acompanhamento ${status} pelo usuário.`, { tipo, status, ...confirmado, ordem_chave: confirmado ? chaveDaOrdem(ordem.trecho) : undefined });
  return { ok: true };
}


