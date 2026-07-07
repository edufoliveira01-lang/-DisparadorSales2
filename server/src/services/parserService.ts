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
const FIELD_PATTERNS: Record<FieldName, RegExp> = {
  tipo: /^[ \t]*TIPO\s+DE\s+PER[IÍ]CIA\s*:?[ \t]*(.+)$/im,
  data: /^[ \t]*DATA\b\s*:?[ \t]*(.+)$/im,
  horario: /^[ \t]*HOR[AÁ]RIO\b\s*:?[ \t]*(.+)$/im,
  local: /^[ \t]*LOCAL\b\s*:?[ \t]*(.+)$/im,
  nome: /^[ \t]*NOME\b\s*:?[ \t]*(.+)$/im,
};

const MEDICA_HEADER = /PER[IÍ]CIA\s+M[EÉ]DICA\s*:?/i;
const SOCIAL_HEADER = /PER[IÍ]CIA\s+SOCIAL\s*:?/i;

function extractField(block: string, pattern: RegExp): string {
  const match = block.match(pattern);
  return match ? match[1].trim() : "";
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

/**
 * Extrai 1 ou 2 perícias da descrição de um card do Trello.
 * - Se houver cabeçalhos "PERÍCIA MÉDICA" e/ou "PERÍCIA SOCIAL", cada um vira um bloco.
 * - Se nenhum cabeçalho for encontrado, a descrição inteira é tratada como 1 perícia genérica.
 */
export function parseCardDescription(description: string): Pericia[] {
  if (!description || !description.trim()) return [];

  type Header = { index: number; end: number };
  const headers: Header[] = [];

  const medicaMatch = MEDICA_HEADER.exec(description);
  if (medicaMatch) {
    headers.push({ index: medicaMatch.index, end: medicaMatch.index + medicaMatch[0].length });
  }

  const socialMatch = SOCIAL_HEADER.exec(description);
  if (socialMatch) {
    headers.push({ index: socialMatch.index, end: socialMatch.index + socialMatch[0].length });
  }

  if (headers.length === 0) {
    return [extractPericiaFromBlock(description)];
  }

  headers.sort((a, b) => a.index - b.index);

  const pericias: Pericia[] = [];
  for (let i = 0; i < headers.length; i++) {
    const start = headers[i].end;
    const end = i + 1 < headers.length ? headers[i + 1].index : description.length;
    pericias.push(extractPericiaFromBlock(description.slice(start, end)));
  }
  return pericias;
}
