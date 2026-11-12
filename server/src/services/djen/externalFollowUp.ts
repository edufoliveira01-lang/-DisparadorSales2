import { dadosDoCumprimento, descricaoCumprimento, chaveDaOrdem } from "./fulfillment";
import { coberturaHistorico, type CoberturaHistorico } from "./historyCoverage";
import { instrucaoSuperada, obrigacaoRevogada } from "./followUpPolicy";
import { prazoDoAcompanhamento, type PrazoAcompanhamento } from "./followUpDeadline";
import { registrarHistoricoDjen } from "./history";
import { marcarEtapaParaRevisao } from "./kanbanRevisao";
import { db } from "../../db";
import { DjenInputError } from "./store";
import { andamentoDaPublicacao, primeiroAndamentoPosterior, type PublicacaoParaAndamento } from "./andamentos";
import { assuntoDaOrdem, cumprimentoIdentificado, identificarObrigacoesExternas, periciaAndou, TIPOS_OBRIGACAO, type AssuntoDaOrdem, type TipoObrigacao } from "./obligations";

import { hojeSaoPaulo } from "./cache";
const hoje = hojeSaoPaulo;
const diasDesde = (data: string) =>
  Math.floor((Date.parse(`${hoje()}T12:00:00Z`) - Date.parse(`${data.slice(0, 10)}T12:00:00Z`)) / 86400000);

export interface ObrigacaoExternaAcompanhamento extends PrazoAcompanhamento {
  historico_djen: CoberturaHistorico; captured_at: string; assunto: AssuntoDaOrdem | null;
  publicacao_id: number; tipo: TipoObrigacao; responsavel: string; processo: string;
  cliente_nome: string | null; data_disponibilizacao: string; dias_decorridos: number;
  dias_espera: number | null; prazo_citado_dias: number | null; motivo: string; resumo: string;
  acompanhamento_status: string; ultima_cobranca_em: string | null;
}

/** Ordem que o processo deixou para trás: o que veio depois mostra que a fase mudou (ou que o processo seguiu andando). */
export interface ObrigacaoSuperada extends ObrigacaoExternaAcompanhamento { motivo_superada: string; ultimo_andamento_em: string | null }
const FASES_POSTERIORES = ["rpv", "precatorio", "levantamento_valores", "cumprimento_sentenca", "extincao_execucao", "extincao_processo", "transito_julgado"];
const DIAS_ORDEM_ANTIGA = 120, DIAS_ANDAMENTO_POSTERIOR = 60;
/** Ordens que já são sobre a perícia (laudo, esclarecimentos, cálculos) ou sobre recurso: a perícia concluída NÃO as supera. */
const DA_FASE_DA_PERICIA = /\b(?:laudo|esclarec|perit|calcul|contadoria|recurso|apela|contrarraz|impugn|embargo)/;
const dataBr = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");
/**
 * A ordem ainda vale? Esta tela é dos processos PARADOS à espera de alguém. Se depois da ordem o processo entrou numa fase posterior
 * (RPV, precatório, cumprimento, trânsito em julgado…) ou seguiu andando por meses, a ordem é considerada superada e sai da lista principal.
 * `null` = continua valendo.
 */
