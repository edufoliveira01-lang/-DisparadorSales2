export interface Pericia {
  tipo: string;
  data: string;
  horario: string;
  local: string;
  nome: string;
  telefone: string;
}

type FieldName = keyof Pericia;

// Regex tolerantes: maiúsculas/minúsculas, acentuação opcional, ":" opcional,
// espaços extras. Ancoradas no início da linha para não confundir com texto solto.
// "tipo" aceita tanto "TIPO DE PERÍCIA:" quanto apenas "TIPO:" (formato usado quando
// o valor já é o próprio nome da perícia, ex: "TIPO: PERÍCIA MÉDICA").
const FIELD_PATTERNS: Record<FieldName, RegExp> = {
  tipo: /^[ \t]*TIPO(?:\s+DE\s+PER[IÍ]CIA)?\s*:?[ \t]*(.+)$/im,
  data: /^[ \t]*DATA\b\s*:?[ \t]*(.+)$/im,
  horario: /^[ \t]*HOR[AÁ]RIO\b\s*:?[ \t]*(.+)$/im,
  local: /^[ \t]*LOCAL\b\s*:?[ \t]*(.+)$/im,
  nome: /^[ \t]*NOME\b\s*:?[ \t]*(.+)$/im,
  telefone: /^[ \t]*TELEFONE\b\s*:?[ \t]*(.+)$/im,
};

// Cabeçalhos de bloco: só contam quando ocupam a linha inteira (opcionalmente com
// ":" no final), para não disparar um bloco falso quando "PERÍCIA MÉDICA" aparece
// apenas como valor de um campo (ex: "TIPO: PERÍCIA MÉDICA;").
const MEDICA_HEADER = /^[ \t]*PER[IÍ]CIA\s+M[EÉ]DICA\s*:?[ \t]*$/im;
const SOCIAL_HEADER = /^[ \t]*PER[IÍ]CIA\s+SOCIAL\s*:?[ \t]*$/im;

// Muitos cards colam, após os campos estruturados, o texto bruto do e-mail/intimação
// original (para referência). Tudo a partir desse marcador é ignorado pelo parser.
const CORTE_TEXTO_ORIGINAL = /EMAIL\s+ORIGINAL\s*:?/i;

function removerTextoOriginalColado(description: string): string {
  const match = CORTE_TEXTO_ORIGINAL.exec(description);
  return match ? description.slice(0, match.index) : description;
}

function extractField(block: string, pattern: RegExp): string {
  const match = block.match(pattern);
  if (!match) return "";
  // Remove pontuação de fechamento de lista (";", ",") que sobra quando os campos
  // são escritos como uma lista (ex: "NOME: Fulano;").
  return match[1].trim().replace(/[;,]+$/, "").trim();
}

function extractPericiaFromBlock(block: string): Pericia {
  return {
    tipo: extractField(block, FIELD_PATTERNS.tipo),
    data: extractField(block, FIELD_PATTERNS.data),
    horario: extractField(block, FIELD_PATTERNS.horario),
    local: extractField(block, FIELD_PATTERNS.local),
    nome: extractField(block, FIELD_PATTERNS.nome),
    telefone: extractField(block, FIELD_PATTERNS.telefone),
  };
}

/** Um card é considerado "descrição incompleta" quando algum dos 5 campos não foi encontrado. */
export function isPericiaCompleta(pericia: Pericia): boolean {
  return Boolean(pericia.tipo && pericia.data && pericia.horario && pericia.local && pericia.nome);
}

export type OrigemPericia = "medica" | "social" | "geral";
export interface PericiaComOrigem extends Pericia {
  origem: OrigemPericia;
}

function detectarOrigemPorTipo(valorTipo: string): OrigemPericia {
  if (/M[EÉ]DI/i.test(valorTipo)) return "medica";
  if (/SOCIAL/i.test(valorTipo)) return "social";
  return "geral";
}

interface BlockStart {
  origem: OrigemPericia;
  start: number;
}

/**
 * Extrai 1 ou 2 perícias da descrição de um card do Trello, junto com a origem
 * de cada uma — usada para os filtros do Dashboard. Dois formatos são suportados:
 *
 * 1. Com cabeçalho explícito ("PERÍCIA MÉDICA:" / "PERÍCIA SOCIAL:" em linha própria),
 *    cada cabeçalho inicia um bloco — o mais comum quando os campos vêm formatados
 *    manualmente com uma especialidade livre (ex: "TIPO DE PERÍCIA: Ortopédica").
 * 2. Sem cabeçalho, onde cada ocorrência do campo TIPO já começa uma nova perícia
 *    (ex: "TIPO: PERÍCIA MÉDICA;" seguido depois por "TIPO: PERÍCIA SOCIAL;") — usado
 *    quando o card não tem cabeçalho de bloco e o próprio campo TIPO diz qual é.
 *
 * Se nenhum dos dois padrões for encontrado, a descrição inteira é tratada como 1
 * perícia genérica.
 */
