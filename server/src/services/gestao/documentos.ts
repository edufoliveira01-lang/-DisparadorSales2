import crypto from "node:crypto";
import fs from "node:fs";
import { db } from "../../db";
import { ErroGestao } from "./erro";
import { contextoDoDocumento } from "./modelos";
import { lerEscritorio, type Escritorio, type Testemunha } from "./escritorio";
import { imagemAtual, logoAtual } from "./fichaConfig";

/**
 * Kit de documentos do escritório (procuração, hipossuficiência, contrato, declaração e termo) em três variações:
 * comum, a rogo (assina outra pessoa, com duas testemunhas e a digital) e "neste ato representado por…".
 * Os textos ficam editáveis (Configurações → Documentos) e o resultado sai com nome, logotipo e rodapé do escritório,
 * em tela/impressão (HTML) ou em Word (.docx).
 */
export const VARIANTES = ["comum", "rogo", "representado"] as const;
export type Variante = typeof VARIANTES[number];
export const ROTULO_VARIANTE: Record<Variante, string> = { comum: "Comum", rogo: "A rogo", representado: "Neste ato representado por…" };

export const DOCS = [
  { id: "procuracao", nome: "Procuração", pt: 10.5, titulo: 14 },
  { id: "hipossuficiencia", nome: "Declaração de hipossuficiência", pt: 14, titulo: 18 },
  { id: "contrato", nome: "Contrato de prestação de serviços", pt: 9, titulo: 11 },
  { id: "declaracao_honorarios", nome: "Declaração de honorários não adiantados", pt: 14, titulo: 16 },
  { id: "termo_ciencia", nome: "Termo de ciência e responsabilidade", pt: 14, titulo: 18 },
] as const;
export type DocId = typeof DOCS[number]["id"];
const SUBLINHADOS: string[] = ["hipossuficiencia", "declaracao_honorarios"];

// ---------- blocos (estrutura neutra, usada pelo HTML e pelo Word) ----------
export interface Trecho { t: string; b?: boolean }
export type Alinhamento = "j" | "c" | "r" | "l";
export type Bloco =
  | { k: "titulo"; texto: string; pt: number; sublinhado: boolean }
  | { k: "p"; trechos: Trecho[]; align: Alinhamento; pt: number }
  | { k: "caixa"; trechos: Trecho[]; align: Alinhamento; pt: number }
  | { k: "vazio"; n: number }
  | { k: "assinatura"; nome: string; extra: string[]; pt: number }
  | { k: "rogo"; assina: string; extra: string[]; testemunhas: Testemunha[]; polegar: string; pt: number }
  | { k: "testemunhas"; itens: Testemunha[]; pt: number };
export interface DocumentoMontado { id: string; nome: string; blocos: Bloco[] }
export interface ImagemKit { dados: Buffer; mime: string }
export interface Kit { escritorio: Escritorio; nomeExibicao: string; logo: ImagemKit | null; rodapeImagem: ImagemKit | null; alinhaCabecalho: "left" | "center" | "right"; alinhaRodape: "left" | "center" | "right"; rodape: string[]; documentos: DocumentoMontado[]; faltando: string[] }

// ---------- textos padrão ----------
const PODERES_ESPECIFICOS_COMUM = `**PODERES ESPECÍFICOS:** A presente procuração outorga aos Advogados acima descritos os poderes especiais para receber citação, confessar, reconhecer a procedência do pedido, transigir, desistir, firmar compromissos ou acordos, RENUNCIAR DIREITOS, receber e dar quitação, cadastrar e alterar senhas, acessar o sistema gov.br, levantar ou receber RPV – Requisição de Pequeno Valor, precatórios e alvarás, pedir e declarar isenção de imposto de renda, pedir e declarar a justiça gratuita, em conformidade com a norma do art. 105 da Lei 13.105/2015, podendo ainda substabelecer, com ou sem reserva de poderes.`;
const LGPD = `Considerando a Lei Geral de Proteção de Dados, o (a) OUTORGANTE declara ter ciência da necessidade dos dados aqui coletados e dá consentimento do uso dos seus dados pelos OUTORGADOS, em observância ao cumprimento das regras quanto a proteção de dados, diante dos princípios da necessidade, finalidade e/ou autodeterminação informativa, inclusive no tratamento de dados pessoais sensíveis, de acordo obrigação legal de coleta dos dados.`;

const PROCURACAO_COMUM = `# PROCURAÇÃO

> "ad-judicia" e "et extra"

> **OUTORGANTE:** {{outorgante.qualificacao}}, pelo presente instrumento particular de mandato, constitui e nomeia como seu procurador o advogado:

**OUTORGADOS:** {{outorgados.lista}}, {{outorgados.vinculo}} da sociedade de advogados inscrita na {{escritorio.oab_sociedade}} denominada **{{escritorio.razao_social}}**, inscrita no cadastro de pessoa jurídica – CNPJ sob o nº {{escritorio.cnpj}}, todos com escritório na {{escritorio.endereco}}, a quem confere amplos poderes para o foro em geral, em qualquer Juízo, Tribunal, e Repartições Públicas e particulares, junto ao INSS e Agências Bancárias, seguradoras, empresas particulares, públicas e privadas, com poderes ilimitados, com cláusula "ad-judicia" e "et extra", podendo propor ação contra quem de direito e defendê-lo nas contrárias.

${LGPD}

${PODERES_ESPECIFICOS_COMUM}`;