export function motivoDeSuperada(ordemDisponibilizadaEm: string, diasDecorridos: number, posteriores: PublicacaoParaAndamento[], ordem?: { tipo: TipoObrigacao; trecho: string }): { motivo: string; ultimo: string | null } | null {
  if (!posteriores.length) return null;
  const datas = posteriores.map((p) => (p.data || "").slice(0, 10)).filter(Boolean).sort();
  const ultimo = datas.length ? datas[datas.length - 1]! : null;
  // Perícia já concluída: ordens da fase anterior (contestação, réplica, honorários…) ficaram para trás.
  if (ordem?.tipo === "parte_contraria" && !DA_FASE_DA_PERICIA.test(ordem.trecho.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase())) {
    const perícia = posteriores.find((p) => periciaAndou(p.texto));
    if (perícia) return { motivo: `A perícia já andou (laudo ou esclarecimentos do perito${perícia.data ? `, em ${dataBr(perícia.data)}` : ""}): a ordem era de fase anterior.`, ultimo };
  }
  const fase = posteriores.find((p) => (p.categorias || []).some((c) => FASES_POSTERIORES.includes(c)) || andamentoDaPublicacao(p)?.tipo === "requisicao_pagamento");
  if (fase) return { motivo: `O processo já entrou em fase posterior (${(fase.categorias || []).find((c) => FASES_POSTERIORES.includes(c))?.replaceAll("_", " ") || "RPV / precatório"}${fase.data ? `, em ${dataBr(fase.data)}` : ""}).`, ultimo };
  if (diasDecorridos >= DIAS_ORDEM_ANTIGA && ultimo) {
    const folga = Math.floor((Date.parse(`${ultimo}T12:00:00Z`) - Date.parse(`${ordemDisponibilizadaEm.slice(0, 10)}T12:00:00Z`)) / 86_400_000);
    if (folga >= DIAS_ANDAMENTO_POSTERIOR) return { motivo: `A ordem tem ${diasDecorridos} dias e o processo continuou andando (última publicação em ${dataBr(ultimo)}).`, ultimo };
  }
  return null;
}

/** Lembretes operacionais: a ausência de prova no DJEN não comprova descumprimento nos autos. */
function* calcularObrigacoesExternas(): Generator<void, { ativas: ObrigacaoExternaAcompanhamento[]; superadas: ObrigacaoSuperada[] }, void> {
  const config = db.prepare("SELECT aguardo_dias FROM djen_config WHERE id=1").get() as { aguardo_dias: number };
  const rows = db.prepare(
    `SELECT p.id,p.captured_at,p.tribunal,p.orgao,p.processo_chave,p.data_disponibilizacao,p.texto,p.situacao,p.ia_json,
            pr.numero AS processo,c.nome AS cliente_nome,p.categorias_json,p.tipo_documento,p.classe
       FROM djen_publicacoes p JOIN djen_processos pr ON pr.chave=p.processo_chave
       LEFT JOIN contacts c ON c.id=pr.cliente_id
      WHERE p.cancelada=0
      ORDER BY p.processo_chave,p.data_disponibilizacao DESC,p.id DESC`,
  ).all() as {
    id: number; captured_at: string; tribunal: string; orgao: string; processo_chave: string; data_disponibilizacao: string; texto: string;
    situacao: string; ia_json: string | null; processo: string; cliente_nome: string | null;
    categorias_json: string; tipo_documento: string | null; classe: string | null;
  }[];
  // A cobertura acompanha o mesmo instante dos textos. Uma atualização concluída
  // durante as pausas do gerador não pode validar uma lista de textos mais antiga.
  const coberturas = new Map<string, CoberturaHistorico>();
  for (const row of rows) if (!coberturas.has(row.processo_chave)) coberturas.set(row.processo_chave,coberturaHistorico(row.processo_chave));
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
  const posterioresDetalhados = new Map<string, PublicacaoParaAndamento[]>();
  const acompanhados = new Set<string>();
  const saida: ObrigacaoExternaAcompanhamento[] = [];
  const superadas: ObrigacaoSuperada[] = [];
  for (const row of rows) {
    const textosPosteriores = posteriores.get(row.processo_chave) || [];
    const detalhesPosteriores = posterioresDetalhados.get(row.processo_chave) || [];
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
      // Detecção mais robusta: sentença com dispositivo longo, acórdão, trânsito ou acordo
      // posteriores encerram obrigações da fase de instrução. Implantação e cálculos seguem à parte.
      if (["perito_laudo", "perito_esclarecimentos", "parte_contraria"].includes(ordem.tipo)) {
        const avanco = primeiroAndamentoPosterior(detalhesPosteriores);
        if (avanco && ["sentenca", "acordao", "transito_julgado", "acordo"].includes(avanco.tipo) && !/contrarrazo|recurso|apela/.test(ordem.trecho.toLowerCase())) continue;
      }
      if (obrigacaoRevogada(ordem.tipo, ordem.trecho, textosPosteriores)) continue;
      if (textosPosteriores.some((texto) => cumprimentoIdentificado(ordem.tipo, texto, ordem.trecho))) continue;
      const estado = estados.get(`${row.id}:${ordem.tipo}`);
      if (estado?.status === "resolvido") continue;
      let resumo = row.situacao || ordem.trecho;
      try {
        const ia = row.ia_json ? JSON.parse(row.ia_json) : null;
        if (typeof ia?.resumo === "string") resumo = ia.resumo;
      } catch { /* análise legada incompleta */ }
      const item: ObrigacaoExternaAcompanhamento = {
        historico_djen: coberturas.get(row.processo_chave)!, captured_at: row.captured_at, assunto: assuntoDaOrdem(ordem.trecho),
        publicacao_id: row.id, tipo: ordem.tipo, responsavel: ordem.responsavel,
        processo: row.processo, cliente_nome: row.cliente_nome,
        data_disponibilizacao: row.data_disponibilizacao, dias_decorridos,
        ...prazo, prazo_citado_dias: ordem.prazo_citado_dias,
        motivo: ordem.trecho, resumo,
        acompanhamento_status: estado?.status || "pendente",
        ultima_cobranca_em: estado?.ultima_cobranca_em || null,
      };
      const sup = estado?.status === "pendente" || !estado ? motivoDeSuperada(row.data_disponibilizacao, dias_decorridos, detalhesPosteriores, { tipo: ordem.tipo, trecho: ordem.trecho }) : null;
      if (sup) superadas.push({ ...item, motivo_superada: sup.motivo, ultimo_andamento_em: sup.ultimo }); else saida.push(item);
    }
    textosPosteriores.push(row.texto);
    posteriores.set(row.processo_chave, textosPosteriores);
    let categoriasRow: string[] = [];
    try { categoriasRow = JSON.parse(row.categorias_json || "[]"); } catch { /* legado inválido */ }
    detalhesPosteriores.push({ texto: row.texto, data: row.data_disponibilizacao.slice(0, 10), categorias: categoriasRow, tipo_documento: row.tipo_documento, classe: row.classe });
    posterioresDetalhados.set(row.processo_chave, detalhesPosteriores);
    yield;
  }
  return { ativas: saida.sort((a, b) => b.dias_decorridos - a.dias_decorridos), superadas: superadas.sort((a, b) => b.dias_decorridos - a.dias_decorridos) };
}

