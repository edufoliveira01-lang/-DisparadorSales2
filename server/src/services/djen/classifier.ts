export const CATEGORIAS_DJEN = [
  "sentenca",
  "acordao",
  "pericia",
  "laudo_juntado",
] as const;
export type CategoriaDjen = (typeof CATEGORIAS_DJEN)[number];
export const RESULTADOS_DJEN = [
  "procedente",
  "improcedente",
  "parcial",
  "nao_identificado",
] as const;
export type ResultadoDjen = (typeof RESULTADOS_DJEN)[number];

export function textoDaPublicacao(html: string): string {
  return html
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<\/?(?:p|div|br|li|h[1-6]|tr)\b[^>]*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(x[\da-f]+|\d+);/gi, (_all, code: string) => {
      const value =
        code[0].toLowerCase() === "x"
          ? parseInt(code.slice(1), 16)
          : Number(code);
      return value > 0 && value <= 0x10ffff ? String.fromCodePoint(value) : "";
    })
    .replace(
      /&(nbsp|amp|lt|gt|quot|apos);/g,
      (_all, key: string) =>
        ({ nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" })[key]!,
    )
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n/g, "\n")
    .trim();
}
export function normalizarTexto(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/** Triagem por evidência explícita; não é análise de mérito nem substitui a revisão do inteiro teor. */
export function classificarPublicacao(texto: string, tipoDocumento = "") {
  const normal = normalizarTexto(texto),
    documento = normalizarTexto(tipoDocumento);
  const categorias: CategoriaDjen[] = [];
  const evidencias: { categoria: CategoriaDjen; trecho: string }[] = [];
  function detectar(categoria: CategoriaDjen, regex: RegExp, tipo: boolean) {
    const match = regex.exec(normal);
    if (!tipo && !match) return;
    categorias.push(categoria);
    evidencias.push({
      categoria,
      trecho: tipo
        ? `Tipo de documento informado pelo DJEN: ${tipoDocumento}`
        : texto.slice(
            Math.max(0, match!.index - 55),
            match!.index + match![0].length + 100,
          ),
    });
  }
  detectar(
    "sentenca",
    /(?:^|\n)\s*(?:sentenca|s e n t e n c a)\b|\bjulgo\s+(?:os?\s+pedidos?\s+|a\s+acao\s+)?(?:(?:parcialmente|totalmente)\s+)?(?:improcedentes?|procedentes?)\b|\b(?:intimad[oa]s?|ciencia)\b[^.\n]{0,90}\b(?:da sentenca proferida|da seguinte sentenca)\b/,
    /\bsentenca\b/.test(documento),
  );
  detectar(
    "acordao",
    /(?:^|\n)\s*(?:acordao|a c o r d a o)\b|\bacordam\s+(?:os|as|em|por)\b|\b(?:intimad[oa]s?|ciencia)\b[^.\n]{0,80}\bdo acordao\b/,
    /\bacordao\b/.test(documento),
  );
  detectar(
    "pericia",
    /\b(?:designad[ao]|agendad[ao]|redesignad[ao]|marcad[ao]|determin[oa]|defiro)\b[^.\n]{0,100}\b(?:pericia|prova pericial)\b|\bpericia\b[^.\n]{0,70}\b(?:designada|agendada|redesignada|marcada|realizada no dia)\b|\bnomeio\b[^.\n]{0,100}\bperit[oa]\b/,
    false,
  );
  // Não confunde ordem de juntar um laudo futuro com uma juntada já comunicada.
  const laudo =
    /\b(?:foi juntad[oa]|juntou-se|juntada d[eo]|juntad[oa] aos autos|apresentad[oa] aos autos)\b[^.\n]{0,80}\b(?:laudo pericial|laudo da pericia)\b|\b(?:laudo pericial|laudo da pericia)\b[^.\n]{0,60}\b(?:foi juntad[oa]|juntad[oa] aos autos|ja juntad[oa]|juntad[oa]\b)\b|\b(?:manifestem-se|manifestar-se|vista as partes|intimem-se as partes)\b[^.\n]{0,90}\b(?:laudo pericial|laudo da pericia)\b/;
  const matchLaudo = laudo.exec(normal);
  const contextoAnterior = matchLaudo
    ? normal.slice(Math.max(0, matchLaudo.index - 45), matchLaudo.index)
    : "";
  if (
    !/\b(?:apos|quando|caso|se houver|determin[oa]|aguarde-se|aguardar|nao houve|nao foi|nao|devera)\s+(?:a\s+)?$/.test(
      contextoAnterior,
    )
  )
    detectar("laudo_juntado", laudo, false);
  let resultado: ResultadoDjen = "nao_identificado";
  if (categorias.includes("sentenca")) {
    const dispositivos = [
      ...normal.matchAll(
        /\bjulgo\s+(?:os?\s+pedidos?\s+|a\s+acao\s+)?(?:(parcialmente|totalmente)\s+)?(improcedentes?|procedentes?)(\s+em\s+parte)?\b/g,
      ),
    ];
    const resultados = new Set(
      dispositivos.map((m) =>
        m[1] === "parcialmente" || m[3]
          ? "parcial"
          : m[2].startsWith("im")
            ? "improcedente"
            : "procedente",
      ),
    );
    if (resultados.size === 1) resultado = [...resultados][0] as ResultadoDjen;
  }
  return { categorias, evidencias, resultado };
}
