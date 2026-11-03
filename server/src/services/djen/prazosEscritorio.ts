/**
 * Alertas do próprio escritório:
 *  - prazos expressos vencidos (ou a vencer) sem cumprimento identificado;
 *  - processos parados há muito tempo sem nenhum andamento capturado.
 *
 * São lembretes operacionais baseados no DJEN capturado: não substituem a consulta
 * aos autos nem a contagem processual. Cada item informa a origem da data.
 */
import { db } from "../../db";
import { coberturaHistorico, type CoberturaHistorico } from "./historyCoverage";
import { identificarOrdensProcessuais, ordemDoEscritorio } from "./proceduralOrders";
import { situacaoDaOrdem, ordemAtiva, type PublicacaoPosterior } from "./orderStatus";
import { prazoDoAcompanhamento } from "./followUpDeadline";
import { andamentoDaPublicacao } from "./andamentos";
import { dadosDoCumprimento, descricaoCumprimento } from "./fulfillment";
import { registrarHistoricoDjen } from "./history";
import { DjenInputError } from "./store";

const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const diasEntre = (de: string, ate: string) =>
  Math.round((Date.parse(`${ate.slice(0, 10)}T12:00:00Z`) - Date.parse(`${de.slice(0, 10)}T12:00:00Z`)) / 86400000);
const JANELA_PRAZOS_DIAS = 240;
const ANTECEDENCIA_ALERTA_DIAS = 3;

/** Memória curta: as contagens do painel são lidas com frequência. */
function comMemoria<T>(ttlMs: number, calcular: () => T) {
  let valor: { em: number; dado: T } | null = null;
  const ler = () => {
    if (valor && Date.now() - valor.em < ttlMs) return valor.dado;
    const dado = calcular();
    valor = { em: Date.now(), dado };
    return dado;
  };
  ler.limpar = () => { valor = null; };
  return ler;
}

interface Linha {
  id: number; processo_chave: string; tribunal: string; orgao: string; data_disponibilizacao: string; texto: string;
  categorias_json: string; tipo_documento: string | null; classe: string | null; situacao: string; ia_json: string | null;
  concluida: number; processo: string; cliente_nome: string | null;
}
const SELECT = `SELECT p.id,p.processo_chave,p.tribunal,p.orgao,p.data_disponibilizacao,p.texto,p.categorias_json,p.tipo_documento,p.classe,p.situacao,p.ia_json,p.concluida,
    pr.numero AS processo,c.nome AS cliente_nome
  FROM djen_publicacoes p JOIN djen_processos pr ON pr.chave=p.processo_chave LEFT JOIN contacts c ON c.id=pr.cliente_id
 WHERE p.cancelada=0 ORDER BY p.processo_chave,p.data_disponibilizacao DESC,p.id DESC`;

const categoriasDe = (json: string) => { try { return JSON.parse(json || "[]") as string[]; } catch { return []; } };
const paraPosterior = (l: Linha): PublicacaoPosterior => ({ texto: l.texto, data: l.data_disponibilizacao.slice(0, 10), categorias: categoriasDe(l.categorias_json), tipo_documento: l.tipo_documento, classe: l.classe });
function porProcesso(linhas: Linha[]) {
  const mapa = new Map<string, Linha[]>();
  for (const l of linhas) (mapa.get(l.processo_chave) || mapa.set(l.processo_chave, []).get(l.processo_chave)!).push(l);
  return mapa;
}

export interface PrazoEscritorio {
  publicacao_id: number; processo: string; cliente_nome: string | null; descricao: string; prazo_texto: string;
  data_disponibilizacao: string; termino: string | null; origem_data: "salvo" | "previsto" | "decorrido";
  dias_para_vencer: number | null; urgencia: "vencido" | "vence_em_breve" | "decorrido";
  situacao: string; situacao_motivo: string; historico_djen: CoberturaHistorico;
}

