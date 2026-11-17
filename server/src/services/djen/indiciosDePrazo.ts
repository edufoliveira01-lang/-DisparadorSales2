/**
 * INDÍCIOS DE PRAZO — o que a IA ou o texto citam como «N dias» quando o cálculo automático não confirmou nenhum período.
 *
 * O cálculo só nasce de uma ordem expressa e conferida. Quando o sistema não a confirma, a tela dizia «nenhum período confirmado» enquanto o resumo
 * da IA mostrava «15 dias úteis»: a pessoa ficava com dois recados opostos. Aqui o número citado vira um INDÍCIO (nunca um prazo): a tela o mostra
 * com o trecho e deixa a pessoa decidir se calcula, sem presumir.
 */
export interface IndicioDePrazo { dias: number; unidade: "uteis" | "corridos"; unidade_citada: boolean; trecho: string; origem: "ia" | "texto" }

const NUMEROS: Record<string, number> = { cinco: 5, dez: 10, quinze: 15, vinte: 20, trinta: 30, quarenta: 40 };

function varrer(texto: string, origem: IndicioDePrazo["origem"], out: IndicioDePrazo[]) {
  const re = /\b(\d{1,3}|cinco|dez|quinze|vinte|trinta|quarenta)\s*(?:\([^)]{0,40}\)\s*)?dias?\s*(?:(?:de\s+)?prazo\s*)?(\u00fateis|uteis|corridos)?/gi;
  for (const m of texto.matchAll(re)) {
    const bruto = m[1]!.toLowerCase();
    const dias = /^\d+$/.test(bruto) ? Number(bruto) : NUMEROS[bruto]!;
    if (!Number.isInteger(dias) || dias < 1 || dias > 365) continue;
    const citada = Boolean(m[2]);
    const unidade = /corrid/i.test(m[2] ?? "") ? "corridos" : "uteis";
    const inicio = Math.max(0, (m.index ?? 0) - 90);
    const trecho = texto.slice(inicio, (m.index ?? 0) + m[0].length + 90).replace(/\s+/g, " ").trim();
    // O prazo precisa estar na vizinhança de uma palavra de ordem/prazo; «há 30 dias» solto não é indício.
    if (!/\b(?:prazo|intim|manifest|emend|cumpr|apresent|recolh|justific|comprov|r[ée]plica|contrarraz|recurso|embargos)/i.test(trecho)) continue;
    if (!out.some((o) => o.dias === dias && o.unidade === unidade)) out.push({ dias, unidade, unidade_citada: citada, trecho, origem });
  }
}

export function indiciosDePrazo(p: { texto?: string; analise?: { resumo?: string; providencia?: { prazo_texto?: string | null; descricao?: string | null } } | null }): IndicioDePrazo[] {
  const out: IndicioDePrazo[] = [];
  const a = p.analise;
  if (a) varrer([a.providencia?.prazo_texto, a.providencia?.descricao, a.resumo].filter(Boolean).join(" . "), "ia", out);
  varrer(p.texto ?? "", "texto", out);
  return out.slice(0, 4);
}
