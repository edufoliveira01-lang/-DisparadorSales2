import { normalizarTexto } from "./classifier";

export const ETAPAS_AUTOMATICAS = [
  "triagem", "peticao_inicial", "emenda_inicial", "perito_designado", "pericia_agendada",
  "pericia_realizada", "laudo_manifestacoes", "sentenca", "recurso", "acordao",
  "cumprimento_sentenca", "aguarda_implantacao", "calculos", "aguarda_expedicao_rpv",
  "rpv_expedida", "concluido",
] as const;
export type EtapaAutomatica = (typeof ETAPAS_AUTOMATICAS)[number];
export type SinalEtapa = { codigo: EtapaAutomatica; evidencia: string };
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
  for (const trecho of partes) {
    const s = canon(trecho);
    if (s.length < 8) continue;
    if (/\b(?:recebida|protocolada|distribuida)\b.{0,55}\b(?:peticao inicial|acao)\b|\b(?:peticao inicial|acao)\b.{0,55}\b(?:recebida|protocolada|distribuida)\b/.test(s))
      adicionar("peticao_inicial", trecho);
    if (/\b(?:emende|emendar|emenda|emendada)\b.{0,80}\b(?:peticao inicial|inicial)\b|\b(?:peticao inicial|inicial)\b.{0,70}\b(?:emende|emenda|emendada)\b/.test(s) && !/\b(?:pedido de emenda indeferido|nao ha emenda)\b/.test(s))
      adicionar("emenda_inicial", trecho);
    if (/\b(?:nomeio|nomeado|nomeada|designo|designado|designada)\b.{0,70}\bperit[oa]\b|\bperit[oa]\b.{0,70}\b(?:nomeado|nomeada|designado|designada)\b/.test(s) && !/\b(?:a nomear|a designar|nomeacao pendente|perito anterior)\b/.test(s))
      adicionar("perito_designado", trecho);
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