function calcularPrazosEscritorio(): PrazoEscritorio[] {
  const config = db.prepare("SELECT aguardo_dias FROM djen_config WHERE id=1").get() as { aguardo_dias: number } | undefined;
  const dia = hoje();
  const limite = new Date(Date.parse(`${dia}T12:00:00Z`) - JANELA_PRAZOS_DIAS * 86400000).toISOString().slice(0, 10);
  const salvos = new Map<number, { total: number; abertos: number; concluidos: number; termino: string | null }>();
  for (const r of db.prepare(`SELECT publicacao_id,COUNT(*) AS total,SUM(status='aberto') AS abertos,SUM(status='concluido') AS concluidos,
      MIN(CASE WHEN status='aberto' THEN termino END) AS termino FROM djen_prazos GROUP BY publicacao_id`).all() as { publicacao_id: number; total: number; abertos: number | null; concluidos: number | null; termino: string | null }[])
    salvos.set(r.publicacao_id, { total: r.total, abertos: r.abertos || 0, concluidos: r.concluidos || 0, termino: r.termino });
  const manuais = new Set((db.prepare("SELECT publicacao_id FROM djen_prazos_escritorio_estado WHERE status='resolvido'").all() as { publicacao_id: number }[]).map((r) => r.publicacao_id));
  const saida: PrazoEscritorio[] = [];
  for (const [chave, pubs] of porProcesso(db.prepare(SELECT).all() as Linha[])) {
    const posteriores: PublicacaoPosterior[] = [];
    let cobertura: CoberturaHistorico | null = null;
    for (const pub of pubs) { // do mais novo ao mais antigo
      const data = pub.data_disponibilizacao.slice(0, 10);
      if (data >= limite && !pub.concluida) {
        const ordem = identificarOrdensProcessuais(pub.texto).filter(ordemDoEscritorio).find((o) => o.tipo === "prazo_explicito");
        if (ordem) {
          const estado = salvos.get(pub.id);
          const situ = situacaoDaOrdem(ordem, posteriores, { prazosDoUsuario: estado, cumpridaManual: manuais.has(pub.id) });
          if (ordemAtiva(situ)) {
            let termino: string | null = null;
            let origem: PrazoEscritorio["origem_data"] = "previsto";
            if (estado && estado.abertos > 0 && estado.termino) { termino = estado.termino; origem = "salvo"; }
            else if (!(estado && estado.total > 0)) {
              const previsto = prazoDoAcompanhamento({ tipo: "parte_contraria", responsavel: "Escritório", trecho: ordem.trecho, prazo_citado_dias: ordem.dias,
                prazo_texto: ordem.prazo_texto, unidade: ordem.unidade, alerta: ordem.alerta }, pub, config?.aguardo_dias || 30, dia);
              termino = previsto.prazo_termino;
            }
            const dias = termino ? diasEntre(dia, termino) : null;
            const decorrido = situ.situacao === "decorrido";
            if (decorrido || (dias !== null && dias <= ANTECEDENCIA_ALERTA_DIAS)) {
              cobertura = cobertura || coberturaHistorico(chave);
              saida.push({
                publicacao_id: pub.id, processo: pub.processo, cliente_nome: pub.cliente_nome, descricao: ordem.descricao, prazo_texto: ordem.trecho.slice(0, 400),
                data_disponibilizacao: data, termino, origem_data: decorrido && !termino ? "decorrido" : origem, dias_para_vencer: dias,
                urgencia: dias !== null && dias < 0 ? "vencido" : decorrido && dias === null ? "decorrido" : "vence_em_breve",
                situacao: situ.situacao, situacao_motivo: situ.motivo, historico_djen: cobertura,
              });
            }
          }
        }
      }
      posteriores.push(paraPosterior(pub));
    }
  }
  return saida.sort((a, b) => (a.termino || "9999").localeCompare(b.termino || "9999"));
}
const memoPrazos = comMemoria(30_000, calcularPrazosEscritorio);
export const listarPrazosEscritorio = () => memoPrazos();

