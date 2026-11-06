import { db } from "../db";
import { ErroGestao } from "../services/gestao/erro";
import { lerConfigDocumentos, montarKit, type Kit } from "../services/gestao/documentos";
import { salvarArquivo } from "../services/gestao/arquivos";
import { atualizarPessoa, criarPessoa } from "../services/gestao/pessoas";
import { soDigitos } from "../services/gestao/validacao";
import { adicionarDocumentoExtra, consultarDocumento, criarDocumento, ErroZapSign, posicionarAssinaturas, type ConfigZapSign, type DocumentoZapSign } from "./api";
import { lerConfigZapSign } from "./config";
import { pdfDoKit, type PdfDoKit } from "./pdf";

db.exec(`CREATE TABLE IF NOT EXISTS zapsign_contratos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pessoa_id INTEGER REFERENCES gestao_pessoas(id) ON DELETE SET NULL,
  doc_token TEXT NOT NULL,
  sign_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enviado',
  conversa_ref TEXT NOT NULL DEFAULT '',
  criado_por TEXT NOT NULL DEFAULT '',
  arquivo_assinado TEXT NOT NULL DEFAULT '',
  criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  assinado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_zapsign_contratos_token ON zapsign_contratos(doc_token);
-- Um contrato (pacote) tem 3 envelopes, cada um com a sua assinatura.
CREATE TABLE IF NOT EXISTS zapsign_documentos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  contrato_id INTEGER NOT NULL REFERENCES zapsign_contratos(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL,
  nome TEXT NOT NULL,
  doc_token TEXT NOT NULL,
  sign_url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'enviado',
  arquivo_id INTEGER,
  assinado_em TEXT
);
CREATE INDEX IF NOT EXISTS idx_zapsign_documentos_contrato ON zapsign_documentos(contrato_id);`);
if (!(db.prepare("PRAGMA table_info(zapsign_contratos)").all() as { name: string }[]).some((c) => c.name === "arquivo_id")) db.exec("ALTER TABLE zapsign_contratos ADD COLUMN arquivo_id INTEGER");

export class ErroContrato extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface DadosContrato {
  nome: string; cpf: string; rg?: string; nacionalidade?: string; sexo?: string; estado_civil?: string; profissao?: string;
  logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string; cep?: string;
  email?: string; telefone?: string; conversa_ref?: string; criado_por?: string;
}

export interface EnvelopeGerado { tipo: string; nome: string; sign_url: string }
export interface ContratoGerado { id: number; pessoa_id: number; status: string; sign_url: string; documentos: EnvelopeGerado[]; email_enviado: boolean }

/** Os 3 documentos do envelope (um link, uma assinatura para todos): procuração; declaração de hipossuficiência; contrato + declaração de honorários + termo (+ documentos próprios do escritório). Cada um é um documento próprio no ZapSign. */
export function envelopesDoContrato(proprios: string[] = []): { tipo: string; nome: string; ids: string[] }[] {
  return [
    { tipo: "procuracao", nome: "Procuração", ids: ["procuracao"] },
    { tipo: "hipossuficiencia", nome: "Declaração de hipossuficiência", ids: ["hipossuficiencia"] },
    { tipo: "contrato", nome: "Contrato e declarações", ids: ["contrato", "declaracao_honorarios", "termo_ciencia", ...proprios] },
  ];
}

const txt = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

