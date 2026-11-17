import { db } from "../../db";
import { DjenInputError } from "./store";
import { concluirPublicacao } from "./deadlines";
import { registrarHistoricoDjen } from "./history";
import { identificarOrdensProcessuais, ordemDoEscritorio } from "./proceduralOrders";

/**
 * CONCLUIR NÃO PODE ESCONDER TRABALHO PENDENTE.
 *
 * Antes, «Concluir» arquivava TODOS os andamentos do processo de uma vez (um cartão agrupava sete) e nada avisava se algum tinha perícia fora do
 * controle, prazo aberto ou análise da IA que falhou. Aqui a conclusão tem escopo explícito (este andamento, ou todos os do processo) e uma
 * conferência: havendo pendência, a baixa só acontece com confirmação expressa e uma justificativa, que fica no histórico de cada andamento.
 */
export type EscopoDaConclusao = "andamento" | "processo";
export interface PendenciaDaConclusao {
  publicacao_id: number;
  tipo: "compromisso" | "prazo_sem_lancamento" | "analise_ia" | "classificacao";
  gravidade: "alta" | "media";
  texto: string;
}
export interface AndamentoParaConclusao { id: number; data: string; tipo_documento: string | null }

interface Linha {
  id: number;
  data_disponibilizacao: string;
  tipo_documento: string | null;
  categorias_json: string | null;
  compromisso_estado: string | null;
  ia_status: string | null;
  revisada: number;
  prazos_total: number;
  texto: string | null;
}

const rotuloData = (iso: string) => iso.split("-").reverse().join("/");

/** O que ainda está pendente nestes andamentos. Só andamentos abertos (não concluídos) e não cancelados contam. */
export function pendenciasDaConclusao(ids: number[]): PendenciaDaConclusao[] {
  if (!ids.length) return [];
  const marcas = ids.map(() => "?").join(",");
  const linhas = db
    .prepare(
      `SELECT p.id,p.data_disponibilizacao,p.tipo_documento,p.categorias_json,p.compromisso_estado,p.ia_status,p.revisada,p.texto,
              (SELECT count(*) FROM djen_prazos dp WHERE dp.publicacao_id=p.id) AS prazos_total
         FROM djen_publicacoes p WHERE p.id IN (${marcas}) AND p.cancelada=0`,
    )
    .all(...ids) as Linha[];
  const out: PendenciaDaConclusao[] = [];
  for (const l of linhas) {
    const quando = `${l.tipo_documento || "Andamento"} de ${rotuloData(l.data_disponibilizacao)}`;
    let categorias: string[] = [];
    try { categorias = JSON.parse(l.categorias_json || "[]"); } catch { /* sem categorias */ }
    const compromisso = categorias.includes("pericia") ? "Perícia" : categorias.includes("audiencia") ? "Audiência" : "";
    if (compromisso && l.compromisso_estado !== "informado" && l.compromisso_estado !== "ignorado") {
      out.push({ publicacao_id: l.id, tipo: "compromisso", gravidade: "alta", texto: `${quando}: ${compromisso.toLowerCase()} ainda não está no controle de Perícias e compromissos.` });
    }
    // Regra do escritório: tudo o que EXIGE PRAZO do escritório precisa estar lançado (e, portanto, acompanhado na agenda) antes de concluir.
    // Prazo já lançado não é pendência: ele segue vivo na agenda mesmo com o andamento concluído.
    if (l.prazos_total === 0) {
      let exigePrazo = false;
      try { exigePrazo = identificarOrdensProcessuais(l.texto ?? "").some((o) => ordemDoEscritorio(o) && o.tipo === "prazo_explicito"); } catch { /* texto ilegível: não presume */ }
      if (exigePrazo) out.push({ publicacao_id: l.id, tipo: "prazo_sem_lancamento", gravidade: "alta", texto: `${quando}: exige prazo do escritório e nenhum prazo foi lançado.` });
    }
    if (!l.revisada && l.ia_status && l.ia_status !== "concluida") {
      out.push({ publicacao_id: l.id, tipo: "analise_ia", gravidade: "alta", texto: `${quando}: a análise da IA ${l.ia_status === "erro" ? "falhou" : "não terminou"} e ninguém conferiu a classificação.` });
    } else if (!l.revisada && (categorias.includes("prazo") || categorias.includes("sentenca") || categorias.includes("acordao"))) {
      out.push({ publicacao_id: l.id, tipo: "classificacao", gravidade: "media", texto: `${quando}: a classificação sugerida pela IA ainda não foi conferida.` });
    }
  }
  return out;
}

