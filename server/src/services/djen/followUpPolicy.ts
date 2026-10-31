import { createHash } from 'node:crypto';
/** Evidências literais do ato atual, sem usar o resumo/categoria da IA como prova. */
const normal = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export function frasesAtuais(texto: string): string[] {
  // Texto entre aspas e blocos identificados como precedente não é dispositivo atual.
  return texto.replace(/[“«][\s\S]*?[”»]/g, ' ').replace(/"[^"\n]*"/g, ' ')
    .split(/(?:[.;!?]\s+|\n+)/).map(normal).filter(s => s &&
      !/\b(?:jurisprudencia|precedente|transcrevo|sentenca anterior|decisao anterior|requer(?:eu)?|solicita(?:ou)?|se houver|caso|quando|eventual|hipotese|poder[aá]|devera|sera)\b/.test(s));
}
function detectarFase(texto: string): 'encerrada' | 'reaberta' | null {
  let fase: 'encerrada' | 'reaberta' | null = null;
  for (const s of frasesAtuais(texto)) {
    if (/\b(?:nao|deixo de)\b.{0,35}\b(?:julgo|homologo|declaro|anulo|casso|desconstituo|determino|designo)\b/.test(s)) continue;
    if (/\b(?:anulo|casso|desconstituo|torno sem efeito)\b.{0,100}\b(?:sentenca|julgamento)|\b(?:reabro|reabra-se)\b.{0,60}\binstrucao|\b(?:determino|defiro|designo)\b.{0,70}\b(?:nova pericia|reabertura da instrucao)\b/.test(s)) { fase = 'reaberta'; continue; }
    if (/\b(?:nao|sem|deixo de)\b.{0,35}\b(?:julgo|homologo|declaro)\b/.test(s)) continue;
    if (/\b(?:parcial do merito|homologacao parcial|acordo parcial|pedido incidental)\b/.test(s)) continue;
    const merito = /\bjulgo\s+(?:(?:o|a|os|as)\s+)?(?:pedido|pedidos|acao|demanda|pretensao)\s+(?:parcialmente\s+)?(?:procedentes?|improcedentes?)\b|\bjulgo\s+(?:parcialmente\s+)?(?:procedentes?|improcedentes?)\s+(?:(?:o|a|os|as)\s+)?(?:pedido|pedidos|acao|demanda|pretensao)\b/;
    const extincao = /\bjulgo\s+extint[oa]s?\s+(?:(?:o|a|os|as)\s+)?(?:processo|feito|acao|execucao)\b|\b(?:declaro|decreto)\b.{0,30}\bextincao\b.{0,35}\b(?:processo|feito|acao|execucao)\b/;
    if (merito.test(s) || extincao.test(s)) fase = 'encerrada';
  }
  return fase;
}
/** Recebe publicações posteriores, da mais recente para a mais antiga. */
export function instrucaoSuperada(posteriores: string[]): boolean {
  for (const texto of posteriores) {
    const fase = faseDaInstrucao(texto);
    if (fase) return fase === 'encerrada';
  }
  return false;
}
function detectarLaudo(texto: string): boolean {
  return frasesAtuais(texto).some(s => {
    // Uma intimação para manifestação SOBRE laudo já juntado também é prova.
    if (/\b(?:nao|sem|pendente|aguardando|aguarde-se|apos|a ser|ainda sera)\b.{0,80}\b(?:laudo|juntad|apresentad)|\blaudo\b.{0,60}\b(?:nao|pendente|a ser)\b/.test(s)) return false;
    return /\blaudo(?: pericial| medico| social| judicial)?\s+(?:(?:ja|foi|esta|devidamente)\s+)*(?:juntado|apresentado|anexado)\b|\b(?:juntada|apresentacao)\s+do\s+laudo\b|\bperit[oa]\b.{0,50}\b(?:juntou|apresentou)\b.{0,30}\blaudo\b/.test(s)
      && !/\b(?:para|devera|determino|intime-se)\b.{0,35}\b(?:juntada|apresentacao)\s+do\s+laudo/.test(s);
  });
}

// Cache limitado de fatos derivados de texto, sem guardar autos ou dados mutáveis.
const cache = new Map<string, { fase: ReturnType<typeof detectarFase>; laudo: boolean }>();
function fatos(texto: string) {
  const chave = createHash('sha256').update(texto, 'utf16le').digest('hex');
  const anterior = cache.get(chave);
  if (anterior) return anterior;
  const valor = { fase: detectarFase(texto), laudo: detectarLaudo(texto) };
  if (cache.size >= 2000) cache.delete(cache.keys().next().value!);
  cache.set(chave, valor);
  return valor;
}
export const faseDaInstrucao = (texto: string) => fatos(texto).fase;
export const laudoEfetivamenteJuntado = (texto: string) => fatos(texto).laudo;
