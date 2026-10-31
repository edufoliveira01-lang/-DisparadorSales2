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

/** Cancelamento literal da providência; não confunde revogação de multa com a ordem. */
export function obrigacaoRevogada(tipo: string, ordem: string, posteriores: string[]): boolean {
  const objeto = /\b(?:revogo|cancelo|dispenso|torno sem efeito)\s+(?:(?:a|o|as|os)\s+)?(?:intimacao|ordem|determinacao|exigencia|apresentacao|entrega|juntada|pericia|exame pericial|tutela|implantacao|esclarecimentos|calculos)\b|\b(?:intimacao|ordem|determinacao|exigencia|pericia|tutela)\b.{0,55}\b(?:fica|foi|esta)\s+(?:cancelad[oa]|revogad[oa]|dispensad[oa]|sem efeito)\b/;
  const alvos: Record<string, RegExp> = {
    perito_laudo: /\b(?:laudo|pericia|exame pericial)\b/,
    perito_esclarecimentos: /\b(?:esclarecimentos|complementacao|laudo complementar)\b/,
    perito_calculos: /\b(?:calculos|contadoria)\b/,
    inss_implantacao: /\b(?:implantacao|restabelecimento)\b/,
  };
  const pedido = normal(ordem);
  for (const texto of posteriores) for (const s of frasesAtuais(texto)) {
    if (!objeto.test(s) || /\b(?:nao|deixo de)\b.{0,35}\b(?:revogo|cancelo|dispenso|torno sem efeito)\b/.test(s)) continue;
    if (/\bsocial\b/.test(pedido) && /\bmedic[ao]\b/.test(s) && !/\bsocial\b/.test(s) || /\bmedic[ao]\b/.test(pedido) && /\bsocial\b/.test(s) && !/\bmedic[ao]\b/.test(s)) continue;
    if (tipo !== 'parte_contraria') { if (alvos[tipo]?.test(s)) return true; continue; }
    // Não transfere o cancelamento de uma manifestação à contestação/contrarrazões.
    const acoes = [/\bcontrarrazo\w*/, /\bcontesta\w*/, /\bdocument\w*/, /\bmanifest\w*/, /\bcalcul\w*/];
    if (/\b(?:inss|parte contraria|parte re|reu|requerid[oa])\b/.test(s) && acoes.some(re => re.test(pedido) && re.test(s))) return true;
  }
  return false;
}

/** Redesignação/cancelamento não significa perícia realizada sem laudo. */
export function periciaSuperada(posteriores: string[], data: string, origem: string, ativasNoProcesso: number): boolean {
  for (const texto of posteriores) for (const s of frasesAtuais(texto)) {
    if (/\b(?:nao|deixo de)\b.{0,30}\b(?:cancelo|dispenso|redesigno|revogo|torno sem efeito)\b/.test(s)) continue;
    if (origem === 'social' && /pericia medica/.test(s) && !/pericia social/.test(s) || origem === 'medica' && /pericia social/.test(s) && !/pericia medica/.test(s)) continue;
    const cancelada = /\b(?:cancelo|dispenso|torno sem efeito)\s+(?:(?:a|o)\s+)?(?:pericia|exame pericial)\b|\bpericia\b.{0,70}\b(?:fica|foi|esta)\s+(?:cancelada|dispensada|sem efeito)\b/.test(s);
    const remarcada = /\b(?:redesigno|remarco)\s+(?:(?:a|o)\s+)?(?:pericia|exame pericial)\b|\bpericia\b.{0,70}\b(?:foi|fica|esta)\s+(?:redesignada|remarcada)\b/.test(s);
    if (!cancelada && !remarcada) continue;
    const datas = [...s.matchAll(/\b(\d{2})\/(\d{2})\/(\d{4})\b/g)].map(m=>`${m[3]}-${m[2]}-${m[1]}`);
    // Havendo mais de uma perícia, exige referência expressa à data antiga.
    if (datas.includes(data) || ativasNoProcesso === 1 && (!datas.length || remarcada)) return true;
  }
  return false;
}
