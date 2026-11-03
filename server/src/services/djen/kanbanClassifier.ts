import { identificarOrdensProcessuais, ordemDoEscritorio, contextoNaoAtual } from "./proceduralOrders";
import { normalizarTexto } from "./classifier";
import { classificarComplementar } from "./classificacaoComplementar";

/**
 * A ordem é o "avanço" do processo: a etapa mais adiantada comprovada no histórico prevalece.
 * As quatro etapas situacionais logo após a triagem só valem quando o histórico não prova
 * nenhuma etapa processual (ver kanbanSituacao.ts); qualquer etapa real as supera.
 */
export const ETAPAS_AUTOMATICAS = [
  "triagem", "aguarda_juizo", "sobrestado", "aguarda_terceiros", "prov_escritorio",
  "peticao_inicial", "distribuicao", "emenda_inicial", "citacao_contestacao", "audiencia",
  "perito_designado", "pericia_agendada", "pericia_realizada", "laudo_manifestacoes", "proposta_acordo",
  "conclusos_sentenca", "sentenca", "recurso", "acordao", "transito_julgado",
  "cumprimento_sentenca", "aguarda_implantacao", "calculos", "penhora_bloqueio", "aguarda_expedicao_rpv",
  "rpv_expedida", "pagamento_alvara", "concluido",
] as const;
export const ETAPAS_SITUACIONAIS = ["aguarda_juizo", "sobrestado", "aguarda_terceiros", "prov_escritorio"] as const;
export type EtapaAutomatica = (typeof ETAPAS_AUTOMATICAS)[number];
export type SinalEtapa = { codigo: EtapaAutomatica; evidencia: string };
export const CATEGORIAS_LISTA_PERSONALIZADA = [
  "proposta_acordo", "homologacao_acordo", "precatorio", "extincao_execucao",
  "extincao_processo", "levantamento_valores", "decisao_interlocutoria", "despacho", "intimacao",
  "audiencia", "citacao_contestacao", "vista_laudo", "transito_julgado", "arquivamento",
] as const;
const canon = (s: string) => normalizarTexto(s).replace(/\s+/g, " ").trim();
const riscoFuturo = /\b(?:apos|quando|caso|se houver|eventual|hipotese|ainda nao|nao houve|nao foi|nao ha|nao consta|devera|deverao|sera|serao|a ser|para ser|aguarde-se)\b/;
const fatoAtual = (s: string, re: RegExp) => {
  const match = re.exec(s);
  return Boolean(match && !riscoFuturo.test(s.slice(Math.max(0, match.index - 65), match.index) + " " + match[0]));
};

