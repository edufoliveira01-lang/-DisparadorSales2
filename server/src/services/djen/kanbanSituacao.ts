/**
 * Situação do processo no quadro quando o histórico do DJEN NÃO prova nenhuma etapa
 * processual (sem sentença, perícia, recurso etc.). Em vez de deixar o cartão na triagem,
 * indica quem deve agir agora:
 *
 *   prov_escritorio    ordem vigente para o escritório (prazo ou providência)
 *   aguarda_terceiros  ordem a perito, INSS, parte contrária ou terceiro ainda sem resposta
 *   sobrestado         processo suspenso/sobrestado
 *   aguarda_juizo      sem ordem pendente: aguardando andamento do juízo
 *
 * É uma leitura operacional do DJEN capturado, não prova do que consta nos autos.
 */
import { identificarOrdensProcessuais, ordemDoEscritorio, contextoNaoAtual } from "./proceduralOrders";
import { identificarObrigacoesExternas, cumprimentoIdentificado } from "./obligations";
import { situacaoDaOrdem, ordemAtiva, type PublicacaoPosterior } from "./orderStatus";
import { andamentoDaPublicacao } from "./andamentos";
import { obrigacaoRevogada } from "./followUpPolicy";

export interface PublicacaoSituacao extends PublicacaoPosterior {
  id: number;
  concluida?: number;
}
export type EtapaSituacional = "prov_escritorio" | "aguarda_terceiros" | "sobrestado" | "aguarda_juizo";
export interface SinalSituacional {
  codigo: EtapaSituacional;
  evidencia: string;
  publicacao_id: number;
  data: string;
}

/** Ordens mais antigas que isso, sem fato posterior, tendem a ser história e não pendência. */
const JANELA_ORDEM_DIAS = 150;
const canon = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const SOBRESTADO = /\b(?:sobrest\w+|suspen(?:so|sa|d[oa]|dendo|do|sao)\s+(?:o\s+|do\s+|da\s+)?(?:processo|feito|curso|andamento)|suspende-se\b|suspendo\s+o\s+(?:processo|feito|curso))\b/;
const curto = (s: string, n = 200) => (s.length > n ? `${s.slice(0, n - 1).trim()}…` : s.trim());
const diasEntre = (de: string, ate: string) => Math.round((Date.parse(`${ate.slice(0, 10)}T12:00:00Z`) - Date.parse(`${de.slice(0, 10)}T12:00:00Z`)) / 86400000);

/**
 * @param pubs publicações do processo, da mais recente para a mais antiga
 * @param prazosPorPub prazos salvos pelo usuário por publicação
 * @param manuais publicações cujo prazo do escritório foi baixado manualmente
 */
export function classificarSituacaoProcesso(
  pubs: PublicacaoSituacao[],
  hoje: string,
  prazosPorPub: Map<number, { total: number; abertos: number; concluidos: number }> = new Map(),
  manuais: Set<number> = new Set(),
): SinalSituacional | null {
  if (!pubs.length) return null;
  const recentes = pubs.filter((p) => diasEntre(p.data, hoje) <= JANELA_ORDEM_DIAS);

  // 1) Ordem vigente para o escritório.
  for (let i = 0; i < recentes.length; i++) {
    const pub = recentes[i];
    if (pub.concluida) continue;
    const posteriores = pubs.slice(0, pubs.indexOf(pub));
    for (const ordem of identificarOrdensProcessuais(pub.texto).filter(ordemDoEscritorio)) {
      if (ordem.tipo === "ciencia") continue;
      const situacao = situacaoDaOrdem(ordem, posteriores, { prazosDoUsuario: prazosPorPub.get(pub.id), cumpridaManual: manuais.has(pub.id) });
      if (ordemAtiva(situacao))
        return { codigo: "prov_escritorio", publicacao_id: pub.id, data: pub.data,
          evidencia: curto(`${ordem.descricao}: ${ordem.prazo_texto || ordem.trecho}`) };
    }
  }

  // 2) Ordem a terceiros ainda sem resposta identificada.
  for (const pub of recentes) {
    const posteriores = pubs.slice(0, pubs.indexOf(pub));
    for (const ordem of identificarObrigacoesExternas(pub.texto)) {
      const textos = posteriores.map((p) => p.texto);
      if (textos.some((t) => cumprimentoIdentificado(ordem.tipo, t, ordem.trecho))) continue;
      if (obrigacaoRevogada(ordem.tipo, ordem.trecho, textos)) continue;
      // Sentença/acórdão/trânsito posterior encerra a instrução; não é espera de terceiros.
      const encerrou = posteriores.some((p) => ["sentenca", "acordao", "transito_julgado", "acordo"].includes(andamentoDaPublicacao(p)?.tipo || ""));
      if (encerrou && ordem.tipo !== "inss_implantacao") continue;
      return { codigo: "aguarda_terceiros", publicacao_id: pub.id, data: pub.data, evidencia: curto(`${ordem.responsavel}: ${ordem.trecho}`) };
    }
  }

  // 3) Suspenso/sobrestado, se nenhum ato posterior o reabriu (a publicação mais recente continua sendo a referência).
  for (const pub of pubs.slice(0, 3)) {
    const fonte = canon(pub.texto);
    const m = SOBRESTADO.exec(fonte);
    if (m && !contextoNaoAtual(fonte.slice(Math.max(0, m.index - 40), m.index + 60)) && !/\b(?:nao|sem|revogo|cesso a suspensao|fim da suspensao)\b[^.;]{0,25}$/.test(fonte.slice(Math.max(0, m.index - 40), m.index)))
      return { codigo: "sobrestado", publicacao_id: pub.id, data: pub.data, evidencia: curto(pub.texto.slice(Math.max(0, m.index - 30), m.index + 170)) };
  }

  // 4) Nada pendente: aguardando o juízo a partir da última publicação.
  const ultima = pubs[0];
  return { codigo: "aguarda_juizo", publicacao_id: ultima.id, data: ultima.data,
    evidencia: `Última publicação em ${ultima.data.split("-").reverse().join("/")}: sem ordem pendente para o escritório ou terceiros e sem etapa processual específica identificada.` };
}