const PROCURACAO_ROGO = `# PROCURAÇÃO

> "ad-judicia" e "et extra"

> **OUTORGANTE:** {{outorgante.qualificacao}}, pelo presente instrumento particular de procuração a rogo, constitui e nomeia como seu procurador o advogado:

**OUTORGADO:** {{outorgados.lista}}, {{outorgados.vinculo}} da sociedade de advogados inscrita na {{escritorio.oab_sociedade}} denominada {{escritorio.razao_social}}, todos com escritório na {{escritorio.endereco}}.

**PODERES:** por este instrumento particular de procuração a rogo, conforme art. 595, do CC e entendimento do CNJ nos autos do Procedimento Administrativo nº 0001464-74.2009.2.00.0000, subscrito por duas testemunhas, constituo meus bastantes procuradores o outorgado, concedendo-lhe os poderes da cláusula "ad-judicia" e "et extra", para o foro em geral, podendo promover quaisquer medidas judiciais ou administrativas, em qualquer instância, assinar termo, e praticar ainda, todos e quaisquer atos necessários e convenientes ao bom e fiel desempenho deste mandato.

**PODERES ESPECÍFICOS:** A presente procuração outorga aos Advogados acima descritos, os poderes especiais para **representar o requerente perante o INSS**, receber citação, confessar, reconhecer a procedência do pedido, transigir, desistir, renunciar ao direito sobre que se funda a ação, firmar compromissos ou acordos, receber valores, receber e dar quitação, levantar ou receber RPV e ALVARÁS, pedir a justiça gratuita e assinar declaração de hipossuficiência econômica, em conformidade com a norma do art. 105 da Lei 13.105/2015, podendo ainda substabelecer, com ou sem reserva de poderes.

{{a_rogo.qualificacao}}, pessoa de confiança do outorgante, assina em face deste não conseguir escrever, o qual chancela na presente procuração a impressão digital de seu polegar direito, consoante o estabelecido no artigo 595 do Código Civil, visto que a procuração feita em cartório é onerosa ao trabalhador desempregado e que passa por dificuldades financeiras. **FINALIDADE:** Propor AÇÃO PREVIDENCIÁRIA`;

const HIPOSSUFICIENCIA = `# DECLARAÇÃO HIPOSSUFICIÊNCIA

{{outorgante.qualificacao}}, desejando obter os benefícios da "Justiça Gratuita", declara que não possui recursos suficientes para custear qualquer demanda, sem prejuízo do sustento próprio e da família, pelo que, nos termos da Lei nº 1.060 de 05 de fevereiro de 1950, faz jus aos benefícios da gratuidade da Justiça.`;

const CONTRATO = `# CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS

Entre o advogado {{advogado_principal.nome}}, inscrito na {{advogado_principal.oab}} - CPF nº {{advogado_principal.cpf}}, e a sociedade de advogados inscrita na {{escritorio.oab_sociedade}} denominada {{escritorio.razao_social}}, inscrita no cadastro de pessoa jurídica – CNPJ sob o nº {{escritorio.cnpj}}, doravante denominados **CONTRATADOS**, e **CONTRATANTE:**

> {{outorgante.qualificacao}}

1º – O CONTRATADO, na qualidade de advogado, obriga-se a:

REQUERER E REVISAR BENEFICIO PREVIDENCIÁRIO, NA ESFERA ADMINISTRATIVA (INSS) E/OU INGRESSAR COM AÇÃO JUDICIAL PERTINENTE CONTRA O INSS;

2º Na CONCESSAO/ IMPLANTAÇÃO/ TUTELA ANTECIPADA DE BENEFICIO PREVIDENCIARIO, decorrente de ação judicial e/ou na esfera administrativa, o CONTRATANTE pagará honorários equivalente ao valor de {{honorarios.beneficios}} benefícios recebidos pelo autor, calculados sobre o valor atualizado na implantação. O valor dos benefícios será pago em parcelas mensais, no importe de {{honorarios.parcela}} do valor do benefício, ressalvada negociação entre as partes.

3º – O CONTRATANTE, cumulativamente com artigo 2º, pagará honorários equivalente a {{honorarios.percentual}} do valor bruto referente as parcelas vencidas auferida nas ações, calculado sobre o valor atualizado, decorrente de concessão via ação judicial e/ou na esfera administrativa;

4º - Os honorários devidos à sucumbência pagos pela ré, pertencerão única e exclusivamente ao contratado, nos termos do art. 23 do Estatuto da OAB, Lei 8.906/94.

5º - No caso de revogação dos poderes, após o requerimento do benefício ou ingresso da ação, serão devidos na integralidade os honorários contratuais, e devido o valor descrito no §2 a título de multa. Fica acordado, entre as partes que, em caso de necessidade de ajuizamento de ações relativas a esse instrumento, a citação se dará por via postal, com aviso de recebimento (AR);

6º - Fica eleito o foro da {{escritorio.foro}}, para questões judiciais deste contrato, não obstante qualquer mudança de domicílio.

7º – Por estarem deste modo, certos e ajustados, na melhor forma de Direito, subscrevem o presente, juntamente com as testemunhas abaixo.

**Declaram as partes que nenhum valor foi adiantado a título de honorários.**

**O Contratante declara ter recebido nesta data 1(uma) via deste contrato.**`;

