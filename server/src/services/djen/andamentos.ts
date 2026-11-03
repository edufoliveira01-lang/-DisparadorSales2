/**
 * Andamentos que mostram que o processo avançou além de uma etapa anterior
 * (perícia, instrução, prazo). Usado para não manter alertas obsoletos.
 *
 * Diferente da detecção antiga, a frase inteira não é descartada quando contém
 * "deverá/será/caso": a negação ou hipótese só vale quando aparece logo ANTES
 * do trecho que prova o fato. Dispositivos longos de sentença continuam
 * reconhecidos. Citações entre aspas nunca contam como ato atual.
 */
import { laudoEfetivamenteJuntado } from "./followUpPolicy";

export type TipoAndamento =
  | "sentenca"
  | "acordao"
  | "recurso"
  | "transito_julgado"
  | "cumprimento"
  | "requisicao_pagamento"
  | "laudo"
  | "acordo";

export interface AndamentoIdentificado {
  tipo: TipoAndamento;
  rotulo: string;
  evidencia: string;
}

export interface PublicacaoParaAndamento {
  texto: string;
  data?: string;
  categorias?: string[];
  tipo_documento?: string | null;
  classe?: string | null;
}

export const ROTULO_ANDAMENTO: Record<TipoAndamento, string> = {
  sentenca: "Sentença / julgamento",
  acordao: "Acórdão / julgamento colegiado",
  recurso: "Recurso ou contrarrazões",
  transito_julgado: "Trânsito em julgado",
  cumprimento: "Cumprimento de sentença / execução",
  requisicao_pagamento: "RPV / precatório",
  laudo: "Laudo juntado ou vista do laudo",
  acordo: "Acordo / transação homologada",
};

const normal = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();

/** Remove citações literais e transcrições, que não são o ato da publicação. */
function semCitacoes(texto: string) {
  return texto.replace(/[“«][\s\S]{0,2500}?[”»]/g, " ").replace(/"[^"\n]{0,2500}"/g, " ");
}

// Ressalvas que transformam o fato em hipótese, pedido ou negação. As curtas só
// valem quando aparecem imediatamente antes do trecho ("não julgo", "caso julgue");
// "Após análise dos autos, julgo procedente" continua sendo sentença.
const RESSALVA_PROXIMA =
  /\b(?:nao|sem|ainda nao|apos|quando|caso|requer(?:eu|endo)?|requerimento|solicita(?:ou)?|eventual(?:mente)?|pedido de|cabe|cabivel|podera|poderao|futur[ao]|aguard\w+)\s+(?:[a-z0-9]+\s+){0,2}$/;
const RESSALVA_AMPLA =
  /\b(?:havendo|sobrevindo|em caso de|se houver|hipotese|precedente|jurisprudencia|anteriormente|prazo para)\b[^.;!?]{0,70}$/;
export const emHipotese = (janela: string) =>
  RESSALVA_PROXIMA.test(janela.replace(/\b(?:neste|nesse|no|em tal|em todo|nos termos d[oe])\s+caso\b/g, " ")) || RESSALVA_AMPLA.test(janela);

interface Regra {
  tipo: TipoAndamento;
  re: RegExp;
  /** Ressalvas no trecho completo (antes e depois), além da janela anterior. */
  veto?: RegExp;
}