export function atualizarPrazoEscritorio(publicacaoId: number, status: unknown, dados?: Record<string, unknown>) {
  if (status !== "pendente" && status !== "resolvido") throw new DjenInputError("Situação inválida.");
  if (!db.prepare("SELECT id FROM djen_publicacoes WHERE id=? AND cancelada=0").get(publicacaoId)) throw new DjenInputError("Publicação não encontrada.");
  const confirmado = status === "resolvido" ? dadosDoCumprimento(dados) : null;
  db.prepare(`INSERT INTO djen_prazos_escritorio_estado(publicacao_id,status,cumprido_em,observacoes,updated_at) VALUES (?,?,?,?,CURRENT_TIMESTAMP)
    ON CONFLICT(publicacao_id) DO UPDATE SET status=excluded.status,cumprido_em=excluded.cumprido_em,observacoes=excluded.observacoes,updated_at=CURRENT_TIMESTAMP`)
    .run(publicacaoId, status, confirmado?.cumprido_em ?? null, confirmado?.observacoes ?? "");
  registrarHistoricoDjen(publicacaoId, "providencia", confirmado ? descricaoCumprimento(confirmado) : "Prazo do escritório reaberto pelo usuário.", confirmado);
  memoPrazos.limpar();
  memoParados.limpar();
  return { ok: true };
}

export interface ProcessoParado {
  publicacao_id: number; processo: string; cliente_nome: string | null; ultima_publicacao_em: string; dias_parado: number;
  ultimo_andamento: string; ultimo_tipo: string | null; historico_djen: CoberturaHistorico;
}
const CATEGORIAS_ENCERRAMENTO = new Set(["arquivamento", "extincao_execucao", "extincao_processo", "transito_julgado"]);

function calcularProcessosParados(dias: number): ProcessoParado[] {
  const dia = hoje();
  const futuras = new Set((db.prepare("SELECT DISTINCT processo_chave FROM pericias_agendadas WHERE status='ativa' AND processo_chave<>'' AND data_hora_ms>?").all(Date.now()) as { processo_chave: string }[]).map((r) => r.processo_chave));
  const saida: ProcessoParado[] = [];
  for (const [chave, pubs] of porProcesso(db.prepare(SELECT).all() as Linha[])) {
    if (futuras.has(chave) || pubs.every((p) => p.concluida)) continue;
    const ultima = pubs[0];
    const parado = diasEntre(ultima.data_disponibilizacao, dia);
    if (parado < dias) continue;
    // Processo encerrado (trânsito, arquivamento, extinção) ou aguardando pagamento não é "parado".
    const encerrado = pubs.some((p) => {
      const cats = categoriasDe(p.categorias_json);
      if (cats.some((c) => CATEGORIAS_ENCERRAMENTO.has(c))) return true;
      const a = andamentoDaPublicacao(p);
      return a?.tipo === "transito_julgado" || a?.tipo === "requisicao_pagamento";
    });
    if (encerrado) continue;
    let resumo = ultima.situacao || "";
    try { const ia = ultima.ia_json ? JSON.parse(ultima.ia_json) : null; if (!resumo && typeof ia?.resumo === "string") resumo = ia.resumo; } catch { /* análise legada */ }
    saida.push({
      publicacao_id: ultima.id, processo: ultima.processo, cliente_nome: ultima.cliente_nome, ultima_publicacao_em: ultima.data_disponibilizacao.slice(0, 10),
      dias_parado: parado, ultimo_andamento: resumo || ultima.texto.slice(0, 160), ultimo_tipo: andamentoDaPublicacao(ultima)?.rotulo || null,
      historico_djen: coberturaHistorico(chave),
    });
  }
  return saida.sort((a, b) => b.dias_parado - a.dias_parado);
}
const memoParados = comMemoria(30_000, () => new Map<number, ProcessoParado[]>());
export function listarProcessosParados(dias = 60) {
  const limite = Math.max(30, Math.min(365, Math.trunc(dias) || 60));
  const cache = memoParados();
  if (!cache.has(limite)) cache.set(limite, calcularProcessosParados(limite));
  return cache.get(limite)!;
}

/** Usado após capturas e em testes: as listas são recalculadas na próxima leitura. */
export function limparMemoriaAlertas() { memoPrazos.limpar(); memoParados.limpar(); }