const DECLARACAO_HONORARIOS = `# DECLARAÇÃO

{{outorgante.qualificacao}}, declara expressamente que não adiantou os honorários fixados em {{honorarios.percentual}} do valor bruto auferido na ação, conforme contrato em anexo.`;

const termo = (verbo: string) => `# TERMO DE CIÊNCIA E RESPONSABILIDADE

{{outorgante.qualificacao}}, ${verbo} estar ciente que o escritório {{escritorio.nome}}, situado no endereço conforme consta neste documento **não solicita nenhum tipo de pagamento de forma adiantada** seja para: Liberação de RPV, precatórios ou isenção de imposto para receita por exemplo. Ao receber uma mensagem solicitando que efetue qualquer tipo de pagamento, seja por boleto, PIX ou depósito devo entrar em contato antes de qualquer ação para verificar a autenticidade de tal informação.

Confira sempre se corresponde ao nosso número oficial antes de passar qualquer informação confidencial. Nossos meios de contato oficiais são: **{{escritorio.telefones}}**{{escritorio.email_complemento}}`;

export const TEXTOS_PADRAO: Record<DocId, Record<Variante, string>> = {
  procuracao: { comum: PROCURACAO_COMUM, rogo: PROCURACAO_ROGO, representado: PROCURACAO_COMUM },
  hipossuficiencia: { comum: HIPOSSUFICIENCIA, rogo: HIPOSSUFICIENCIA, representado: HIPOSSUFICIENCIA },
  contrato: { comum: CONTRATO, rogo: CONTRATO, representado: CONTRATO },
  declaracao_honorarios: { comum: DECLARACAO_HONORARIOS, rogo: DECLARACAO_HONORARIOS, representado: DECLARACAO_HONORARIOS },
  termo_ciencia: { comum: termo("declaro"), rogo: termo("declara"), representado: termo("declara") },
};

export const VARIAVEIS_DOCUMENTO = [
  "outorgante.qualificacao", "cliente.nome", "cliente.cpf", "cliente.rg", "cliente.estado_civil", "cliente.profissao", "cliente.endereco", "cliente.qualificacao",
  "representante.qualificacao", "representante.nome", "representante.qualidade", "a_rogo.qualificacao", "a_rogo.nome",
  "outorgados.lista", "outorgados.vinculo", "advogado_principal.nome", "advogado_principal.oab", "advogado_principal.cpf",
  "escritorio.nome", "escritorio.razao_social", "escritorio.oab_sociedade", "escritorio.cnpj", "escritorio.endereco", "escritorio.cidade", "escritorio.foro", "escritorio.telefones", "escritorio.email",
  "honorarios.beneficios", "honorarios.parcela", "honorarios.percentual", "processo.numero", "data.local", "data.extenso",
];

// ---------- configuração editável ----------
export interface HonorariosPadrao { beneficios: number; percentual: number; parcela: number }
/** Documento criado pelo escritório, que passa a fazer parte do kit (mesmo cabeçalho, rodapé e assinatura). */
export interface DocumentoProprio { id: string; nome: string; texto: string; pt: number; assinatura: boolean }
export interface ConfigDocumentos { textos: Partial<Record<DocId, Partial<Record<Variante, string>>>>; tamanhos: Partial<Record<DocId, number>>; honorarios: HonorariosPadrao; proprios: DocumentoProprio[] }
const HONORARIOS_PADRAO: HonorariosPadrao = { beneficios: 3, percentual: 30, parcela: 30 };

