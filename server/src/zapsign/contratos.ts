import { db } from "../db";
import { ErroGestao } from "../services/gestao/erro";
import { DOCS, lerConfigDocumentos, montarKit, type Kit } from "../services/gestao/documentos";
import { salvarArquivo } from "../services/gestao/arquivos";
import { atualizarPessoa, criarPessoa } from "../services/gestao/pessoas";
import { soDigitos } from "../services/gestao/validacao";
import { consultarDocumento, criarDocumento, ErroZapSign, type ConfigZapSign, type DocumentoZapSign } from "./api";
import { lerConfigZapSign } from "./config";
import { pdfDoKit } from "./pdf";

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
CREATE INDEX IF NOT EXISTS idx_zapsign_contratos_token ON zapsign_contratos(doc_token);`);
if (!(db.prepare("PRAGMA table_info(zapsign_contratos)").all() as { name: string }[]).some((c) => c.name === "arquivo_id")) db.exec("ALTER TABLE zapsign_contratos ADD COLUMN arquivo_id INTEGER");

export class ErroContrato extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

export interface DadosContrato {
  nome: string; cpf: string; rg?: string; nacionalidade?: string; sexo?: string; estado_civil?: string; profissao?: string;
  logradouro?: string; numero?: string; complemento?: string; bairro?: string; cidade?: string; uf?: string; cep?: string;
  email?: string; telefone?: string; conversa_ref?: string; criado_por?: string;
}

export interface ContratoGerado { id: number; pessoa_id: number; status: string; sign_url: string; email_enviado: boolean }

const txt = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);

/** Cria/atualiza o cliente no cadastro (pelo CPF), monta TODOS os documentos do kit, converte em PDF e manda ao ZapSign. */
export async function gerarContrato(d: DadosContrato, nomeUsuario: string, deps: { config?: ConfigZapSign | null; http?: typeof fetch; pdf?: (kit: Kit) => Promise<Buffer> } = {}): Promise<ContratoGerado> {
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

  const ids = [...DOCS.map((x) => x.id), ...lerConfigDocumentos().proprios.map((p) => p.id)];
  let kit: Kit;
  try {
    kit = montarKit({ pessoaId, variante: "comum", documentos: ids, data: "hoje" }, nomeUsuario || "Atendimento");
  } catch (e) {
    if (e instanceof ErroGestao) throw new ErroContrato(e.message, 422);
    throw e;
  }
  let pdf: Buffer;
  try { pdf = await (deps.pdf ?? pdfDoKit)(kit); } catch { throw new ErroContrato("Não foi possível gerar o PDF do contrato neste servidor (conversor de documentos indisponível).", 424); }

  const doc = await criarDocumento(config, {
    nome: `Contrato - ${nome}`,
    pdfBase64: pdf.toString("base64"),
    signatario: { nome, email: campos.email || undefined, telefone: campos.telefone || undefined },
    idExterno: `pessoa-${pessoaId}`,
  }, deps.http ?? fetch);

  const r = db.prepare("INSERT INTO zapsign_contratos(pessoa_id,doc_token,sign_url,status,conversa_ref,criado_por) VALUES (?,?,?,?,?,?)")
    .run(pessoaId, doc.token, doc.signUrl, "enviado", txt(d.conversa_ref, 80), txt(d.criado_por, 120));
  return { id: Number(r.lastInsertRowid), pessoa_id: pessoaId, status: "enviado", sign_url: doc.signUrl!, email_enviado: Boolean(campos.email) };
}

/** Baixa o PDF assinado e o guarda na pasta do cliente (categoria "Contrato assinado"). Devolve o id do arquivo, ou null se não deu. */
async function guardarAssinado(l: { id: number; pessoa_id: number | null }, url: string, http: typeof fetch): Promise<number | null> {
  if (!l.pessoa_id || !url) return null;
  try {
    const r = await http(url, { signal: AbortSignal.timeout(60_000) });
    if (!r.ok) return null;
    const pdf = Buffer.from(await r.arrayBuffer());
    const nome = (db.prepare("SELECT nome FROM gestao_pessoas WHERE id=?").get(l.pessoa_id) as { nome: string } | undefined)?.nome ?? "cliente";
    const arq = salvarArquivo({ pessoaId: l.pessoa_id }, `Contrato assinado - ${nome}.pdf`, pdf, { categoria: "Contrato assinado", descricao: `Assinado pelo ZapSign (contrato nº ${l.id})` }, { id: null, nome: "ZapSign" });
    db.prepare("UPDATE zapsign_contratos SET arquivo_id=? WHERE id=?").run(arq.id, l.id);
    return arq.id;
  } catch (e) {
    console.error("[contratos] não foi possível guardar o PDF assinado:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Consulta o ZapSign e guarda o novo estado (enviado → assinado). Ao assinar, o PDF assinado vai para a pasta do cliente. */
export async function estadoDoContrato(id: number, deps: { config?: ConfigZapSign | null; http?: typeof fetch } = {}) {
  const l = db.prepare("SELECT * FROM zapsign_contratos WHERE id=?").get(id) as { id: number; pessoa_id: number | null; doc_token: string; sign_url: string; status: string; assinado_em: string | null; arquivo_id: number | null } | undefined;
  if (!l) throw new ErroContrato("Contrato não encontrado.", 404);
  const http = deps.http ?? fetch;
  const config = deps.config === undefined ? lerConfigZapSign() : deps.config;
  if (!config) throw new ErroContrato("O ZapSign ainda não foi configurado neste escritório.", 409);
  // Já assinado: só tenta de novo guardar o PDF se na primeira vez não deu (o ZapSign pode demorar a liberar o arquivo).
  if (l.status === "assinado" && l.arquivo_id) return { id: l.id, status: l.status, sign_url: l.sign_url, assinado_em: l.assinado_em, arquivo_salvo: true };
  let doc: DocumentoZapSign;
  try { doc = await consultarDocumento(config, l.doc_token, http); } catch (e) { if (e instanceof ErroZapSign) throw new ErroContrato(e.message, e.status); throw e; }
  const assinado = l.status === "assinado" || doc.status === "signed";
  if (!assinado) return { id: l.id, status: l.status, sign_url: l.sign_url, assinado_em: null, arquivo_salvo: false };
  if (l.status !== "assinado") db.prepare("UPDATE zapsign_contratos SET status='assinado', assinado_em=CURRENT_TIMESTAMP, arquivo_assinado=? WHERE id=?").run(doc.arquivoAssinado ?? "", id);
  const arquivoId = doc.arquivoAssinado ? await guardarAssinado(l, doc.arquivoAssinado, http) : null;
  return { id: l.id, status: "assinado" as const, sign_url: l.sign_url, assinado_em: l.assinado_em ?? new Date().toISOString(), arquivo_salvo: arquivoId !== null };
}
