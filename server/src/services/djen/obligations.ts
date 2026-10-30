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
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const palavras: Record<string, number> = {
  cinco: 5, dez: 10, quinze: 15, vinte: 20, trinta: 30, quarenta: 40,
  cinquenta: 50, sessenta: 60, noventa: 90, cento: 100,
};
function prazoCitado(s: string): number | null {
  const m = /\b(?:prazo de|pelo prazo de|em|dentro de)\s+(\d{1,3}|cinco|dez|quinze|vinte|trinta|quarenta|cinquenta|sessenta|noventa|cento)\s*(?:\([^)]{1,40}\)\s*)?dias\b/.exec(s);
  if (!m) return null;
  const n = Number(m[1]) || palavras[m[1]];
  return n >= 1 && n <= 365 ? n : null;
}

/** Somente intimações/ordens explícitas, no mesmo trecho do destinatário e da providência. */
export function identificarObrigacoesExternas(texto: string): ObrigacaoDetectada[] {
  const saida = new Map<TipoObrigacao, ObrigacaoDetectada>();
  for (const original of texto.replace(/\b(Sr|Sra|Dr|Dra)\.\s*/gi, "$1 ").split(/(?:[.;]\s+|\n+)/).filter(Boolean)) {
    const s = normalizar(original);
    if (!/\b(?:intime-se|intimem-se|intimad[oa]s?|intimar|intimacao|determino|determina-se|determinado)\b/.test(s)) continue;
    if (/\b(?:caso seja|se for|eventual|solicitou a intimacao|requereu a intimacao|pedido de intimacao)\b/.test(s)) continue;
    const alvo = /\b(?:intime-se|intimem-se|intimar|intimad[oa]|intimacao d[oa]|determino|determina-se)\s+(?:(?:o|a|ao|aos|as|os|que o|que a)\s+)?(?:(?:sr|sra|dr|dra|senhor|senhora)\s+)?(perit[oa]|calculista|contadoria|inss|parte re|parte contraria|reu|requerid[oa]|executad[oa]|autarquia)\b/.exec(s)?.[1]
      || /\b(perit[oa]|calculista|contadoria|inss|parte re|parte contraria|reu|requerid[oa]|executad[oa]|autarquia)\b.{0,35}\b(?:foi|esta|fica|e)?\s*intimad[oa]\b/.exec(s)?.[1];
    if (!alvo) continue;
    let tipo: TipoObrigacao | null = null;
    let responsavel = "";
    if (/^(?:perit[oa]|calculista|contadoria)$/.test(alvo)) {
      responsavel = "Perito";
      if (/\b(?:calcul[oa]s?|calculista|contadoria|contabeis?)\b/.test(s) && /\b(?:apresent|junt|elabor|refac|retific|complement|manifest)\w*/.test(s)) {
        tipo = "perito_calculos";
        responsavel = "Perito de cálculos";
      } else if (/\b(?:esclarec|complement|retific|manifest)\w*/.test(s)) {
        tipo = "perito_esclarecimentos";
      } else if (/\b(?:apresent|junt|entreg|elabor)\w*/.test(s) && /\blaudo\b/.test(s)) {
        tipo = "perito_laudo";
      }
    } else if (alvo === "inss" && /\b(?:implant|restabelec|conced)\w*/.test(s) && /\b(?:beneficio|aposentadoria|pensao|auxilio)\b/.test(s)) {
      tipo = "inss_implantacao";
      responsavel = "INSS";
    } else if (/\b(?:manifest|apresent|junt|cumpr|impugn|comprov|respond|contest)\w*/.test(s)) {
      tipo = "parte_contraria";
      responsavel = alvo === "inss" ? "INSS / parte contrária" : "Parte contrária";
    }
    if (tipo && !saida.has(tipo)) saida.set(tipo, {
      tipo, responsavel, trecho: original.trim().slice(0, 500), prazo_citado_dias: prazoCitado(s),
    });
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

