/**
 * Área do processo, detectada automaticamente e corrigível pelo usuário.
 *
 * Sinais, do mais forte ao mais fraco: ramo da Justiça no número CNJ (posição "J"), classe e órgão
 * informados pelo DJEN e menções nas publicações recentes. É uma heurística: o usuário pode fixar a
 * área e o sistema não a sobrescreve (area_manual).
 */
export const AREAS = ["previdenciario", "trabalhista", "bancario", "civel"] as const;
export type Area = (typeof AREAS)[number];
export const ROTULO_AREA: Record<Area, string> = {
  previdenciario: "Previdenciário",
  trabalhista: "Trabalhista",
  bancario: "Bancário",
  civel: "Cível / outros",
};
export const ehArea = (v: unknown): v is Area => typeof v === "string" && (AREAS as readonly string[]).includes(v);

export interface EntradaArea {
  chave: string;
  publicacoes: { tribunal?: string | null; orgao?: string | null; classe?: string | null; texto?: string | null }[];
}
export interface ResultadoArea { area: Area; motivo: string }

const canon = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
// "Vara de Acidentes do Trabalho" é matéria previdenciária/acidentária, não Justiça do Trabalho.
const semAcidentes = (s: string) => s.replace(/acidentes?\s+(?:do|de)\s+trabalho/g, " ").replace(/acidente\s+de\s+trabalho/g, " ");

const TRABALHISTA_ORGAO = /\b(?:vara do trabalho|turma do trabalho|tribunal regional do trabalho|justica do trabalho|trt)\b|\btrt[- ]?\d/;
const TRABALHISTA_CLASSE = /\b(?:reclamacao trabalhista|acao trabalhista|acao civil publica trabalhista|execucao trabalhista|cumprimento de sentenca trabalhista|agravo de peticao|recurso ordinario trabalhista|rito sumarissimo|rito ordinario trabalhista|homologacao de acordo extrajudicial)\b/;
const TRABALHISTA_TEXTO = /\b(?:reclamante|reclamad[oa]|reclamacao trabalhista|verbas rescisorias|vinculo empregaticio|horas extras|fgts|rescisao indireta|adicional de insalubridade|adicional de periculosidade)\b/;
const PREVIDENCIARIO = /\b(?:inss|instituto nacional do seguro social|ceab(?:dj)?|autarquia previdenciaria|beneficio previdenciario|auxilio[- ]doenca|auxilio[- ]acidente|aposentadoria|pensao por morte|loas|bpc|beneficio assistencial|incapacidade laborativa|incapacidade laboral|salario[- ]maternidade|revisao da vida toda|tempo de contribuicao)\b/;
const PREVIDENCIARIO_ORGAO = /\b(?:acidentes? do trabalho|previdenci|juizado especial federal|jef)\b/;
const BANCARIO_CLASSE = /\b(?:busca e apreensao|alienacao fiduciaria|revisional de contrato|contrato bancario|cedula de credito|cartao de credito|emprestimo|financiamento|consignado|execucao de titulo extrajudicial|monitoria|cheque)\b/;
const BANCARIO_TEXTO = /\b(?:banco|instituicao financeira|financeira|cooperativa de credito|cartao de credito|emprestimo consignado|contrato de financiamento|cedula de credito|cheque especial|tarifas bancarias|juros abusivos|capitalizacao de juros|negativacao|serasa|spc|scpc)\b/;

/** Ramo da Justiça pelo CNJ NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos): 5 trabalho, 4 federal, 8 estadual. */
export function ramoDaJustica(chave: string): string | null {
  return /^\d{20}$/.test(chave) ? chave[13] : null;
}

export function detectarArea(entrada: EntradaArea): ResultadoArea {
  const recentes = entrada.publicacoes.slice(0, 6);
  const classes = canon(recentes.map((p) => p.classe || "").join(" | "));
  const orgaos = semAcidentes(canon(recentes.map((p) => `${p.orgao || ""} ${p.tribunal || ""}`).join(" | ")));
  const textos = semAcidentes(canon(recentes.map((p) => (p.texto || "").slice(0, 4000)).join(" | ")));
  const classesSem = semAcidentes(classes);

  if (ramoDaJustica(entrada.chave) === "5") return { area: "trabalhista", motivo: "Número CNJ da Justiça do Trabalho" };
  if (TRABALHISTA_ORGAO.test(orgaos) || TRABALHISTA_CLASSE.test(classesSem))
    return { area: "trabalhista", motivo: "Classe ou órgão da Justiça do Trabalho" };
  if (PREVIDENCIARIO_ORGAO.test(canon(recentes.map((p) => p.orgao || "").join(" | "))) || PREVIDENCIARIO.test(classes) || PREVIDENCIARIO.test(textos))
    return { area: "previdenciario", motivo: "INSS, benefício ou órgão previdenciário/acidentário" };
  if (TRABALHISTA_TEXTO.test(textos)) return { area: "trabalhista", motivo: "Partes e matéria trabalhistas nas publicações" };
  if (BANCARIO_CLASSE.test(classes) || BANCARIO_TEXTO.test(textos)) return { area: "bancario", motivo: "Instituição financeira ou contrato bancário" };
  return { area: "civel", motivo: "Sem sinais das demais áreas" };
}