function lerBruto(): ConfigDocumentos {
  const l = db.prepare("SELECT config_json FROM gestao_documentos_config WHERE id=1").get() as { config_json: string } | undefined;
  let c: Partial<ConfigDocumentos> = {};
  try { c = l ? JSON.parse(l.config_json) : {}; } catch { /* corrompido: volta ao padrão */ }
  const textos: ConfigDocumentos["textos"] = {}, tamanhos: ConfigDocumentos["tamanhos"] = {};
  for (const d of DOCS) {
    for (const v of VARIANTES) {
      const t = c.textos?.[d.id]?.[v];
      if (typeof t === "string" && t.trim()) (textos[d.id] ??= {})[v] = t.slice(0, 20000);
    }
    const pt = Number(c.tamanhos?.[d.id]);
    if (Number.isFinite(pt) && pt >= 7 && pt <= 18) tamanhos[d.id] = Math.round(pt * 2) / 2;
  }
  const h = c.honorarios ?? HONORARIOS_PADRAO;
  const num = (x: unknown, padrao: number, max: number) => { const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 100) / 100 : padrao; };
  const proprios: DocumentoProprio[] = (Array.isArray(c.proprios) ? c.proprios : []).slice(0, 30).map((x): DocumentoProprio | null => {
    const o = x as Partial<DocumentoProprio>;
    const nome = String(o?.nome ?? "").replace(/\*\*/g, "").trim().slice(0, 80), texto = String(o?.texto ?? "").slice(0, 20000);
    const pt = Number(o?.pt);
    return /^x_[a-z0-9]{6,12}$/.test(String(o?.id)) && nome && texto.trim() ? { id: String(o!.id), nome, texto, pt: Number.isFinite(pt) && pt >= 7 && pt <= 18 ? Math.round(pt * 2) / 2 : 11, assinatura: o?.assinatura !== false } : null;
  }).filter((x): x is DocumentoProprio => x !== null);
  return { textos, tamanhos, proprios, honorarios: { beneficios: num(h.beneficios, 3, 99), percentual: num(h.percentual, 30, 100), parcela: num(h.parcela, 30, 100) } };
}
export function lerConfigDocumentos() {
  const c = lerBruto();
  const textos = Object.fromEntries(DOCS.map((d) => [d.id, Object.fromEntries(VARIANTES.map((v) => [v, c.textos[d.id]?.[v] ?? TEXTOS_PADRAO[d.id][v]]))])) as Record<DocId, Record<Variante, string>>;
  const personalizados = Object.fromEntries(DOCS.map((d) => [d.id, VARIANTES.filter((v) => c.textos[d.id]?.[v] !== undefined)])) as Record<DocId, Variante[]>;
  const tamanhos = Object.fromEntries(DOCS.map((d) => [d.id, c.tamanhos[d.id] ?? d.pt])) as Record<DocId, number>;
  return { textos, personalizados, tamanhos, honorarios: c.honorarios, proprios: c.proprios };
}
function gravar(c: ConfigDocumentos) {
  db.prepare("INSERT INTO gestao_documentos_config(id,config_json) VALUES (1,?) ON CONFLICT(id) DO UPDATE SET config_json=excluded.config_json,atualizado_em=CURRENT_TIMESTAMP").run(JSON.stringify(c));
}
export function salvarConfigDocumentos(d: unknown) {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new ErroGestao("Configuração inválida.");
  const entrada = d as Partial<ConfigDocumentos>;
  const atual = lerBruto();
  for (const doc of DOCS) {
    for (const v of VARIANTES) {
      const t = entrada.textos?.[doc.id]?.[v];
      if (typeof t !== "string") continue;
      if (t.trim().length < 5) throw new ErroGestao(`O texto de "${doc.nome}" (${ROTULO_VARIANTE[v]}) não pode ficar vazio.`);
      if (t.length > 20000) throw new ErroGestao(`O texto de "${doc.nome}" é grande demais.`);
      if (t === TEXTOS_PADRAO[doc.id][v]) delete atual.textos[doc.id]?.[v]; else (atual.textos[doc.id] ??= {})[v] = t;
    }
    const pt = entrada.tamanhos?.[doc.id];
    if (pt !== undefined) { if (Number(pt) === doc.pt) delete atual.tamanhos[doc.id]; else atual.tamanhos[doc.id] = Number(pt); }
  }
  if (entrada.honorarios) atual.honorarios = { ...atual.honorarios, ...entrada.honorarios };
  gravar(atual);
  return lerConfigDocumentos();
}
export function restaurarTexto(doc: string, variante: string) {
  const d = DOCS.find((x) => x.id === doc);
  if (!d || !(VARIANTES as readonly string[]).includes(variante)) throw new ErroGestao("Documento inválido.");
  const atual = lerBruto();
  delete atual.textos[d.id]?.[variante as Variante];
  gravar(atual);
  return lerConfigDocumentos();
}

function dadosDoProprio(d: unknown, atual?: DocumentoProprio): DocumentoProprio {
  if (!d || typeof d !== "object" || Array.isArray(d)) throw new ErroGestao("Dados inválidos.");
  const o = d as Record<string, unknown>;
  const nome = String(o.nome ?? atual?.nome ?? "").replace(/\*\*/g, "").trim().slice(0, 80);
  const texto = String(o.texto ?? atual?.texto ?? "");
  if (nome.length < 3) throw new ErroGestao("Dê um nome ao documento (mínimo 3 letras).");
  if (texto.trim().length < 10) throw new ErroGestao("Escreva o texto do documento.");
  if (texto.length > 20000) throw new ErroGestao("O texto do documento é grande demais.");
  const pt = Number(o.pt ?? atual?.pt ?? 11);
  return { id: atual?.id ?? `x_${crypto.randomBytes(5).toString("hex")}`, nome, texto, pt: Number.isFinite(pt) && pt >= 7 && pt <= 18 ? Math.round(pt * 2) / 2 : 11, assinatura: o.assinatura === undefined ? atual?.assinatura ?? true : o.assinatura !== false };
}
export function criarDocumentoProprio(d: unknown) {
  const c = lerBruto();
  if (c.proprios.length >= 30) throw new ErroGestao("Limite de 30 documentos próprios.");
  const novo = dadosDoProprio(d);
  c.proprios.push(novo); gravar(c);
  return { documento: novo, ...lerConfigDocumentos() };
}
export function atualizarDocumentoProprio(id: string, d: unknown) {
  const c = lerBruto();
  const i = c.proprios.findIndex((x) => x.id === id);
  if (i < 0) throw new ErroGestao("Documento não encontrado.", 404);
  c.proprios[i] = dadosDoProprio(d, c.proprios[i]); gravar(c);
  return lerConfigDocumentos();
}
export function excluirDocumentoProprio(id: string) {
  const c = lerBruto();
  if (!c.proprios.some((x) => x.id === id)) throw new ErroGestao("Documento não encontrado.", 404);
  c.proprios = c.proprios.filter((x) => x.id !== id); gravar(c);
  return lerConfigDocumentos();
}