/** Cria/atualiza o cliente no cadastro (pelo CPF), monta TODOS os documentos do kit, converte em PDF e manda ao ZapSign. */
export async function gerarContrato(d: DadosContrato, nomeUsuario: string, deps: { config?: ConfigZapSign | null; http?: typeof fetch; pdf?: (kit: Kit) => Promise<PdfDoKit> } = {}): Promise<ContratoGerado> {
  const config = deps.config === undefined ? lerConfigZapSign() : deps.config;
  if (!config) throw new ErroContrato("O ZapSign ainda não foi configurado neste escritório (Atendimento → ZapSign).", 409);
  const nome = txt(d.nome);
  const cpf = soDigitos(d.cpf);
  if (nome.length < 3) throw new ErroContrato("Informe o nome do cliente.");
  if (cpf.length !== 11 && cpf.length !== 14) throw new ErroContrato("Informe o CPF do cliente.");
  if (!txt(d.logradouro)) throw new ErroContrato("Informe o endereço do cliente.");

  const campos = {
    tipo: "cliente", nome, documento: cpf, rg: txt(d.rg, 30), nacionalidade: txt(d.nacionalidade, 40), sexo: txt(d.sexo, 1),
    estado_civil: txt(d.estado_civil, 40), profissao: txt(d.profissao, 100), logradouro: txt(d.logradouro), numero: txt(d.numero, 20),
    complemento: txt(d.complemento, 100), bairro: txt(d.bairro, 100), cidade: txt(d.cidade, 100), uf: txt(d.uf, 2), cep: soDigitos(txt(d.cep, 12)),
    email: txt(d.email, 254), telefone: txt(d.telefone, 30), origem: "Atendimento (WhatsApp)",
  };
  let pessoaId: number;
  try {
    const existente = db.prepare("SELECT id FROM gestao_pessoas WHERE documento=? LIMIT 1").get(cpf) as { id: number } | undefined;
    pessoaId = existente ? (atualizarPessoa(existente.id, campos) as { id: number }).id : (criarPessoa(campos) as { id: number }).id;
  } catch (e) {
    if (e instanceof ErroGestao) throw new ErroContrato(e.message, e.status === 409 ? 409 : 422);
    throw e;
  }

  const http = deps.http ?? fetch;
  const envs = envelopesDoContrato(lerConfigDocumentos().proprios.map((p) => p.id));
  // Gera os 3 PDFs ANTES de criar qualquer coisa no ZapSign: se um falhar, nada fica pela metade.
  const pdfs: PdfDoKit[] = [];
  for (const env of envs) {
    let kit: Kit;
    try {
      kit = montarKit({ pessoaId, variante: "comum", documentos: env.ids, data: "hoje" }, nomeUsuario || "Atendimento");
    } catch (e) {
      if (e instanceof ErroGestao) throw new ErroContrato(e.message, 422);
      throw e;
    }
    try { pdfs.push(await (deps.pdf ?? pdfDoKit)(kit)); } catch { throw new ErroContrato("Não foi possível gerar o PDF do contrato neste servidor (conversor de documentos indisponível).", 424); }
  }
  const titulo = (e: { nome: string }) => `${e.nome} - ${nome}`;
  // O 1º documento cria o envelope; os demais entram como DOCUMENTOS EXTRAS do mesmo envelope: um link só, e cada documento com a sua validade.
  const principal = await criarDocumento(config, {
    nome: titulo(envs[0]!), pdfBase64: pdfs[0]!.pdf.toString("base64"),
    signatario: { nome, email: campos.email || undefined, telefone: campos.telefone || undefined },
    idExterno: `pessoa-${pessoaId}`,
  }, http);
  if (principal.signerToken) await posicionarAssinaturas(config, principal.token, principal.signerToken, pdfs[0]!.assinaturas, http);
  for (let i = 1; i < envs.length; i++) {
    const extra = await adicionarDocumentoExtra(config, principal.token, { nome: titulo(envs[i]!), pdfBase64: pdfs[i]!.pdf.toString("base64") }, http);
    if (extra.token && principal.signerToken) await posicionarAssinaturas(config, extra.token, principal.signerToken, pdfs[i]!.assinaturas, http);
  }

  const r = db.prepare("INSERT INTO zapsign_contratos(pessoa_id,doc_token,sign_url,status,conversa_ref,criado_por) VALUES (?,?,?,?,?,?)")
    .run(pessoaId, principal.token, principal.signUrl, "enviado", txt(d.conversa_ref, 80), txt(d.criado_por, 120));
  const contratoId = Number(r.lastInsertRowid);
  const ins = db.prepare("INSERT INTO zapsign_documentos(contrato_id,tipo,nome,doc_token,sign_url) VALUES (?,?,?,?,?)");
  envs.forEach((e, i) => ins.run(contratoId, i === 0 ? "principal" : "extra", e.nome, principal.token, i === 0 ? principal.signUrl : ""));
  return {
    id: contratoId, pessoa_id: pessoaId, status: "enviado", sign_url: principal.signUrl!, email_enviado: Boolean(campos.email),
    documentos: [{ tipo: "envelope", nome: "Documentos do cliente", sign_url: principal.signUrl! }],
  };
}