/** Identifica atos atuais no inteiro teor, sem converter citação ou previsão em etapa concluída. */
export function classificarPublicacaoParaQuadro(texto: string): SinalEtapa | null {
  const partes = texto.split(/(?:[.;]\s+|\n+)/).filter(Boolean);
  const sinais: SinalEtapa[] = [];
  const adicionar = (codigo: EtapaAutomatica, trecho: string) => sinais.push({ codigo, evidencia: trecho.trim().slice(0, 230) });
  for (const ordem of identificarOrdensProcessuais(texto)) if (ordemDoEscritorio(ordem) && ordem.acao === "emenda_inicial") {
    const inicio = ordem.trecho.search(/emend[ae]/i);
    adicionar("emenda_inicial", ordem.trecho.slice(Math.max(0, inicio - 70), inicio + 160));
  }
  for (const trecho of partes) {
    const s = canon(trecho);
    if (s.length < 8 || contextoNaoAtual(s)) continue;
    if (/\b(?:distribuicao|distribuid[oa])\b.{0,100}\b(?:processo|acao|autos|feito|procedimento)\b|\b(?:processo|acao|autos|feito|procedimento)\b.{0,100}\b(?:distribuicao|distribuid[oa])\b/.test(s) &&
        !/\b(?:a distribuir|sera distribuid[oa]|aguarda distribuicao|apos distribuicao|distribuicao futura)\b/.test(s))
      adicionar("distribuicao", trecho);
    if (/\b(?:recebida|protocolada|distribuida)\b.{0,55}\b(?:peticao inicial|acao)\b|\b(?:peticao inicial|acao)\b.{0,55}\b(?:recebida|protocolada|distribuida)\b/.test(s))
      adicionar("peticao_inicial", trecho);
    if (/\b(?:nomeio|nomeado|nomeada|designo|designado|designada)\b.{0,70}\bperit[oa]\b|\bperit[oa]\b.{0,70}\b(?:nomeado|nomeada|designado|designada)\b/.test(s) && !/\b(?:a nomear|a designar|nomeacao pendente|perito anterior)\b/.test(s))
      adicionar("perito_designado", trecho);
    if (/\b(?:juntada|juntado|apresentada)\b.{0,55}\bmanifestacao do perito\b|\bmanifestacao do perito\b.{0,55}\b(?:juntada|juntado|apresentada)\b/.test(s))
      adicionar(/\b(?:laudo|esclarecimentos|complementacao)\b/.test(s) ? "laudo_manifestacoes" : "perito_designado", trecho);
    if (/\bpericia\b.{0,65}\b(?:foi realizada|realizou-se|ocorreu|foi efetuada)\b|\b(?:realizada|concluida)\s+a\s+pericia\b/.test(s) &&
        !/\b(?:sera|devera|quando|apos|se for|nao foi|nao ocorreu|aguarde-se)\b.{0,70}\bpericia\b/.test(s))
      adicionar("pericia_realizada", trecho);
    if (fatoAtual(s, /\b(?:juntad[oa]|apresentad[oa]|anexad[oa])\b.{0,90}\blaudo\b|\blaudo\b.{0,90}\b(?:juntad[oa]|apresentad[oa]|anexad[oa])\b|\b(?:vista|manifestacao|manifestar-se|esclarecimentos)\b.{0,80}\blaudo pericial\b/) &&
        !/\b(?:intime-se|intimado)\s+o\s+perito\b/.test(s))
      adicionar("laudo_manifestacoes", trecho);
    if (/\b(?:julgo|julg[oau]a?\s+procedente|julg[oau]a?\s+improcedente|sentenca\s+(?:proferida|publicada)|proferida\s+sentenca)\b/.test(s) &&
        !/\b(?:contra a sentenca|apos a sentenca|sentenca anterior|cita a sentenca|recurso da sentenca)\b/.test(s))
      adicionar("sentenca", trecho);
    if (/\b(?:interposto|apresentado|admitido|recebido)\b.{0,65}\b(?:recurso|apelacao|agravo)\b|\b(?:recurso|apelacao|agravo)\b.{0,65}\b(?:interposto|apresentado|admitido|recebido)\b|\b(?:contrarrazoes|contrarrazoar)\b.{0,60}\b(?:recurso|apelacao)\b/.test(s) &&
        !/\b(?:prazo para interpor|podera recorrer|eventual recurso|ainda nao interposto)\b/.test(s))
      adicionar("recurso", trecho);
    if (/\b(?:apelacao|recurso|agravo)\b.{0,90}\b(?:distribuid[oa]|distribuicao)\b|\b(?:distribuid[oa]|distribuicao)\b.{0,90}\b(?:apelacao|recurso|agravo)\b/.test(s) &&
        !/\b(?:a distribuir|sera distribuid[oa]|apos distribuicao|aguarda distribuicao)\b/.test(s))
      adicionar("recurso", trecho);
    if (/\b(?:acordam|acordaram|acordao\s+(?:proferido|publicado|juntado)|proferido\s+acordao|turma recursal\s+(?:julgou|decidiu))\b/.test(s) &&
        !/\b(?:precedente|jurisprudencia|acordao anterior|cita o acordao|apos o acordao)\b/.test(s))
      adicionar("acordao", trecho);
    if (/\b(?:inicio|iniciado|instaurado|em fase de|prosseguimento do)\s+(?:o\s+)?cumprimento de sentenca\b|\b(?:cumprimento de sentenca)\b.{0,50}\b(?:iniciado|instaurado|prosseguimento)\b/.test(s) &&
        !/\b(?:apos|quando|caso|futuro|podera|sera|eventual)\b/.test(s))
      adicionar("cumprimento_sentenca", trecho);
    if (/\b(?:inss|autarquia)\b.{0,100}\b(?:intimad[oa]|implante|implantar|implantacao)\b.{0,80}\b(?:beneficio|aposentadoria|pensao|auxilio)\b|\b(?:intime-se|intimado)\s+o\s+inss\b.{0,100}\b(?:implantar|restabelecer|conceder)\b/.test(s) &&
        /\b(?:intimad[oa]|intime-se|determino|implante|implantar)\b/.test(s) &&
        !/\b(?:foi implantado|ja implantado|comprovou a implantacao|nao foi intimado)\b/.test(s))
      adicionar("aguarda_implantacao", trecho);
    if (/\b(?:implantacao|revisao|restabelecimento)\b.{0,60}\bbeneficio\b.{0,80}\b(?:determinad[ao]|ordenad[ao])\b|\b(?:determinad[ao]|ordenad[ao])\b.{0,80}\b(?:implantacao|restabelecimento)\b.{0,60}\bbeneficio\b/.test(s) &&
        !/\b(?:nao foi determinada|se determinada|apos a implantacao|quando ocorrer)\b/.test(s))
      adicionar("aguarda_implantacao", trecho);
    if (/\b(?:perito de calculos|contador judicial|contadoria|fase de calculos|liquidacao de sentenca|apresentacao dos calculos|calculos apresentados|calculos homologados)\b/.test(s) &&
        !/\b(?:apos|quando|caso|se houver|eventual|ainda nao|nao foram apresentados)\b/.test(s))
      adicionar("calculos", trecho);
    if (fatoAtual(s, /\b(?:rpv|requisicao de pequeno valor|oficio requisitorio)\b.{0,70}\b(?:foi expedid[ao]|ja expedid[ao]|expedid[ao]|transmitid[ao]|enviad[ao])\b|\b(?:expedid[ao]|transmitid[ao])\b.{0,60}\b(?:rpv|requisicao de pequeno valor|oficio requisitorio)\b/) &&
        !/\b(?:determinada? a expedicao|expeca-se|requisite-se|aguardando expedicao)\b/.test(s))
      adicionar("rpv_expedida", trecho);
    else if (/\b(?:rpv|requisicao de pequeno valor|oficio requisitorio)\b/.test(s) &&
        /\b(?:expeca-se|determino\s+a\s+expedicao|determinada?\s+a\s+expedicao|aguardando\s+(?:a\s+)?expedicao|requisite-se|aguarda\s+expedicao|expedir\s+(?:a\s+)?rpv)\b/.test(s) &&
        !/\b(?:rpv|requisicao de pequeno valor)\b.{0,60}\b(?:foi expedida|ja expedida)\b/.test(s))
      adicionar("aguarda_expedicao_rpv", trecho);
    if (/\bextincao\b.{0,95}\b(?:anotada|certificada|decretada)\b.{0,120}\b(?:autos|processo)\s+arquivad[oa]s?\b|\b(?:autos|processo)\s+arquivad[oa]s?\b.{0,120}\bextincao\b/.test(s) &&
        !/\b(?:arquivamento provis[oa]rio|desarquivamento|futura extincao)\b/.test(s))
      adicionar("concluido", trecho);
  }
  // Categorias comprovadas literalmente pelo classificador complementar (mesma evidência da lista de publicações).
  const complementar = classificarComplementar(texto);
  const daCategoria: Partial<Record<string, EtapaAutomatica>> = {
    citacao_contestacao: "citacao_contestacao", audiencia: "audiencia", transito_julgado: "transito_julgado",
    recurso: "recurso", calculos: "calculos", implantacao_beneficio: "aguarda_implantacao",
    vista_laudo: "laudo_manifestacoes",
  };
  for (const e of complementar.evidencias) {
    const codigo = daCategoria[e.categoria];
    if (codigo && !(codigo === "calculos" && !/\b(?:contadoria|calculos?)\b/.test(canon(e.trecho)))) adicionar(codigo, e.trecho);
  }
  for (const trecho of partes) {
    const s = canon(trecho);
    if (s.length < 8 || contextoNaoAtual(s)) continue;
    // Homologação do acordo é decidida em sentença: entra na etapa Sentença.
    if (fatoAtual(s, /\b(?:homologo|homologad[oa])\b.{0,100}\b(?:acordo|transacao)\b|\b(?:acordo|transacao)\b.{0,60}\bhomologad[oa]\b/) &&
        !/\b(?:nao houve acordo|sem acordo|inexito|nao homologo|indefiro a homologacao)\b/.test(s))
      adicionar("sentenca", trecho);
    // Proposta de acordo apresentada (INSS ou parte contrária): o escritório precisa se manifestar.
    else if (fatoAtual(s, /\bproposta\s+de\s+acordo\b.{0,80}\b(?:apresentad|ofertad|formulad|aceit)\w*|\b(?:apresentou|ofereceu|formulou)\b.{0,40}\bproposta\s+de\s+acordo\b|\bmanifest\w+\b.{0,60}\bproposta\s+de\s+acordo\b/) &&
        !/\b(?:nao houve acordo|sem acordo|inexito)\b/.test(s))
      adicionar("proposta_acordo", trecho);
    // Execução fora do INSS: constrição de valores e pagamento/alvará (listas só para essas áreas).
    if (/\b(?:sisbajud|bacenjud|renajud|infojud|penhora\w*|bloqueio\s+(?:de\s+)?(?:valores|ativos|contas?)|constricao)\b/.test(s) &&
        /\b(?:realizad[oa]|efetivad[oa]|efetuad[oa]|procedid[oa]|positiv[oa]|negativ[oa]|determino|defiro|expeca-se|foi|resultou|restou|bloqueados?)\b/.test(s) &&
        !/\b(?:sob pena|pena de|caso|se nao|nao havendo|nao pagar|podera|poderao|devera|sera|apos|quando|eventual|requer)\b/.test(s))
      adicionar("penhora_bloqueio", trecho);
    if (/\b(?:alvara|levantamento\s+(?:de\s+)?(?:valores|deposito)|deposito\s+judicial|guia\s+de\s+deposito|quitacao|satisfeita\s+a\s+(?:execucao|obrigacao)|pagamento\s+(?:efetuado|realizado|integral|comprovado))\b/.test(s) &&
        !/\b(?:sera|devera|deverao|apos|quando|caso|se houver|eventual|requer|pedido de|nao foi)\b/.test(s))
      adicionar("pagamento_alvara", trecho);
    if (/\b(?:autos?|processo|feito)\s+conclus[oa]s?\s+(?:para|a|ao)\s+(?:sentenca|julgamento|decisao final|juiz)\b|\bconclusos?\s+para\s+(?:sentenca|julgamento)\b/.test(s) &&
        !/\b(?:apos|quando|caso|se houver|eventual|sera|devera)\b/.test(s))
      adicionar("conclusos_sentenca", trecho);
  }
  // Data, horário e local precisam constar do próprio texto; decisão que apenas
  // determina a perícia nunca vira agendamento (nem perícia realizada por passar a data).
  const s = canon(texto);
  const agenda = /\b(?:pericia\b.{0,400}\b(?:designada|agendada|redesignada|marcada|sera realizada)|(?:designada|agendada|redesignada|marcada|designo)\b.{0,100}\bpericia)\b.{0,450}/.exec(s)?.[0];
  if (agenda && /\b(?:\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+de\s+[a-z]+\s+de\s+\d{4})\b/.test(agenda) &&
      /\b\d{1,2}(?::\d{2}|h(?:\d{2})?)\b/.test(agenda) &&
      /\b(?:local|endereco|rua|avenida|foro|forum|sala|clinica|hospital|virtual|videoconferencia)\b/.test(agenda) &&
      !/\b(?:cancelada|desmarcada|a designar|sem data|data a definir|informe data)\b/.test(agenda))
    adicionar("pericia_agendada", texto.slice(Math.max(0, s.indexOf(agenda) - 20), Math.min(texto.length, s.indexOf(agenda) + 300)));
  if (!sinais.length) return null;
  return sinais.reduce((maisAvancado, atual) =>
    ETAPAS_AUTOMATICAS.indexOf(atual.codigo) > ETAPAS_AUTOMATICAS.indexOf(maisAvancado.codigo) ? atual : maisAvancado);
}