/** Compatibilidade para diagnósticos e consumidores síncronos existentes. */
export function listarObrigacoesExternas(): ObrigacaoExternaAcompanhamento[] {
  const iterator = calcularObrigacoesExternas();
  let step = iterator.next();
  while (!step.done) step = iterator.next();
  return step.value.ativas;
}

let consultaEmAndamento: Promise<{ ativas: ObrigacaoExternaAcompanhamento[]; superadas: ObrigacaoSuperada[] }> | null = null;

/**
 * As rotas compartilham a consulta em execução e cedem tempo ao event loop entre
 * lotes. O resultado não fica cacheado: mudanças de status/dados aparecem na próxima leitura.
 */
let ativasEmAndamento: Promise<ObrigacaoExternaAcompanhamento[]> | null = null;
export function listarObrigacoesExternasAsync(): Promise<ObrigacaoExternaAcompanhamento[]> {
  // Chamadas simultâneas compartilham a mesma promessa (e a mesma varredura).
  return (ativasEmAndamento ??= calcularAsync().then((r) => r.ativas).finally(() => { ativasEmAndamento = null; }));
}
/** As ordens que o processo deixou para trás (fase posterior ou andamento depois): ficam fora da lista principal, mas dá para conferir. */
export const listarObrigacoesSuperadasAsync = (): Promise<ObrigacaoSuperada[]> => calcularAsync().then((r) => r.superadas);
function calcularAsync() {
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
  marcarEtapaParaRevisao(publicacaoId);
  return { ok: true };
}