const REGRAS: Regra[] = [
  {
    tipo: "sentenca",
    re: /\bjulg(?:o|ou|ando|ada|ado|am)\b[^.;]{0,50}?\b(?:parcialmente\s+)?(?:improcedent|procedent)\w*(?:\s+em\s+parte)?|\bjulg(?:o|ou|ando|ada|ado)\b[^.;]{0,40}\b(?:pedidos?|acao|demanda|pretensao)\b[^.;]{0,30}\b(?:improcedent|procedent)\w*|\bjulg(?:o|ou|ando)\s+(?:parcialmente\s+)?extint[oa]s?\b|\bdeclaro\s+extint[oa]s?\b|\bresolv(?:o|endo|eu)\s+o\s+merito\b|\bsentenca\b[^.;]{0,30}\b(?:proferida|publicada|registrada|prolatada)\b|\b(?:proferi|prolatei)\s+sentenca\b|\bhomologo\b[^.;]{0,80}\b(?:desistencia|renuncia|reconhecimento)\b|\bsentenca\s+(?:de\s+)?(?:procedencia|improcedencia|extincao)\b/,
    veto: /\b(?:nao\s+julg|ainda\s+nao\s+julg|julgamento\s+(?:futuro|adiado|suspenso))\b/,
  },
  {
    tipo: "acordo",
    re: /\bhomologo\b[^.;]{0,100}\b(?:acordo|transacao|composicao)\b|\b(?:acordo|transacao)\b[^.;]{0,60}\bhomologad[oa]\b/,
  },
  {
    tipo: "acordao",
    re: /\bacordam\b|\bacordaram\b|\b(?:turma recursal|turma julgadora|colegiado|camara|turma)\b[^.;]{0,160}\b(?:deu|deram|negou|negaram|conheceu|conheceram|nao conheceu|nao conheceram|proveu|proveram)\b[^.;]{0,50}\b(?:provimento|recurso)\b|\bpor\s+(?:unanimidade|maioria)\b[^.;]{0,140}\b(?:recurso|provimento|julgamento|apelacao)\b|\bacordao\b[^.;]{0,40}\b(?:publicado|proferido|juntado|disponibilizado|lavrado)\b|\bementa\b[^.;]{0,200}\b(?:recurso|apelacao)\b/,
    veto: /\bdecisao\s+monocratica\b/,
  },
  {
    tipo: "recurso",
    re: /\b(?:recurso inominado|recurso de apelacao|apelacao|recurso|embargos? de declaracao|agravo(?: de instrumento| interno)?|recurso especial|recurso extraordinario|pedido de uniformizacao)\b[^.;]{0,70}\b(?:interpost\w*|apresentad\w*|recebid\w*|admitid\w*|conhecid\w*|protocolad\w*|juntad\w*|manejad\w*)\b|\b(?:interpost[oa]s?|apresentad[oa]s?|recebid[oa]s?|admitid[oa]s?|protocolad[oa]s?)\b[^.;]{0,40}\b(?:recurso inominado|apelacao|recurso|embargos? de declaracao|agravo)\b|\bcontrarrazoes\b|\bcontrarrazoar\b|\b(?:recebo|admito|conheco d[oa])\s+(?:o\s+)?(?:recurso|apelacao|embargos)\b|\b(?:nego|dou)\s+provimento\b|\brecurso\s+(?:foi\s+)?(?:provido|desprovido|improvido)\b/,
    veto: /\b(?:prazo para (?:interpor|recorrer|apelar)|podera recorrer|eventual recurso|ainda nao interposto|cabe recurso|desta decisao cabe|dessa decisao cabe|cabivel recurso|recurso cabivel)\b/,
  },
  {
    tipo: "transito_julgado",
    re: /\b(?:certifico|certidao)\b[^.;]{0,80}\btransito em julgado\b|\btransit(?:ou|ada|ado)\s+em\s+julgado\b|\btransito em julgado\b[^.;]{0,40}\b(?:ocorreu|ocorrido|certificado|verificado|operou-se)\b|\bbaixa definitiva\b|\barquivem-se os autos\b[^.;]{0,50}\bbaixa\b/,
    veto: /\b(?:apos|com o|logo apos|quando houver|havendo|ate o)\s+(?:o\s+)?transito\b/,
  },
  {
    tipo: "cumprimento",
    re: /\bcumprimento\s+(?:de|da)\s+sentenca\b[^.;]{0,90}\b(?:iniciad|instaurad|prosseguimento|impugnacao|exequente|intim|requerid|apresentad|distribuid)\w*|\b(?:inicio|instauracao|prosseguimento)\s+d[oae]\s+cumprimento\b|\b(?:intime-se|intimem-se)\b[^.;]{0,50}\b(?:para|a)\b[^.;]{0,40}\bimpugnar\b|\bimpugnacao\s+ao\s+cumprimento\b|\bexecucao\s+(?:contra a fazenda|de sentenca|invertida)\b|\bimplantacao\s+do\s+beneficio\b[^.;]{0,80}\b(?:comprovad|cumprid|implantad|efetivad)\w*|\bbeneficio\b[^.;]{0,50}\b(?:foi\s+)?(?:implantad|implementad|restabelecid)[oa]\b|\bcalculos?\b[^.;]{0,60}\b(?:homologad|apresentad|elaborad|juntad)\w*/,
  },
  {
    tipo: "requisicao_pagamento",
    re: /\b(?:rpv|requisicao de pequeno valor|oficio requisitorio|precatorio)\b[^.;]{0,80}\b(?:expedid|transmitid|enviad|pag[oa]|depositad|liberad|cadastrad)\w*|\b(?:expedid[oa]|transmitid[oa]|expeca-se|expeca-se-a)\b[^.;]{0,60}\b(?:rpv|requisicao de pequeno valor|oficio requisitorio|precatorio)\b|\balvara\b[^.;]{0,60}\b(?:expedid|levantamento)\w*/,
  },
];

/** Janela anterior ao trecho, limitada à mesma frase. */
export function antes(fonte: string, indice: number) {
  const trecho = fonte.slice(Math.max(0, indice - 110), indice);
  const fimFrase = Math.max(trecho.lastIndexOf("."), trecho.lastIndexOf(";"), trecho.lastIndexOf("!"), trecho.lastIndexOf("?"));
  return fimFrase >= 0 ? trecho.slice(fimFrase + 1) : trecho;
}