/** Reaproveita evidências já conferidas da análise DJEN, sem pedir outra execução da IA. */
export function classificarPublicacaoComHistorico(row: {
  texto: string; categorias_json: string; evidencias_json: string; classe?: string; revisada?: number;
}): SinalEtapa | null {
  let literal = classificarPublicacaoParaQuadro(row.texto);
  // A classe processual informada pelo DJEN define a fase do processo: um processo cuja classe é
  // "Cumprimento de Sentença" (ou execução contra a Fazenda) já está na fase de cumprimento, mesmo
  // que a intimação seja curta (expedição, ciência etc.). Atos mais específicos do texto (cálculos,
  // RPV, extinção) continuam prevalecendo por estarem mais adiantados na ordem das etapas.
  const classe = canon(row.classe || "");
  const ato = canon(row.texto);
  if (/\b(?:cumprimento (?:provisorio )?de sentenca|execucao (?:de sentenca|contra a fazenda|de titulo))\b/.test(classe)) {
    let contextual: SinalEtapa | null = null;
    if (/\b(?:intimad[oa]s?|intime-se|manifestar|manifestacao|impugnacao|apresentad[oa]s?|homologad[oa]s?)\b/.test(ato) &&
        /\bcalculos\b/.test(ato))
      contextual = { codigo: "calculos", evidencia: row.texto.slice(0, 230) };
    else if (/\b(?:exequente|executad[oa]s?|impugnacao|cumprimento de sentenca)\b/.test(ato) &&
             /\b(?:intimad[oa]s?|intime-se|manifestar|impugnacao|iniciado|prosseguimento)\b/.test(ato))
      contextual = { codigo: "cumprimento_sentenca", evidencia: row.texto.slice(0, 230) };
    // Sem ato específico: a própria classe comprova a fase (evidência identificada como classe processual).
    if (!contextual && !/\b(?:distribuicao|distribuid[oa]|peticao inicial)\b/.test(ato))
      contextual = { codigo: "cumprimento_sentenca", evidencia: `Classe processual: ${row.classe}` };
    if (contextual && (!literal || ETAPAS_AUTOMATICAS.indexOf(contextual.codigo) > ETAPAS_AUTOMATICAS.indexOf(literal.codigo)))
      literal = contextual;
  }
  // Fase indicada pela classe vale mesmo quando a classificação da publicação foi revisada
  // à mão (a revisão trata do ato publicado, não da classe do processo).
  const porClasse = Boolean(literal?.evidencia.startsWith("Classe processual:"));
  let categorias: unknown;
  let evidencias: unknown;
  try {
    categorias = JSON.parse(row.categorias_json);
    evidencias = JSON.parse(row.evidencias_json);
  } catch { return literal; }
  if (!Array.isArray(categorias) || !Array.isArray(evidencias)) return literal;
  const etapas: Record<string, EtapaAutomatica> = {
    sentenca: "sentenca", acordao: "acordao", laudo_juntado: "laudo_manifestacoes",
    pericia: "pericia_agendada",
    cumprimento_sentenca: "cumprimento_sentenca", extincao_processo: "concluido",
    extincao_execucao: "concluido", recurso: "recurso", emenda_inicial: "emenda_inicial",
    calculos: "calculos", implantacao_beneficio: "aguarda_implantacao",
    citacao_contestacao: "citacao_contestacao", audiencia: "audiencia", transito_julgado: "transito_julgado",
    proposta_acordo: "proposta_acordo", homologacao_acordo: "sentenca", vista_laudo: "laudo_manifestacoes",
  };
  // A revisão humana é a fonte da categoria, mesmo quando a IA não havia gerado
  // evidência para ela. Não reutiliza a prova de uma categoria removida na revisão.
  if (row.revisada) {
    if (porClasse && literal) return literal;
    const confirmadas = categorias.map((c) => etapas[c]).filter(Boolean) as EtapaAutomatica[];
    if (categorias.includes("rpv")) {
      const rpv = literal && ["aguarda_expedicao_rpv", "rpv_expedida", "concluido"].includes(literal.codigo) ? literal.codigo : "aguarda_expedicao_rpv";
      confirmadas.push(rpv);
    }
    if (confirmadas.length) {
      const codigo = confirmadas.reduce((a, b) => ETAPAS_AUTOMATICAS.indexOf(a) > ETAPAS_AUTOMATICAS.indexOf(b) ? a : b);
      return { codigo, evidencia: "Classificação revisada pelo usuário nesta publicação." };
    }
    const categoriaDaEtapa: Partial<Record<EtapaAutomatica, string>> = {
      sentenca: "sentenca", acordao: "acordao", pericia_agendada: "pericia",
      laudo_manifestacoes: "laudo_juntado", cumprimento_sentenca: "cumprimento_sentenca",
      aguarda_expedicao_rpv: "rpv", rpv_expedida: "rpv", recurso: "recurso", emenda_inicial: "emenda_inicial",
      calculos: "calculos", aguarda_implantacao: "implantacao_beneficio",
      citacao_contestacao: "citacao_contestacao", audiencia: "audiencia", transito_julgado: "transito_julgado",
      proposta_acordo: "proposta_acordo",
    };
    if (literal?.codigo === "proposta_acordo" && !categorias.some((c: unknown) => c === "proposta_acordo")) return null;
    if (literal && (literal.codigo === "concluido" || (categoriaDaEtapa[literal.codigo] && !categorias.includes(categoriaDaEtapa[literal.codigo])))) return null;
    return literal;
  }
  let melhor = literal;
  for (const item of evidencias) {
    if (!item || typeof item !== "object" || typeof item.categoria !== "string" ||
        typeof item.trecho !== "string" || !categorias.includes(item.categoria)) continue;
    const codigo = etapas[item.categoria];
    const prova = canon(item.trecho);
    // Evidências produzidas pela IA somente valem se forem trechos literais do DJEN.
    if (!codigo || prova.length < 15 || !canon(row.texto).includes(prova)) continue;
    const sinal = { codigo, evidencia: item.trecho.slice(0, 230) };
    if (!melhor || ETAPAS_AUTOMATICAS.indexOf(sinal.codigo) > ETAPAS_AUTOMATICAS.indexOf(melhor.codigo))
      melhor = sinal;
  }
  return melhor;
}

export function evidenciasDeCategorias(row: { texto: string; categorias_json: string; evidencias_json: string; revisada?: number }): { categoria: string; evidencia: string }[] {
  try {
    const categorias = JSON.parse(row.categorias_json) as unknown;
    const evidencias = JSON.parse(row.evidencias_json) as unknown;
    if (!Array.isArray(categorias) || !Array.isArray(evidencias)) return [];
    if (row.revisada) return categorias
      .filter((c) => CATEGORIAS_LISTA_PERSONALIZADA.includes(c))
      .map((categoria) => ({ categoria, evidencia: "Classificação revisada pelo usuário nesta publicação." }));
    const fonte = canon(row.texto);
    return evidencias.flatMap((item) => {
      if (!item || typeof item !== "object" || typeof item.categoria !== "string" || typeof item.trecho !== "string" ||
          !categorias.includes(item.categoria) || !CATEGORIAS_LISTA_PERSONALIZADA.includes(item.categoria as typeof CATEGORIAS_LISTA_PERSONALIZADA[number]) ||
          canon(item.trecho).length < 15 || !fonte.includes(canon(item.trecho))) return [];
      return [{ categoria: item.categoria, evidencia: item.trecho.slice(0, 230) }];
    });
  } catch { return []; }
}

