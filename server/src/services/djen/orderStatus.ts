/**
 * Situação de cada ordem dirigida ao escritório (prazo ou providência).
 *
 * Antes, qualquer ordem antiga continuava aparecendo como providência atual do
 * processo, mesmo após cumprimento, revogação ou sentença. Aqui cada ordem é
 * confrontada com as publicações POSTERIORES do mesmo processo.
 *
 *  - vigente:  nada posterior encerra a ordem.
 *  - decorrido: há certidão/menção de decurso do prazo (continua exigindo atenção).
 *  - cumprida: publicação posterior comprova a petição/emenda/documentos do escritório,
 *              ou o usuário concluiu todos os prazos salvos dessa publicação.
 *  - superada: sentença, acórdão, acordo ou trânsito posterior encerram a fase da ordem.
 *  - revogada: ato posterior cancela expressamente a ordem.
 *
 * A análise é operacional e baseada apenas no DJEN capturado: não prova o que
 * consta nos autos. Por isso cada situação traz o motivo e a evidência literal.
 */
import { andamentoDaPublicacao, type PublicacaoParaAndamento, type TipoAndamento } from "./andamentos";
import type { OrdemProcessual } from "./proceduralOrders";
import { frasesAtuais } from "./followUpPolicy";

export type SituacaoOrdem = "vigente" | "decorrido" | "cumprida" | "superada" | "revogada";

export interface SituacaoDaOrdem {
  situacao: SituacaoOrdem;
  motivo: string;
  evidencia: string | null;
  data: string | null;
}

export type PublicacaoPosterior = PublicacaoParaAndamento & { data: string };

const normal = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const ACOES_ENCERRADAS_POR_JULGAMENTO = new Set([
  "emenda_inicial",
  "manifestacao",
  "esclarecimentos",
  "laudo",
  "ciencia",
]);
const JULGAMENTO: TipoAndamento[] = ["sentenca", "acordao", "transito_julgado", "acordo"];

// Quem cumpre: a parte autora/escritório. Verbo + objeto no mesmo trecho, sem negação.
const SUJEITO_AUTORA = "(?:parte autora|autora?|requerente|exequente|impetrante|patrono da autora|advogad[oa] da autora|escritorio)";
const OBJETO = "(?:manifestacao|peticao|documentos?|emenda|esclarecimentos?|comprovante|comprovacao|impugnacao|contrarrazoes|recurso|replica|calculos?|rol de testemunhas|quesitos)";
const CUMPRIMENTO_POSTERIOR: RegExp[] = [
  new RegExp(`\\b(?:juntada|apresentacao|protocolo)\\b[^.;]{0,30}\\b${OBJETO}\\b[^.;]{0,30}\\b(?:d[ao]s?|pel[ao]s?)\\s+${SUJEITO_AUTORA}\\b`),
  new RegExp(`\\b${OBJETO}\\b[^.;]{0,50}\\b(?:d[ao]s?|pel[ao]s?)\\s+${SUJEITO_AUTORA}\\b[^.;]{0,40}\\b(?:juntad|apresentad|protocolad|anexad|recebid)\\w*`),
  new RegExp(`\\b${SUJEITO_AUTORA}\\b[^.;]{0,30}\\b(?:cumpriu|se manifestou|manifestou-se|juntou|apresentou|emendou|regularizou|comprovou|protocolou|impugnou)\\b`),
  /\b(?:recebo|recebida|aceito|acolho)\b[^.;]{0,30}\bemenda\b|\bemenda\b[^.;]{0,50}\b(?:recebida|aceita|cumprida|apresentada)\b/,
  /\b(?:cumprida|cumprimento (?:integral )?d[ao])\b[^.;]{0,30}\b(?:determinacao|diligencia|ordem|intimacao|despacho)\b|\bcertifico\b[^.;]{0,30}\bcumprimento\b/,
  /\b(?:ja|devidamente)\s+(?:cumprid[oa]|atendid[oa])\b/,
];
// Só a emenda à inicial é encerrada pelo andamento natural de uma inicial aceita.
const INICIAL_ACEITA = /\b(?:cite-se|citem-se|determino a citacao|recebo a inicial|inicial\s+recebida)\b/;
const IMPEDE_CUMPRIMENTO = /\b(?:nao|sem|deixou de|ainda nao|aguarda\w*|intime-se|intimem-se|intimad[oa]s?|para que|a fim de|devera|deverao|caso|se houver|quando|apos)\b/;
const DECURSO = /\bdecurso\s+(?:do\s+|de\s+)?prazo\b|\bprazo\s+(?:decorreu|decorrido|expirou|transcorreu|esgotado)\b|\bdecorreu\s+o\s+prazo\b|\btranscorreu\s+(?:in\s+albis\s+)?o\s+prazo\b/;
const REVOGACAO =
  /\b(?:revogo|cancelo|torno sem efeito|dispenso|reconsidero)\b[^.;]{0,50}\b(?:intimacao|determinacao|ordem|despacho|prazo|exigencia|emenda|manifestacao|decisao anterior)\b|\b(?:intimacao|determinacao|ordem|despacho|prazo|exigencia)\b[^.;]{0,50}\b(?:fica|foi|esta)\s+(?:cancelad[oa]|revogad[oa]|dispensad[oa]|sem efeito)\b/;

