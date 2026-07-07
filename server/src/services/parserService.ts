export interface Pericia {
  tipo: string;
  data: string;
  horario: string;
  local: string;
  nome: string;
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

/**
 * Extrai 1 ou 2 perícias da descrição de um card do Trello, junto com a origem
 * de cada uma (qual cabeçalho a gerou) — usada para os filtros do Dashboard.
 * - Se houver cabeçalhos "PERÍCIA MÉDICA" e/ou "PERÍCIA SOCIAL", cada um vira um bloco.
 * - Se nenhum cabeçalho for encontrado, a descrição inteira é tratada como 1 perícia genérica.
 */
export function parseCardDescriptionComOrigem(description: string): PericiaComOrigem[] {
  if (!description || !description.trim()) return [];

  description = removerTextoOriginalColado(description);
  if (!description.trim()) return [];

  type Header = { origem: OrigemPericia; index: number; end: number };
  const headers: Header[] = [];

  const medicaMatch = MEDICA_HEADER.exec(description);
  if (medicaMatch) {
    headers.push({ origem: "medica", index: medicaMatch.index, end: medicaMatch.index + medicaMatch[0].length });
  }

  const socialMatch = SOCIAL_HEADER.exec(description);
  if (socialMatch) {
    headers.push({ origem: "social", index: socialMatch.index, end: socialMatch.index + socialMatch[0].length });
  }

  if (headers.length === 0) {
    return [{ ...extractPericiaFromBlock(description), origem: "geral" }];
  }

  headers.sort((a, b) => a.index - b.index);

  const pericias: PericiaComOrigem[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].end;
    const end = i + 1 < headers.length ? headers[i + 1].index : description.length;
    pericias.push({ ...extractPericiaFromBlock(description.slice(start, end)), origem: headers[i].origem });
  }
  return pericias;
}

/**
 * Extrai 1 ou 2 perícias da descrição de um card do Trello.
 * - Se houver cabeçalhos "PERÍCIA MÉDICA" e/ou "PERÍCIA SOCIAL", cada um vira um bloco.
 * - Se nenhum cabeçalho for encontrado, a descrição inteira é tratada como 1 perícia genérica.
 */
export function parseCardDescription(description: string): Pericia[] {
  return parseCardDescriptionComOrigem(description).map(({ origem, ...pericia }) => pericia);
}
