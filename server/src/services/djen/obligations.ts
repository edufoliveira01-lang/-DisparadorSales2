import { identificarOrdensProcessuais } from "./proceduralOrders";
export const TIPOS_OBRIGACAO = [
  "perito_laudo",
  "perito_esclarecimentos",
  "perito_calculos",
  "inss_implantacao",
  "parte_contraria",
] as const;
export type TipoObrigacao = (typeof TIPOS_OBRIGACAO)[number];
export interface ObrigacaoDetectada {
  tipo: TipoObrigacao;
  responsavel: string;
  trecho: string;
  prazo_citado_dias: number | null;
  prazo_texto?: string | null;
  alerta?: string | null;
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
/** Somente intimações/ordens explícitas, no mesmo trecho do destinatário e da providência. */
export function identificarObrigacoesExternas(texto: string): ObrigacaoDetectada[] {
  const saida = new Map<TipoObrigacao, ObrigacaoDetectada>();
  for (const ordem of identificarOrdensProcessuais(texto)) {
    if (["escritorio", "ambas_partes"].includes(ordem.responsavel) || ordem.tipo === "ciencia") continue;
    let tipo: TipoObrigacao;
    if (ordem.responsavel === "perito" || ordem.responsavel === "contadoria") {
      if (ordem.acao === "calculos" || ordem.responsavel === "contadoria") tipo = "perito_calculos";
      else if (ordem.acao === "esclarecimentos") tipo = "perito_esclarecimentos";
      else if (ordem.acao === "laudo") tipo = "perito_laudo";
      else continue;
    } else tipo = ordem.acao === "implantacao" ? "inss_implantacao" : "parte_contraria";
    if (!saida.has(tipo)) saida.set(tipo, { tipo, responsavel:ordem.destinatario, trecho:ordem.trecho, prazo_citado_dias:ordem.dias, prazo_texto:ordem.prazo_texto, alerta:ordem.alerta });
  }
  return [...saida.values()];
}

/** Fato posterior explícito; não encerra o alerta por mera publicação nova. */
export function cumprimentoIdentificado(tipo: TipoObrigacao, texto: string, ordem = ""): boolean {
  const pedido = normalizar(ordem);
  for (const original of texto.split(/(?:[.;]\s+|\n+)/).filter(Boolean)) {
    const s = normalizar(original);
    if (/\b(?:nao|ainda nao|sem|aguardando|aguarde-se|aguardar|apos|quando|caso|devera|deverao|sera|serao|para que|para comprovar|intime-se|intimado|intimada)\b/.test(s)) continue;
    const provas: Record<TipoObrigacao, RegExp> = {
      perito_laudo: /\b(?:laudo\b.{0,80}\b(?:juntad[oa]|apresentad[oa])|juntada do laudo|perit[oa]\b.{0,70}\b(?:juntou|apresentou)\b.{0,40}\blaudo)\b/,
      perito_esclarecimentos: /\b(?:esclarecimentos\b.{0,60}\b(?:prestados|apresentados|juntados)|perit[oa]\b.{0,60}\b(?:prestou|apresentou|juntou)\b.{0,40}\besclarecimentos|perit[oa]\b.{0,60}\bse manifestou|(?:manifestacao|complementacao)\b.{0,40}\b(?:do perito|pericial)\b.{0,60}\b(?:juntada|apresentada)|laudo complementar\b.{0,50}\bjuntado)\b/,
      perito_calculos: /\b(?:calculos\b.{0,60}\b(?:juntados|apresentados|elaborados)|perit[oa]\b.{0,70}\b(?:juntou|apresentou)\b.{0,30}\bcalculos)\b/,
      inss_implantacao: /\b(?:inss\b.{0,70}\bcomprovou\b.{0,50}\bimplantacao|beneficio\b.{0,40}\b(?:foi implantado|implantado|implementado|restabelecido))\b/,
      parte_contraria: /$^/,
    };
    if (tipo === "parte_contraria") {
      if (/\bmanifest\w*/.test(pedido) && /\b(?:(?:inss|parte re|reu|requerid[oa])\b.{0,60}\bse manifestou|manifestacao\b.{0,50}\b(?:do inss|da parte re|do reu)\b.{0,50}\b(?:juntada|apresentada))\b/.test(s)) return true;
      if (/\b(?:document|junt)\w*/.test(pedido) && /\b(?:(?:inss|parte re|reu|requerid[oa])\b.{0,60}\bjuntou\b.{0,40}\bdocumentos|documentos\b.{0,40}\bjuntados\b.{0,40}\b(?:pelo inss|pela parte re|pelo reu))\b/.test(s)) return true;
      if (/\bcontest\w*/.test(pedido) && /\bcontestacao\b.{0,50}\b(?:apresentada|juntada)\b/.test(s)) return true;
      if (/\bcalcul\w*/.test(pedido) && /\bcalculos\b.{0,50}\b(?:apresentados|juntados)\b/.test(s)) return true;
      continue;
    }
    if (provas[tipo].test(s)) return true;
  }
  return false;
}