function inicioDaFrase(fonte: string, indice: number) {
  const trecho = fonte.slice(Math.max(0, indice - 140), indice);
  const fim = Math.max(trecho.lastIndexOf("."), trecho.lastIndexOf(";"), trecho.lastIndexOf("!"), trecho.lastIndexOf("?"));
  const inicioFrase = Math.max(0, indice - 140) + (fim >= 0 ? fim + 1 : 0);
  return fonte.slice(inicioFrase, indice + 120).trimStart();
}

/** Retorna o primeiro fato de avanço processual comprovado literalmente no texto. */
export function andamentosNoTexto(texto: string): AndamentoIdentificado[] {
  const fonte = normal(semCitacoes(texto));
  const saida: AndamentoIdentificado[] = [];
  for (const regra of REGRAS) {
    const global = new RegExp(regra.re.source, "g");
    for (const m of fonte.matchAll(global)) {
      const contexto = fonte.slice(Math.max(0, m.index! - 60), m.index! + m[0].length + 60);
      if (emHipotese(antes(fonte, m.index!))) continue;
      if (regra.tipo === "recurso" && /^(?:interpost|apresentad)\w*\s+(?:o\s+|a\s+)?(?:recurso|apelacao|embargos)\b[^.;]{0,25},/.test(inicioDaFrase(fonte, m.index!))) continue;
      if (regra.veto?.test(contexto)) continue;
      saida.push({ tipo: regra.tipo, rotulo: ROTULO_ANDAMENTO[regra.tipo], evidencia: m[0].slice(0, 200) });
      break;
    }
  }
  if (laudoEfetivamenteJuntado(texto) || /\b(?:vista|manifest\w+|ciencia|esclarecimentos?)\b[^.;]{0,60}\blaudo\b[^.;]{0,40}\b(?:juntad|apresentad|pericial)\w*/.test(fonte) && !emHipotese(antes(fonte, fonte.search(/\blaudo\b/))))
    saida.push({ tipo: "laudo", rotulo: ROTULO_ANDAMENTO.laudo, evidencia: "laudo pericial juntado ou com vista às partes" });
  return saida;
}

const CATEGORIAS_DE_AVANCO: Record<string, TipoAndamento> = {
  sentenca: "sentenca",
  extincao_processo: "sentenca",
  homologacao_acordo: "acordo",
  acordao: "acordao",
  recurso: "recurso",
  transito_julgado: "transito_julgado",
  cumprimento_sentenca: "cumprimento",
  implantacao_beneficio: "cumprimento",
  calculos: "cumprimento",
  extincao_execucao: "requisicao_pagamento",
  rpv: "requisicao_pagamento",
  precatorio: "requisicao_pagamento",
  levantamento_valores: "requisicao_pagamento",
  laudo_juntado: "laudo",
  vista_laudo: "laudo",
};

/**
 * Combina três fontes: texto literal, categorias já classificadas/revisadas e o
 * tipo documental da fonte (sentença/acórdão). Nenhuma delas isolada afirma que
 * houve laudo; apenas indicam que o processo avançou.
 */
export function andamentoDaPublicacao(pub: PublicacaoParaAndamento): AndamentoIdentificado | null {
  const doTexto = andamentosNoTexto(pub.texto);
  if (doTexto.length) return doTexto[0];
  for (const categoria of pub.categorias || []) {
    const tipo = CATEGORIAS_DE_AVANCO[categoria];
    if (tipo) return { tipo, rotulo: ROTULO_ANDAMENTO[tipo], evidencia: `classificada como ${categoria}` };
  }
  const documento = normal(pub.tipo_documento || "");
  if (/^sentenca\b/.test(documento)) return { tipo: "sentenca", rotulo: ROTULO_ANDAMENTO.sentenca, evidencia: "tipo documental: sentença" };
  if (/^acordao\b/.test(documento)) return { tipo: "acordao", rotulo: ROTULO_ANDAMENTO.acordao, evidencia: "tipo documental: acórdão" };
  const classe = normal(pub.classe || "");
  if (/\b(?:cumprimento de sentenca|execucao|requisicao de pequeno valor|precatorio)\b/.test(classe))
    return { tipo: "cumprimento", rotulo: ROTULO_ANDAMENTO.cumprimento, evidencia: `classe processual: ${pub.classe}` };
  return null;
}

/** Primeiro avanço entre publicações posteriores (qualquer ordem de entrada). */
export function primeiroAndamentoPosterior(posteriores: PublicacaoParaAndamento[]) {
  for (const pub of posteriores) {
    const andamento = andamentoDaPublicacao(pub);
    if (andamento) return { ...andamento, data: pub.data || null };
  }
  return null;
}
