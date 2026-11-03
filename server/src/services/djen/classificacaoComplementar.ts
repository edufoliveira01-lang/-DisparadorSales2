/**
 * Classificação complementar determinística. Evita que andamentos comuns caiam em
 * "Outros" quando o próprio texto comprova o fato. Cada categoria exige um trecho
 * literal e atual; hipótese, pedido, negação e citação são ignorados.
 * Não substitui a revisão humana nem a análise de IA: só ADICIONA categorias.
 */
import { andamentosNoTexto, antes, emHipotese } from "./andamentos";
import { identificarOrdensProcessuais, ordemDoEscritorio } from "./proceduralOrders";
import { laudoEfetivamenteJuntado } from "./followUpPolicy";

export const CATEGORIAS_COMPLEMENTARES = [
  "recurso",
  "transito_julgado",
  "emenda_inicial",
  "citacao_contestacao",
  "audiencia",
  "implantacao_beneficio",
  "calculos",
  "vista_laudo",
  "arquivamento",
] as const;
export type CategoriaComplementar = (typeof CATEGORIAS_COMPLEMENTARES)[number];

export interface ClassificacaoComplementar {
  categorias: CategoriaComplementar[];
  evidencias: { categoria: CategoriaComplementar; trecho: string }[];
}

const canon = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

const REGRAS: Record<Exclude<CategoriaComplementar, "recurso" | "transito_julgado" | "emenda_inicial" | "vista_laudo">, { re: RegExp; veto?: RegExp }> = {
  citacao_contestacao: {
    re: /\b(?:cite-se|citem-se|determino a citacao|citacao\b[^.;]{0,40}\b(?:realizada|efetivada|positiva|cumprida)|citad[oa]s?\b[^.;]{0,40}\b(?:inss|reu|requerid[oa]|autarquia)|contestacao\b[^.;]{0,60}\b(?:apresentada|juntada|ofertada|anexada)|apresentou contestacao|replica\b[^.;]{0,40}\bcontestacao|(?:manifestar-se|manifeste-se|impugnar|impugne)\b[^.;]{0,50}\bcontestacao)\b/,
    veto: /\b(?:sem citacao|dispenso a citacao|dispensada a citacao|aguarda a citacao)\b/,
  },
  audiencia: {
    re: /\baudiencia\b[^.;]{0,100}\b(?:designad|marcad|redesignad|agendad|realizad|cancelad|sera realizada|fica designada|de (?:conciliacao|instrucao|julgamento))\w*|\b(?:designo|redesigno|marco|fica designada)\b[^.;]{0,60}\baudiencia\b/,
    veto: /\b(?:dispenso a audiencia|dispensada a audiencia|sem audiencia|nao designo audiencia|a designar|designacao futura)\b/,
  },
  implantacao_beneficio: {
    re: /\boficie-se\b[^.;]{0,60}\b(?:ceab|ceabdj|aps|inss|agencia da previdencia)\b[^.;]{0,100}\b(?:implant|restabelec|cumpr|tutela)\w*|\b(?:intime-se|intimem-se)\b[^.;]{0,30}\b(?:inss|autarquia|ceab)\b[^.;]{0,100}\b(?:implant|restabelec|conced)\w*|\bcomprov\w+\s+(?:a\s+)?implantacao\b|\bimplantacao\s+do\s+beneficio\b[^.;]{0,60}\b(?:comprovad|efetivad|realizad|cumprid)\w*|\bcumprimento\s+da\s+tutela\b|\bbeneficio\b[^.;]{0,40}\b(?:foi\s+)?(?:implantad|restabelecid)[oa]\b/,
    veto: /\b(?:nao foi implantad|ainda nao implantad|indefiro a implantacao)\b/,
  },
  calculos: {
    re: /\b(?:contadoria|calculos)\b[^.;]{0,80}\b(?:apresentad|elaborad|homologad|juntad|remet|intim|impugn|conferenc|atualiz)\w*|\b(?:remetam-se|encaminhem-se|ao)\b[^.;]{0,30}\bcontadoria\b|\bplanilha de calculos\b|\bapresentar\s+(?:os\s+)?calculos\b/,
  },
  arquivamento: {
    re: /\barquiv(?:em-se|e-se|amento)\b[^.;]{0,60}\b(?:autos|processo|feito|definitiv)\w*|\b(?:autos|processo|feito)\b[^.;]{0,40}\barquivad[oa]s?\b|\bbaixa definitiva\b/,
    veto: /\b(?:arquivamento provisorio|desarquiv|sobrestamento|sobrest|sem arquivar|nao arquiv)\w*/,
  },
};

const PARTE_MAX = 1100;

/** Divide o texto preservando o original, para citar o trecho literal. */
function partesDoTexto(texto: string): string[] {
  return texto.split(/\n+/).flatMap((p) => (p.length > PARTE_MAX ? p.match(/.{1,900}(?:\s|$)/g) || [p] : [p])).map((p) => p.trim()).filter((p) => p.length >= 15);
}

export function classificarComplementar(texto: string, contexto: { classe?: string } = {}): ClassificacaoComplementar {
  const categorias: CategoriaComplementar[] = [];
  const evidencias: ClassificacaoComplementar["evidencias"] = [];
  const adicionar = (categoria: CategoriaComplementar, trecho: string | undefined) => {
    if (!trecho || categorias.includes(categoria)) return;
    const t = trecho.trim().slice(0, 1200);
    if (t.length < 15) return;
    categorias.push(categoria);
    evidencias.push({ categoria, trecho: t });
  };
  const partes = partesDoTexto(texto);
  for (const parte of partes) {
    const fonte = canon(parte);
    for (const [categoria, regra] of Object.entries(REGRAS) as [keyof typeof REGRAS, { re: RegExp; veto?: RegExp }][]) {
      if (categorias.includes(categoria)) continue;
      const m = regra.re.exec(fonte);
      if (!m || regra.veto?.test(fonte) || emHipotese(antes(fonte, m.index))) continue;
      adicionar(categoria, parte);
    }
    for (const andamento of andamentosNoTexto(parte)) {
      if (andamento.tipo === "recurso") adicionar("recurso", parte);
      if (andamento.tipo === "transito_julgado") adicionar("transito_julgado", parte);
    }
    if (!categorias.includes("vista_laudo") && !laudoEfetivamenteJuntado(parte)) {
      const m = /\b(?:manifest\w+|vista|ciencia|impugn\w+|esclarecimentos?)\b[^.;]{0,60}\blaudo\b(?:\s+(?:pericial|medico|social|complementar))?/.exec(fonte);
      if (m && !emHipotese(antes(fonte, m.index)) && !/\b(?:intime-se|intimem-se)\s+o\s+perito\b|\bprazo\s+para\s+(?:entrega|apresentacao)\s+do\s+laudo\b/.test(fonte))
        adicionar("vista_laudo", parte);
    }
  }
  for (const ordem of identificarOrdensProcessuais(texto))
    if (ordemDoEscritorio(ordem) && ordem.acao === "emenda_inicial") adicionar("emenda_inicial", ordem.trecho);
  // A classe processual ajuda, mas só vale com um ato concreto no texto.
  if (/\bcumprimento de sentenca\b/.test(canon(contexto.classe || "")) && !categorias.includes("calculos")) {
    const parte = partes.find((p) => /\bcalculos?\b/.test(canon(p)) && /\b(?:intim|manifest|impugn|apresent)/.test(canon(p)));
    adicionar("calculos", parte);
  }
  return { categorias, evidencias };
}