export function parseCardDescriptionComOrigem(description: string): PericiaComOrigem[] {
  if (!description || !description.trim()) return [];

  description = removerTextoOriginalColado(description);
  if (!description.trim()) return [];

  const blockStarts: BlockStart[] = [];

  const medicaRe = new RegExp(MEDICA_HEADER.source, "gim");
  const socialRe = new RegExp(SOCIAL_HEADER.source, "gim");
  const headerMatches: { origem: OrigemPericia; index: number; end: number }[] = [];
  for (const [re, origem] of [
    [medicaRe, "medica"],
    [socialRe, "social"],
  ] as const) {
    let m: RegExpExecArray | null;
    while ((m = re.exec(description))) {
      headerMatches.push({ origem, index: m.index, end: m.index + m[0].length });
    }
  }
  headerMatches.sort((a, b) => a.index - b.index);
  for (const h of headerMatches) blockStarts.push({ origem: h.origem, start: h.end });

  // Fora da região já coberta por um cabeçalho explícito (ou na descrição inteira,
  // se não houver nenhum), cada ocorrência do campo TIPO começa uma nova perícia.
  // Assume que TIPO é o primeiro campo de cada grupo quando não há cabeçalho.
  const regiaoSemCabecalho = headerMatches.length > 0 ? description.slice(0, headerMatches[0].index) : description;
  const tipoRe = new RegExp(FIELD_PATTERNS.tipo.source, "gim");
  let tipoMatch: RegExpExecArray | null;
  while ((tipoMatch = tipoRe.exec(regiaoSemCabecalho))) {
    blockStarts.push({ origem: detectarOrigemPorTipo(tipoMatch[1]), start: tipoMatch.index });
  }

  if (blockStarts.length === 0) {
    return [{ ...extractPericiaFromBlock(description), origem: "geral" }];
  }

  blockStarts.sort((a, b) => a.start - b.start);

  const pericias: PericiaComOrigem[] = [];
  for (let i = 0; i < blockStarts.length; i++) {
    const start = blockStarts[i].start;
    const end = i + 1 < blockStarts.length ? blockStarts[i + 1].start : description.length;
    pericias.push({ ...extractPericiaFromBlock(description.slice(start, end)), origem: blockStarts[i].origem });
  }
  return pericias;
}

/**
 * Extrai 1 ou 2 perícias da descrição de um card do Trello.
 * Veja `parseCardDescriptionComOrigem` para os formatos suportados.
 */
function parseBrazilianDate(dateStr: string, timeStr: string): number {
  try {
    const dateMatch = dateStr.match(/(\d{2})\/(\d{2})\/(\d{4})/);
    if (!dateMatch) return Infinity;

    const [, day, month, year] = dateMatch;
    const timeMatch = timeStr.match(/(\d{2}):(\d{2})/);
    const hours = timeMatch ? parseInt(timeMatch[1], 10) : 0;
    const minutes = timeMatch ? parseInt(timeMatch[2], 10) : 0;

    return new Date(parseInt(year, 10), parseInt(month, 10) - 1, parseInt(day, 10), hours, minutes).getTime();
  } catch {
    return Infinity;
  }
}

/**
 * Ordena um array de perícias pela data e hora mais próxima do momento atual.
 * Perícias com datas inválidas ou não identificadas ficam por último.
 */
export function sortPericiasByDate<T extends Pericia>(pericias: T[]): T[] {
  const now = Date.now();
  return [...pericias].sort((a, b) => {
    const timeA = parseBrazilianDate(a.data, a.horario);
    const timeB = parseBrazilianDate(b.data, b.horario);

    // Se ambas são inválidas, mantém a ordem original
    if (timeA === Infinity && timeB === Infinity) return 0;

    // Calcula a diferença absoluta em relação a 'agora'
    // O usuário quer a "mais próxima", o que geralmente significa a que vai acontecer logo ou a que acabou de acontecer.
    // No contexto de agendamento, geralmente priorizamos a data cronológica mais próxima (futura ou passada).
    const diffA = Math.abs(timeA - now);
    const diffB = Math.abs(timeB - now);

    return diffA - diffB;
  });
}

/**
 * Extrai 1 ou 2 perícias da descrição de um card do Trello.
 * Veja `parseCardDescriptionComOrigem` para os formatos suportados.
 */
export function parseCardDescription(description: string): Pericia[] {
  return parseCardDescriptionComOrigem(description).map(({ origem, ...pericia }) => pericia);
}