// ---------- montagem ----------
const MESES_EXTENSO = ["zero", "um", "dois", "três", "quatro", "cinco", "seis", "sete", "oito", "nove", "dez", "onze", "doze", "treze", "quatorze", "quinze", "dezesseis", "dezessete", "dezoito", "dezenove"];
const DEZENAS = ["", "", "vinte", "trinta", "quarenta", "cinquenta", "sessenta", "setenta", "oitenta", "noventa"];
export function numeroPorExtenso(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 100) return String(n);
  if (n < 20) return MESES_EXTENSO[n];
  if (n === 100) return "cem";
  return DEZENAS[Math.floor(n / 10)] + (n % 10 ? ` e ${MESES_EXTENSO[n % 10]}` : "");
}
const fmtNum = (n: number) => String(n).replace(".", ",");

export interface Qualificacao { nome: string; nacionalidade: string; estado_civil: string; profissao: string; rg: string; cpf: string; endereco: string; qualidade: string }
export interface OpcoesKit {
  pessoaId?: number; processoId?: number; variante: Variante; documentos: string[]; data: "hoje" | "branco";
  honorarios?: Partial<HonorariosPadrao>; representante?: Partial<Qualificacao>; a_rogo?: Partial<Qualificacao>; testemunhas_rogo?: Testemunha[];
}
const limpo = (v: unknown, max = 300) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim().slice(0, max);
const BLANK = "________";

function qualificar(q: { nome: string; nacionalidade?: string; estado_civil?: string; profissao?: string; rg?: string; cpf?: string; endereco?: string }, pj = false) {
  const digitos = String(q.cpf ?? "").replace(/\D/g, "");
  const cnpj = pj || digitos.length === 14;
  const partes = [
    `**${limpo(q.nome) || BLANK}**`, limpo(q.nacionalidade) || "brasileiro(a)", limpo(q.estado_civil), limpo(q.profissao),
    `portador(a) da cédula de identidade RG nº ${limpo(q.rg, 40) || BLANK}`,
    `inscrito(a) no ${cnpj ? "CNPJ" : "CPF/MF"} sob o nº ${limpo(q.cpf, 30) || BLANK}`,
    `residente ${limpo(q.endereco, 250) ? `na ${limpo(q.endereco, 250)}` : `na ${BLANK}`}`,
  ].filter(Boolean);
  return partes.join(", ");
}
function trechos(texto: string): Trecho[] {
  return texto.split("**").map((t, i) => ({ t, b: i % 2 === 1 })).filter((x) => x.t !== "");
}
function substituir(texto: string, v: Record<string, string>, faltando: Set<string>) {
  return texto.replace(/\{\{\s*([a-z_.]+)\s*\}\}/g, (_m, chave: string) => {
    const valor = v[chave];
    if (valor !== undefined && valor !== "") return valor;
    if (valor === undefined || valor === "") { if (!chave.endsWith("_complemento")) faltando.add(chave); }
    return chave.endsWith("_complemento") ? "" : BLANK;
  });
}
function paraBlocos(texto: string, doc: typeof DOCS[number], pt: number): Bloco[] {
  const saida: Bloco[] = [];
  for (const bruto of texto.split(/\n{2,}/)) {
    const b = bruto.trim();
    if (!b) continue;
    if (b.startsWith("# ")) { saida.push({ k: "titulo", texto: b.slice(2).replace(/\*\*/g, ""), pt: doc.titulo, sublinhado: SUBLINHADOS.includes(doc.id) }); continue; }
    if (b.startsWith("> ")) { const t = b.slice(2); saida.push({ k: "caixa", trechos: trechos(t), align: t.replace(/\*\*/g, "").length < 60 ? "c" : "j", pt: t.replace(/\*\*/g, "").length < 60 ? Math.max(8, pt - 2) : pt }); continue; }
    saida.push({ k: "p", trechos: trechos(b), align: "j", pt });
  }
  return saida;
}

function dadosDaPessoa(opcoes: { pessoaId?: number; processoId?: number }, nomeUsuario: string) {
  if (!opcoes.pessoaId && !opcoes.processoId) throw new ErroGestao("Escolha o cliente ou o processo.");
  const ctx = contextoDoDocumento(opcoes, nomeUsuario);
  if (!ctx["cliente.nome"]) throw new ErroGestao("Este processo ainda não tem um cliente (autor) vinculado.");
  return ctx;
}

