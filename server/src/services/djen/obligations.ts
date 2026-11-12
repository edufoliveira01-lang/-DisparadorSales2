import { laudoEfetivamenteJuntado } from "./followUpPolicy";
import { identificarOrdensProcessuais } from "./proceduralOrders";
import { antes, emHipotese } from "./andamentos";
import { memoTexto } from "./cache";
export const TIPOS_OBRIGACAO = [
  "perito_laudo",
  "perito_esclarecimentos",
  "perito_calculos",
  "inss_implantacao",
  "parte_contraria",
  "terceiro_oficio",
] as const;
export type TipoObrigacao = (typeof TIPOS_OBRIGACAO)[number];
export interface ObrigacaoDetectada {
  tipo: TipoObrigacao;
  responsavel: string;
  trecho: string;
  prazo_citado_dias: number | null;
  unidade?: "uteis" | "corridos" | "horas" | "meses" | "data_expressa" | null;
  prazo_texto?: string | null;
  alerta?: string | null;
}

const normalizar = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
const OFICIO = /\b(?:oficie-se|oficiem-se|expeca-se\s+(?:o\s+)?(?:oficio|mandado)\s+(?:a|ao|para)|encaminhe-se\s+(?:o\s+)?oficio\s+(?:a|ao|para))\s+(?:(?:a|o|as|os|ao|aos|para)\s+)?([^,.;]{3,90})/;
/** Ofícios a terceiros (empresa, cartório, hospital, órgão público). Ordem ao INSS/CEAB para implantar continua sendo implantação. */
export function identificarOficios(texto: string): ObrigacaoDetectada[] {
  const saida: ObrigacaoDetectada[] = [];
  for (const original of texto.split(/(?<=[.;])\s+|\n+/)) {
    const frase = semAcento(original);
    const m = OFICIO.exec(frase);
    if (!m || emHipotese(antes(frase, m.index)) || /\b(?:dispenso|desnecessari|indefiro|nao ha necessidade|sem necessidade)\b/.test(frase)) continue;
    const destino = m[1].replace(/\s+(?:para|a fim|que|solicitando|requisitando|requerendo|com|visando)\b.*$/, "").trim();
    if (destino.length < 3) continue;
    const previdencia = /^(?:inss|ceab|ceabdj|autarquia|agencia da previdencia|aps)\b/.test(destino);
    const implantacao = previdencia && /\b(?:implant|restabelec|tutela|cumpr|concess)\w*/.test(frase);
    if (previdencia && !implantacao && !/\b(?:processo administrativo|copia|informac|documento|prontuario)\w*/.test(frase)) continue;
    const prazo = /\b(?:prazo\s+de\s+|no\s+prazo\s+de\s+|em\s+)(\d{1,3})\s*(?:\([^)]*\)\s*)?dias?(?:\s+(uteis|corridos))?/.exec(frase);
    saida.push({
      tipo: implantacao ? "inss_implantacao" : "terceiro_oficio",
      responsavel: implantacao ? "INSS / autarquia" : `Terceiro oficiado: ${destino.slice(0, 60)}`,
      trecho: original.trim().slice(0, 600),
      prazo_citado_dias: prazo ? Math.min(365, Number(prazo[1])) : null,
      unidade: prazo ? (prazo[2] === "corridos" ? "corridos" : "uteis") : null,
      prazo_texto: prazo ? prazo[0].trim() : null,
      alerta: null,
    });
  }
  return saida;
}

/** Somente intimações/ordens explícitas, no mesmo trecho do destinatário e da providência. */
export function identificarObrigacoesExternas(texto: string): ObrigacaoDetectada[] {
  // Cópias rasas: quem chama não altera o resultado guardado.
  return memoTexto("obrigacoes", texto, identificarObrigacoesExternasSemCache).map((o) => ({ ...o }));
}
function identificarObrigacoesExternasSemCache(texto: string): ObrigacaoDetectada[] {
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
    if (!saida.has(tipo)) saida.set(tipo, { tipo, responsavel:ordem.destinatario, trecho:ordem.trecho, prazo_citado_dias:ordem.dias, unidade:ordem.unidade, prazo_texto:ordem.prazo_texto, alerta:ordem.alerta });
  }
  for (const oficio of identificarOficios(texto)) if (!saida.has(oficio.tipo)) saida.set(oficio.tipo, oficio);
  return [...saida.values()];
}