/** Baixa o PDF assinado de um envelope e o guarda na pasta do cliente (categoria "Contrato assinado"). Devolve o id do arquivo, ou null se não deu. */
async function guardarAssinado(contratoId: number, pessoaId: number | null, nomeDoEnvelope: string, url: string, http: typeof fetch): Promise<number | null> {
  if (!pessoaId || !url) return null;
  try {
    const r = await http(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    const pdf = Buffer.from(await r.arrayBuffer());
    const nome = (db.prepare("SELECT nome FROM gestao_pessoas WHERE id=?").get(pessoaId) as { nome: string } | undefined)?.nome ?? "cliente";
    const arq = salvarArquivo({ pessoaId }, `${nomeDoEnvelope} assinado - ${nome}.pdf`, pdf, { categoria: "Contrato assinado", descricao: `Assinado pelo ZapSign (contrato nº ${contratoId})` }, { id: null, nome: "ZapSign" });
    return arq.id;
  } catch (e) {
    console.error("[contratos] não foi possível guardar o PDF assinado:", e instanceof Error ? e.message : e);
    return null;
  }
}

interface LinhaDocumento { id: number; contrato_id: number; tipo: string; nome: string; doc_token: string; sign_url: string; status: string; arquivo_id: number | null }

/**
 * Consulta o ZapSign. Quando o cliente assina (uma vez, todos os documentos do envelope), cada documento — o principal e cada extra —
 * é baixado COM O SEU PRÓPRIO SELO E CERTIFICADO e guardado como arquivo separado na pasta do cliente.
 */
export async function estadoDoContrato(id: number, deps: { config?: ConfigZapSign | null; http?: typeof fetch } = {}) {
  const l = db.prepare("SELECT * FROM zapsign_contratos WHERE id=?").get(id) as { id: number; pessoa_id: number | null; status: string; assinado_em: string | null } | undefined;
  if (!l) throw new ErroContrato("Contrato não encontrado.", 404);
  const http = deps.http ?? fetch;
  const docs = db.prepare("SELECT * FROM zapsign_documentos WHERE contrato_id=? ORDER BY id").all(id) as LinhaDocumento[];
  if (l.status === "assinado" && docs.every((d) => d.arquivo_id)) return resumo(l, docs);
  const config = deps.config === undefined ? lerConfigZapSign() : deps.config;
  if (!config) throw new ErroContrato("O ZapSign ainda não foi configurado neste escritório.", 409);
  const principal = docs.find((d) => d.tipo === "principal");
  if (!principal) return resumo(l, docs);
  let doc: DocumentoZapSign;
  try { doc = await consultarDocumento(config, principal.doc_token, http); } catch (e) { if (e instanceof ErroZapSign) throw new ErroContrato(e.message, e.status); throw e; }
  if (l.status !== "assinado") {
    if (doc.status !== "signed") return resumo(l, docs);
    db.prepare("UPDATE zapsign_contratos SET status='assinado', assinado_em=CURRENT_TIMESTAMP WHERE id=?").run(id);
    db.prepare("UPDATE zapsign_documentos SET status='assinado', assinado_em=CURRENT_TIMESTAMP WHERE contrato_id=?").run(id);
    l.status = "assinado"; l.assinado_em = new Date().toISOString();
    for (const d of docs) d.status = "assinado";
  }
  // Os arquivos assinados: o principal e, na ordem, cada extra (casa pelo nome; se o ZapSign mudar o nome, pela ordem).
  const extrasDoZap = doc.extras;
  const linhasExtras = docs.filter((d) => d.tipo === "extra");
  const salvar = async (linha: LinhaDocumento, url: string | null) => {
    if (linha.arquivo_id || !url) return;
    const a = await guardarAssinado(id, l.pessoa_id, linha.nome, url, http);
    if (a) { db.prepare("UPDATE zapsign_documentos SET arquivo_id=? WHERE id=?").run(a, linha.id); linha.arquivo_id = a; }
  };
  await salvar(principal, doc.arquivoAssinado);
  for (let i = 0; i < linhasExtras.length; i++) {
    const linha = linhasExtras[i]!;
    const doZap = extrasDoZap.find((e) => e.nome.startsWith(linha.nome)) ?? extrasDoZap[i];
    await salvar(linha, doZap?.arquivoAssinado ?? null);
  }
  return resumo(l, docs);
}

function resumo(l: { id: number; status: string; assinado_em: string | null }, docs: LinhaDocumento[]) {
  return {
    id: l.id, status: l.status === "assinado" ? ("assinado" as const) : ("enviado" as const), assinado_em: l.assinado_em,
    assinados: l.status === "assinado" ? docs.length : 0, total: docs.length,
    arquivo_salvo: l.status === "assinado" && docs.length > 0 && docs.every((d) => d.arquivo_id !== null),
    documentos: docs.map((d) => ({ tipo: d.tipo, nome: d.nome, status: d.status, sign_url: d.sign_url })),
  };
}