export function montarKit(opcoes: OpcoesKit, nomeUsuario: string, exemplo = false): Kit {
  if (!(VARIANTES as readonly string[]).includes(opcoes.variante)) throw new ErroGestao("Tipo de documento inválido.");
  const cfg = lerConfigDocumentos();
  const todos: { id: string; nome: string; pt: number; titulo: number; proprio?: DocumentoProprio }[] = [...DOCS.map((d) => ({ ...d })), ...cfg.proprios.map((p) => ({ id: p.id, nome: p.nome, pt: p.pt, titulo: 14, proprio: p }))];
  const escolhidos = todos.filter((d) => opcoes.documentos.includes(d.id));
  if (escolhidos.length === 0) throw new ErroGestao("Marque ao menos um documento.");
  const esc = lerEscritorio();
  const faltando = new Set<string>();
  const ctx: Record<string, string> = exemplo
    ? { "cliente.nome": "NOME DO CLIENTE", "cliente.cpf": "000.000.000-00", "cliente.rg": "00.000.000-0", "cliente.estado_civil": "casado(a)", "cliente.profissao": "profissão", "cliente.endereco": "Rua do Exemplo, 100, Bairro, Cidade/UF, CEP 00000-000", "data.extenso": "1 de janeiro de 2026", "processo.numero": "0000000-00.2026.0.00.0000" }
    : dadosDaPessoa({ pessoaId: opcoes.pessoaId, processoId: opcoes.processoId }, nomeUsuario);
  const v: Record<string, string> = {};
  for (const [k, val] of Object.entries(ctx)) v[k] = limpo(val, 600);
  const cliente = { nome: v["cliente.nome"], estado_civil: v["cliente.estado_civil"], profissao: v["cliente.profissao"], rg: v["cliente.rg"], cpf: v["cliente.cpf"], endereco: v["cliente.endereco"] };
  v["cliente.qualificacao"] = qualificar(cliente);

  const rep = opcoes.representante ?? {}, rogo = opcoes.a_rogo ?? {};
  if (opcoes.variante === "representado" && !limpo(rep.nome)) throw new ErroGestao("Informe o nome de quem representa o cliente.");
  if (opcoes.variante === "rogo" && !limpo(rogo.nome)) throw new ErroGestao("Informe o nome de quem assina a rogo.");
  v["representante.nome"] = limpo(rep.nome); v["representante.qualidade"] = limpo(rep.qualidade) || "representante legal";
  v["representante.qualificacao"] = qualificar({ ...rep, nome: rep.nome ?? "" });
  v["a_rogo.nome"] = limpo(rogo.nome); v["a_rogo.qualificacao"] = qualificar({ ...rogo, nome: rogo.nome ?? "" });
  v["outorgante.qualificacao"] = opcoes.variante === "representado"
    ? `${v["cliente.qualificacao"]}, neste ato representado(a) por ${v["representante.qualificacao"]}, na qualidade de ${v["representante.qualidade"]}`
    : v["cliente.qualificacao"];

  const adv = esc.advogados;
  v["outorgados.lista"] = adv.map((a) => {
    const fem = /dra/i.test(a.tratamento);
    return `**${a.tratamento} ${a.nome.toUpperCase()}**, ${a.nacionalidade || "brasileiro(a)"}${a.estado_civil ? `, ${a.estado_civil}` : ""}, ${fem ? "inscrita" : "inscrito"} na ${a.oab || BLANK}, e CPF nº ${a.cpf || BLANK}`;
  }).join(" e ");
  v["outorgados.vinculo"] = adv.length > 1 ? "o primeiro sócio, os demais associados" : "sócio(a)";
  const p = adv[0];
  v["advogado_principal.nome"] = p?.nome.toUpperCase() ?? ""; v["advogado_principal.oab"] = p?.oab ?? ""; v["advogado_principal.cpf"] = p?.cpf ?? "";
  const nomeEscritorio = esc.nome || esc.razao_social;
  Object.assign(v, {
    "escritorio.nome": nomeEscritorio, "escritorio.razao_social": esc.razao_social.toUpperCase(), "escritorio.oab_sociedade": esc.oab_sociedade ? `OAB/${esc.uf || "UF"} ${esc.oab_sociedade}` : "",
    "escritorio.cnpj": esc.cnpj, "escritorio.endereco": esc.endereco, "escritorio.cidade": esc.cidade, "escritorio.telefones": esc.telefones.join(", "), "escritorio.email": esc.email,
    "escritorio.email_complemento": esc.email ? `, email: ${esc.email}` : "",
    "escritorio.foro": esc.foro || (esc.cidade ? `Comarca de ${esc.cidade}${esc.uf ? `/${esc.uf}` : ""}` : ""),
  });
  const h = { ...cfg.honorarios, ...Object.fromEntries(Object.entries(opcoes.honorarios ?? {}).filter(([, x]) => Number.isFinite(Number(x)) && Number(x) >= 0).map(([k, x]) => [k, Number(x)])) } as HonorariosPadrao;
  v["honorarios.beneficios"] = `${fmtNum(h.beneficios)} (${numeroPorExtenso(h.beneficios)})`;
  v["honorarios.percentual"] = `${fmtNum(h.percentual)}% (${numeroPorExtenso(h.percentual)} por cento)`;
  v["honorarios.parcela"] = `${fmtNum(h.parcela)}%`;
  const cidade = esc.cidade || BLANK;
  v["data.local"] = opcoes.data === "branco" ? `${cidade}, ______ de ________________ de 20____` : `${cidade}, ${v["data.extenso"]}`;

  const testemunhasEscritorio = [0, 1].map((i) => esc.testemunhas[i] ?? { nome: "", cpf: "" });
  const testemunhasRogo = [0, 1].map((i) => {
    const t = opcoes.testemunhas_rogo?.[i];
    return t && limpo(t.nome) ? { nome: limpo(t.nome, 120).toUpperCase(), cpf: limpo(t.cpf, 20) } : { nome: testemunhasEscritorio[i].nome.toUpperCase(), cpf: testemunhasEscritorio[i].cpf };
  });
  const nomeCliente = v["cliente.nome"].toUpperCase();

  const documentos = escolhidos.map((d): DocumentoMontado => {
    const pt = d.proprio ? d.proprio.pt : cfg.tamanhos[d.id as DocId];
    const texto = d.proprio ? (/^\s*# /.test(d.proprio.texto) ? d.proprio.texto : `# ${d.proprio.nome}\n\n${d.proprio.texto}`) : cfg.textos[d.id as DocId][opcoes.variante];
    const corpo = paraBlocos(substituir(texto, v, faltando), d as typeof DOCS[number], pt);
    const contrato = d.id === "contrato";
    const extraContratado = contrato ? [`CONTRATADO: ${v["advogado_principal.nome"] || BLANK}`, ...(v["advogado_principal.oab"] ? [v["advogado_principal.oab"]] : [])] : [];
    const blocos: Bloco[] = [...corpo, { k: "vazio", n: 1 }, { k: "p", trechos: [{ t: v["data.local"] }], align: contrato ? "r" : "l", pt: Math.min(pt, 11) }, { k: "vazio", n: 2 }];
    if (d.proprio && !d.proprio.assinatura) { /* documento sem assinatura: só o texto e a data */ }
    else if (opcoes.variante === "rogo") {
      blocos.push({ k: "rogo", assina: v["a_rogo.nome"].toUpperCase(), extra: extraContratado, testemunhas: testemunhasRogo, polegar: contrato ? "Polegar direito do contratante" : "Polegar direito do outorgante", pt: Math.min(pt, 10.5) });
    } else {
      const quem = opcoes.variante === "representado"
        ? { nome: v["representante.nome"].toUpperCase(), extra: [`${v["representante.qualidade"]} de ${nomeCliente}`] }
        : { nome: nomeCliente, extra: [] as string[] };
      blocos.push({ k: "assinatura", nome: quem.nome, extra: quem.extra, pt: Math.min(pt, 10.5) });
      if (contrato) {
        blocos.push({ k: "vazio", n: 1 }, { k: "assinatura", nome: extraContratado[0], extra: extraContratado.slice(1), pt: 9 }, { k: "vazio", n: 1 }, { k: "testemunhas", itens: testemunhasEscritorio.map((t) => ({ nome: t.nome.toUpperCase(), cpf: t.cpf })), pt: 9 });
      }
    }
    return { id: d.id, nome: d.nome, blocos };
  });

  const ler = (i: { arquivo: string; mime: string } | null): ImagemKit | null => (i ? { dados: fs.readFileSync(i.arquivo), mime: i.mime } : null);
  const logo = ler(imagemAtual("cabecalho") ?? logoAtual()); // sem cabeçalho próprio, usa o logotipo enviado antes
  const rodapeImagem = ler(imagemAtual("rodape"));
  const rodape = esc.rodape_linhas.length ? esc.rodape_linhas : [esc.endereco, esc.telefones.join(" / ")].filter(Boolean);
  return { escritorio: esc, nomeExibicao: nomeEscritorio, logo, rodapeImagem, alinhaCabecalho: esc.cabecalho_alinhamento, alinhaRodape: esc.rodape_alinhamento, rodape, documentos, faltando: [...faltando] };
}

// ---------- HTML (tela e impressão) ----------
const escHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const runsHtml = (t: Trecho[]) => t.map((x) => { const h = escHtml(x.t).replace(/\n/g, "<br>"); return x.b ? `<b>${h}</b>` : h; }).join("");
const ALIGN: Record<Alinhamento, string> = { j: "justify", c: "center", r: "right", l: "left" };

function blocoHtml(b: Bloco): string {
  switch (b.k) {
    case "titulo": return `<h2 style="font-size:${b.pt}pt${b.sublinhado ? ";text-decoration:underline" : ""}">${escHtml(b.texto)}</h2>`;
    case "p": return `<p style="font-size:${b.pt}pt;text-align:${ALIGN[b.align]}">${runsHtml(b.trechos)}</p>`;
    case "caixa": return `<div class="caixa" style="font-size:${b.pt}pt;text-align:${ALIGN[b.align]}">${runsHtml(b.trechos)}</div>`;
    case "vazio": return `<div style="height:${b.n * 6}mm"></div>`;
    case "assinatura": return `<div class="assina" style="font-size:${b.pt}pt"><div class="linha"></div><b>${escHtml(b.nome)}</b>${b.extra.map((e) => `<div>${escHtml(e)}</div>`).join("")}</div>`;
    case "rogo": return `<table class="rogo" style="font-size:${b.pt}pt"><tr><td colspan="2" class="sem"><div class="linha"></div><b>${escHtml(b.assina)}</b>${b.extra.map((e) => `<div>${escHtml(e)}</div>`).join("")}<div>TESTEMUNHAS A ROGO:</div></td><td rowspan="2" class="polegar"><span>${escHtml(b.polegar)}</span></td></tr><tr>${b.testemunhas.map((t) => `<td class="sem"><div class="linha"></div><b>${escHtml(t.nome)}</b><div>CPF: ${escHtml(t.cpf)}</div></td>`).join("")}</tr></table>`;
    case "testemunhas": return `<table class="test" style="font-size:${b.pt}pt"><tr>${b.itens.map((t, i) => `<td>Testemunha ${i + 1}: <b>${escHtml(t.nome)}</b><br>CPF: ${escHtml(t.cpf)}</td>`).join("")}</tr></table>`;
  }
}

export function kitHtml(kit: Kit, opcoes: { imprimir?: boolean; zoom?: number } = {}): string {
  const logo = kit.logo ? `<img class="logo" alt="" src="data:${kit.logo.mime};base64,${kit.logo.dados.toString("base64")}">` : `<div class="nome-escritorio">${escHtml(kit.nomeExibicao)}</div>`;
  const imgRodape = kit.rodapeImagem ? `<img class="img-rodape" style="${kit.alinhaRodape === "left" ? "" : kit.alinhaRodape === "center" ? "margin-left:auto;margin-right:auto" : "margin-left:auto"}" alt="" src="data:${kit.rodapeImagem.mime};base64,${kit.rodapeImagem.dados.toString("base64")}">` : "";
  const rodape = kit.rodape.length || imgRodape ? `<div class="rodape" style="text-align:${kit.alinhaRodape}">${imgRodape}${kit.rodape.map((l, i) => (i === 0 ? `<b>${escHtml(l)}</b>` : `<div><b>${escHtml(l)}</b></div>`)).join("")}</div>` : "";
  const folhas = kit.documentos.map((d) => `<table class="folha"><thead><tr><td class="cab" style="text-align:${kit.alinhaCabecalho}">${logo}</td></tr></thead><tbody><tr><td class="corpo">${d.blocos.map(blocoHtml).join("\n")}</td></tr></tbody><tfoot><tr><td>${rodape}</td></tr></tfoot></table>`).join("\n");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escHtml(kit.documentos.map((d) => d.nome).join(" · "))}</title><style>
@page{size:A4;margin:0}*{box-sizing:border-box}body{margin:0;background:#e5e7eb;font-family:Arial,Helvetica,sans-serif;color:#000;line-height:1.28}
.folha{width:210mm;height:296mm;margin:8mm auto;background:#fff;border-collapse:collapse;page-break-after:always;break-after:page;box-shadow:0 1px 6px rgba(0,0,0,.25)}
thead{display:table-header-group}tfoot{display:table-footer-group}
.cab{padding:8mm 20mm 2mm;height:30mm;vertical-align:middle}.logo{max-height:24mm;max-width:170mm;object-fit:contain}.img-rodape{display:block;max-height:14mm;max-width:170mm;object-fit:contain;margin-bottom:1.5mm}.nome-escritorio{font-size:16pt;font-weight:bold;letter-spacing:.5px}
.corpo{padding:1mm 20mm;vertical-align:top;height:100%}
h2{text-align:center;margin:1mm 0 4mm}p{margin:0 0 2.6mm}
.caixa{border:1px solid #000;padding:2mm 3mm;margin:0 0 4mm}
.assina{margin-top:2mm}.linha{border-top:1px solid #000;width:90mm;margin-bottom:1mm}
table.rogo,table.test{width:100%;border-collapse:separate;border-spacing:3mm 0;table-layout:fixed}td.sem{vertical-align:bottom;padding:0 0 2mm}
td.polegar{width:42mm;border:1px solid #000;height:30mm;vertical-align:bottom;text-align:center;font-weight:bold;padding:2mm}
.test td{vertical-align:top;padding-top:6mm}
.rodape{border-top:2px solid #333;margin:0 20mm 7mm;padding-top:2mm;font-size:8pt}
@media print{body{background:#fff}.folha{margin:0;box-shadow:none}}${opcoes.zoom ? `html{zoom:${Number(opcoes.zoom)}}` : ""}
</style></head><body>${folhas}${opcoes.imprimir ? "<script>window.addEventListener('load',function(){setTimeout(function(){window.print()},300)})</script>" : ""}</body></html>`;
}