/** Do que trata a ordem, quando isso muda o que ela significa para o escritório (hoje: antecipação de honorários periciais). */
export type AssuntoDaOrdem = "honorarios_periciais";
export function assuntoDaOrdem(trecho: string): AssuntoDaOrdem | null {
  return /\b(?:honorarios\s+(?:periciais|do\s+perito|do\s+expert)|antecipa\w*\s+(?:dos\s+|de\s+)?honorarios|deposit\w*\s+(?:dos\s+|de\s+)?honorarios)\b/.test(normalizar(trecho)) ? "honorarios_periciais" : null;
}
/** A perícia andou (laudo ou esclarecimentos do perito já apresentados): os honorários dela necessariamente já foram tratados. */
export const periciaAndou = (texto: string) => laudoEfetivamenteJuntado(texto) || cumprimentoIdentificado("perito_esclarecimentos", texto);

/** Fato posterior explícito; não encerra o alerta por mera publicação nova. */
export function cumprimentoIdentificado(tipo: TipoObrigacao, texto: string, ordem = ""): boolean {
  if (tipo === "perito_laudo") return laudoEfetivamenteJuntado(texto);
  const pedido = normalizar(ordem);
  for (const s of memoTexto("sentencas-normalizadas", texto, (t) => t.split(/(?:[.;]\s+|\n+)/).filter(Boolean).map(normalizar))) {
    if (/\b(?:nao|ainda nao|sem|aguardando|aguarde-se|aguardar|apos|quando|caso|devera|deverao|sera|serao|para que|para comprovar|intime-se|intimado|intimada)\b/.test(s)) continue;
    const provas: Record<TipoObrigacao, RegExp> = {
      perito_laudo: /\b(?:laudo\b.{0,80}\b(?:juntad[oa]|apresentad[oa])|juntada do laudo|perit[oa]\b.{0,70}\b(?:juntou|apresentou)\b.{0,40}\blaudo)\b/,
      perito_esclarecimentos: /\b(?:esclarecimentos\b.{0,60}\b(?:prestados|apresentados|juntados)|perit[oa]\b.{0,60}\b(?:prestou|apresentou|juntou)\b.{0,40}\besclarecimentos|perit[oa]\b.{0,60}\bse manifestou|(?:manifestacao|complementacao)\b.{0,40}\b(?:do perito|pericial)\b.{0,60}\b(?:juntada|apresentada)|laudo complementar\b.{0,50}\bjuntado)\b/,
      perito_calculos: /\b(?:calculos\b.{0,60}\b(?:juntados|apresentados|elaborados)|perit[oa]\b.{0,70}\b(?:juntou|apresentou)\b.{0,30}\bcalculos)\b/,
      inss_implantacao: /\b(?:inss\b.{0,70}\bcomprovou\b.{0,50}\bimplantacao|beneficio\b.{0,40}\b(?:foi implantado|implantado|implementado|restabelecido))\b/,
      parte_contraria: /$^/,
      terceiro_oficio: /\bjuntad[oa]s?\b.{0,40}\b(?:resposta|informacoes|oficio)\b|\b(?:resposta|informacoes|oficio respondido|documentos?)\b.{0,60}\b(?:juntad[oa]s?|apresentad[oa]s?|prestad[oa]s?|recebid[oa]s?)\b|\b(?:oficiad[oa]|empresa|cartorio|hospital|empregador)\b.{0,60}\b(?:respondeu|juntou|apresentou|prestou|encaminhou)\b/,
    };
    if (tipo === "parte_contraria") {
      if (assuntoDaOrdem(ordem) === "honorarios_periciais" && (/\bhonorarios\b.{0,70}\b(?:depositados|pagos|recolhidos|antecipados|quitados)\b|\b(?:deposito|comprovante\b.{0,30}(?:deposito|pagamento))\b.{0,50}\bhonorarios\b/.test(s) || provas.perito_laudo.test(s) || provas.perito_esclarecimentos.test(s))) return true;
      if (/contrarrazo/.test(pedido) && /\bcontrarrazoes\b.{0,45}\b(?:apresentadas|juntadas)\b/.test(s)) return true;
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