export function situacaoDaOrdem(
  ordem: Pick<OrdemProcessual, "acao" | "trecho">,
  posteriores: PublicacaoPosterior[],
  opcoes: { prazosDoUsuario?: { total: number; abertos: number; concluidos: number } } = {},
): SituacaoDaOrdem {
  const vigente: SituacaoDaOrdem = { situacao: "vigente", motivo: "Nenhum andamento posterior capturado encerra esta ordem.", evidencia: null, data: null };
  const prazos = opcoes.prazosDoUsuario;
  if (prazos && prazos.total > 0 && prazos.abertos === 0 && prazos.concluidos > 0)
    return { situacao: "cumprida", motivo: "Todos os prazos salvos para esta publicação foram concluídos pelo usuário.", evidencia: null, data: null };

  // Do mais antigo ao mais recente: o primeiro fato encerrador prevalece.
  const cronologicas = [...posteriores].sort((a, b) => a.data.localeCompare(b.data));
  let decorrido: SituacaoDaOrdem | null = null;
  for (const pub of cronologicas) {
    const frases = frasesAtuais(pub.texto);
    const revogacao = frases.find((s) => REVOGACAO.test(s) && !/\b(?:nao|deixo de)\b[^.;]{0,25}\b(?:revogo|cancelo|dispenso|reconsidero)\b/.test(s));
    if (revogacao) return { situacao: "revogada", motivo: "Ato posterior revoga ou cancela a ordem.", evidencia: revogacao.slice(0, 220), data: pub.data };
    const cumprimento = frases.find((s) => !IMPEDE_CUMPRIMENTO.test(s) && (CUMPRIMENTO_POSTERIOR.some((re) => re.test(s)) || (ordem.acao === "emenda_inicial" && INICIAL_ACEITA.test(s))));
    if (cumprimento) return { situacao: "cumprida", motivo: "Publicação posterior indica cumprimento ou recebimento da providência.", evidencia: cumprimento.slice(0, 220), data: pub.data };
    const andamento = andamentoDaPublicacao(pub);
    if (andamento && ACOES_ENCERRADAS_POR_JULGAMENTO.has(ordem.acao) && JULGAMENTO.includes(andamento.tipo))
      return { situacao: "superada", motivo: `${andamento.rotulo} posterior encerra a fase desta ordem.`, evidencia: andamento.evidencia, data: pub.data };
    if (andamento && ordem.acao === "recurso" && ["acordao", "transito_julgado"].includes(andamento.tipo))
      return { situacao: "superada", motivo: `${andamento.rotulo} posterior encerra a fase recursal.`, evidencia: andamento.evidencia, data: pub.data };
    if (!decorrido) {
      const frase = frases.find((s) => DECURSO.test(s));
      if (frase) decorrido = { situacao: "decorrido", motivo: "Publicação posterior menciona decurso do prazo, sem cumprimento identificado.", evidencia: frase.slice(0, 220), data: pub.data };
    }
  }
  return decorrido || vigente;
}

/** Resumo de rótulos para a tela. */
export const ROTULO_SITUACAO_ORDEM: Record<SituacaoOrdem, string> = {
  vigente: "Em aberto",
  decorrido: "Prazo decorrido",
  cumprida: "Cumprida",
  superada: "Superada",
  revogada: "Revogada",
};

export const ordemAtiva = (s: SituacaoDaOrdem) => s.situacao === "vigente" || s.situacao === "decorrido";
export { normal as normalizarOrdem };