/** Os andamentos abertos que a conclusão alcança: só este, ou todos os do mesmo processo. */
export function andamentosDaConclusao(publicacaoId: number, escopo: EscopoDaConclusao, concluida: boolean): AndamentoParaConclusao[] {
  const base = db.prepare("SELECT processo_chave FROM djen_publicacoes WHERE id=? AND cancelada=0").get(publicacaoId) as { processo_chave: string } | undefined;
  if (!base) throw new DjenInputError("Publicação não encontrada.");
  const filtroEstado = concluida ? "AND concluida=0" : "AND concluida=1";
  if (escopo === "andamento") {
    return db.prepare(`SELECT id,data_disponibilizacao AS data,tipo_documento FROM djen_publicacoes WHERE id=? ${filtroEstado}`).all(publicacaoId) as AndamentoParaConclusao[];
  }
  return db
    .prepare(`SELECT id,data_disponibilizacao AS data,tipo_documento FROM djen_publicacoes WHERE processo_chave=? AND cancelada=0 ${filtroEstado} ORDER BY data_disponibilizacao DESC,id DESC`)
    .all(base.processo_chave) as AndamentoParaConclusao[];
}

export class ConclusaoBloqueada extends Error {
  constructor(public pendencias: PendenciaDaConclusao[], public total: number) {
    super("Há pendências nos andamentos que seriam concluídos.");
  }
}

export function concluirComSeguranca(opts: { id: number; concluida: boolean; escopo?: EscopoDaConclusao; forcar?: boolean; justificativa?: string }) {
  const escopo: EscopoDaConclusao = opts.escopo === "processo" ? "processo" : "andamento";
  const alvo = andamentosDaConclusao(opts.id, escopo, opts.concluida);
  const justificativa = (opts.justificativa ?? "").trim();
  if (opts.concluida) {
    const pendencias = pendenciasDaConclusao(alvo.map((a) => a.id));
    if (pendencias.length && !opts.forcar) throw new ConclusaoBloqueada(pendencias, alvo.length);
    if (pendencias.length && (justificativa.length < 5 || justificativa.length > 1000))
      throw new DjenInputError("Para concluir com pendências, explique o motivo (de 5 a 1.000 caracteres).");
  }
  const pendentesPorId = new Map<number, PendenciaDaConclusao[]>();
  if (opts.concluida && opts.forcar) for (const p of pendenciasDaConclusao(alvo.map((a) => a.id))) pendentesPorId.set(p.publicacao_id, [...(pendentesPorId.get(p.publicacao_id) ?? []), p]);
  db.transaction(() => {
    for (const a of alvo) {
      concluirPublicacao(a.id, opts.concluida);
      const escopoTexto = escopo === "processo" ? "Todos os andamentos do processo foram concluídos pelo usuário" : "Andamento concluído pelo usuário";
      const pend = pendentesPorId.get(a.id);
      registrarHistoricoDjen(
        a.id,
        "conclusao",
        opts.concluida
          ? pend?.length
            ? `${escopoTexto} COM PENDÊNCIAS (${pend.map((p) => p.tipo).join(", ")}). Justificativa: ${justificativa}`
            : `${escopoTexto}.`
          : escopo === "processo" ? "Todos os andamentos do processo foram reabertos pelo usuário." : "Andamento reaberto pelo usuário.",
      );
    }
  })();
  return { escopo, total: alvo.length, ids: alvo.map((a) => a.id) };
}

/** Conclusão em lote (processos selecionados): os que têm pendência só entram com confirmação expressa e justificativa. */
export function concluirLoteComSeguranca(ids: unknown, opts: { forcar?: boolean; justificativa?: string } = {}) {
  if (!Array.isArray(ids) || !ids.length || ids.length > 5000 || ids.some((n: unknown) => !Number.isSafeInteger(n) || Number(n) <= 0))
    throw new DjenInputError("Selecione de 1 a 5.000 processos válidos.");
  const unicos = [...new Set(ids as number[])];
  const processos = new Set<string>();
  const buscar = db.prepare("SELECT processo_chave FROM djen_publicacoes WHERE id=? AND cancelada=0 AND concluida=0");
  for (const n of unicos) {
    const row = buscar.get(n) as { processo_chave: string } | undefined;
    if (!row) throw new DjenInputError("A seleção mudou. Atualize a lista e selecione novamente.");
    processos.add(row.processo_chave);
  }
  const abertas = db.prepare("SELECT id FROM djen_publicacoes WHERE processo_chave=? AND cancelada=0 AND concluida=0");
  const todos: number[] = [];
  for (const chave of processos) for (const p of abertas.all(chave) as { id: number }[]) todos.push(p.id);
  const pendencias = pendenciasDaConclusao(todos);
  const justificativa = (opts.justificativa ?? "").trim();
  if (pendencias.length && !opts.forcar) throw new ConclusaoBloqueada(pendencias, todos.length);
  if (pendencias.length && (justificativa.length < 5 || justificativa.length > 1000))
    throw new DjenInputError("Para concluir com pendências, explique o motivo (de 5 a 1.000 caracteres).");
  const comPendencia = new Set(pendencias.map((p) => p.publicacao_id));
  db.transaction(() => {
    for (const id of todos) {
      concluirPublicacao(id, true);
      registrarHistoricoDjen(id, "conclusao", comPendencia.has(id) ? `Concluído em lote COM PENDÊNCIAS. Justificativa: ${justificativa}` : "Concluído em lote pelo usuário.");
    }
  })();
  return { processos: processos.size, publicacoes: todos.length };
}
