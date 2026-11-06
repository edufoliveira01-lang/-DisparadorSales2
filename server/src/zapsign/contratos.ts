import { db } from "../db";
import { ErroGestao } from "../services/gestao/erro";
import { lerConfigDocumentos, montarKit, type Kit } from "../services/gestao/documentos";
import { salvarArquivo } from "../services/gestao/arquivos";
import { atualizarPessoa, criarPessoa } from "../services/gestao/pessoas";
import { soDigitos } from "../services/gestao/validacao";
import { consultarDocumento, criarDocumento, criarDocumentoDeModelo, ErroZapSign, posicionarAssinaturas, type ConfigZapSign, type DocumentoZapSign } from "./api";
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

const formatarCpf = (d: string) => (d.length === 11 ? `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}` : d.length === 14 ? `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}` : d);
const formatarCep = (d: string) => (d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d);

/** As variáveis do modelo do ZapSign ({{NOME}}, {{INSCRITO}}…), com a concordância de gênero resolvida aqui. */
export function variaveisDoModelo(c: { nome: string; nacionalidade: string; sexo: string; estado_civil: string; profissao: string; rg: string; documento: string; logradouro: string; numero: string; complemento: string; bairro: string; cidade: string; uf: string; cep: string }): Record<string, string> {
  const a = (masc: string, fem: string) => (c.sexo === "F" ? fem : c.sexo === "M" ? masc : `${masc}(a)`);
  return {
    NOME: c.nome, NACIONALIDADE: c.nacionalidade || a("brasileiro", "brasileira"), ESTADO_CIVIL: c.estado_civil, PROFISSAO: c.profissao, RG: c.rg,
    INSCRITO: a("inscrito", "inscrita"), CPF: formatarCpf(c.documento), DOMICILIADO: a("domiciliado", "domiciliada"),
    LOGRADOURO: c.logradouro, NUMERO: c.numero, COMPLEMENTO: c.complemento ? `, ${c.complemento}` : "", BAIRRO: c.bairro,
    CIDADE: c.cidade, UF: c.uf, CEP: formatarCep(c.cep),
  };
}

/** Os 3 envelopes, cada um com UMA assinatura do cliente: procuração; declaração de hipossuficiência; contrato + declaração de honorários + termo (+ documentos próprios do escritório). */
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
  // Com o MODELO do ZapSign configurado: um único link e uma única assinatura valem para todos os documentos (principal + complementares).
  if (config.modeloId) {
    const doc = await criarDocumentoDeModelo(config, {
      modeloId: config.modeloId,
      signatario: { nome, email: campos.email || undefined, telefone: campos.telefone || undefined },
      variaveis: variaveisDoModelo({ ...campos, documento: cpf }),
      idExterno: `pessoa-${pessoaId}`,
    }, http);
    const r = db.prepare("INSERT INTO zapsign_contratos(pessoa_id,doc_token,sign_url,status,conversa_ref,criado_por) VALUES (?,?,?,?,?,?)")
      .run(pessoaId, doc.token, doc.signUrl, "enviado", txt(d.conversa_ref, 80), txt(d.criado_por, 120));
    const contratoId = Number(r.lastInsertRowid);
    db.prepare("INSERT INTO zapsign_documentos(contrato_id,tipo,nome,doc_token,sign_url) VALUES (?,?,?,?,?)").run(contratoId, "modelo", doc.nome || "Documentos", doc.token, doc.signUrl);
    return { id: contratoId, pessoa_id: pessoaId, status: "enviado", sign_url: doc.signUrl!, email_enviado: Boolean(campos.email), documentos: [{ tipo: "modelo", nome: "Documentos do cliente", sign_url: doc.signUrl! }] };
  }
  const proprios = lerConfigDocumentos().proprios.map((p) => p.id);
  const gerarPdf = deps.pdf ?? pdfDoKit;
  const criados: { tipo: string; nome: string; doc: DocumentoZapSign }[] = [];
  for (const env of envelopesDoContrato(proprios)) {
    let kit: Kit;
    try {
      kit = montarKit({ pessoaId, variante: "comum", documentos: env.ids, data: "hoje" }, nomeUsuario || "Atendimento");
    } catch (e) {
      if (e instanceof ErroGestao) throw new ErroContrato(e.message, 422);
      throw e;
    }
    let pdf: PdfDoKit;
    try { pdf = await gerarPdf(kit); } catch { throw new ErroContrato("Não foi possível gerar o PDF do contrato neste servidor (conversor de documentos indisponível).", 424); }
    const doc = await criarDocumento(config, {
      nome: `${env.nome} - ${nome}`,
      pdfBase64: pdf.pdf.toString("base64"),
      signatario: { nome, email: campos.email || undefined, telefone: campos.telefone || undefined },
      idExterno: `pessoa-${pessoaId}-${env.tipo}`,
    }, http);
    if (doc.signerToken) await posicionarAssinaturas(config, doc.token, doc.signerToken, pdf.assinaturas, http);
    criados.push({ tipo: env.tipo, nome: env.nome, doc });
  }

  const r = db.prepare("INSERT INTO zapsign_contratos(pessoa_id,doc_token,sign_url,status,conversa_ref,criado_por) VALUES (?,?,?,?,?,?)")
    .run(pessoaId, criados[0].doc.token, criados[0].doc.signUrl, "enviado", txt(d.conversa_ref, 80), txt(d.criado_por, 120));
  const contratoId = Number(r.lastInsertRowid);
  const ins = db.prepare("INSERT INTO zapsign_documentos(contrato_id,tipo,nome,doc_token,sign_url) VALUES (?,?,?,?,?)");
  for (const c of criados) ins.run(contratoId, c.tipo, c.nome, c.doc.token, c.doc.signUrl);
  return {
    id: contratoId, pessoa_id: pessoaId, status: "enviado", sign_url: criados[0].doc.signUrl!, email_enviado: Boolean(campos.email),
    documentos: criados.map((c) => ({ tipo: c.tipo, nome: c.nome, sign_url: c.doc.signUrl! })),
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
 * Consulta o ZapSign e guarda o novo estado de cada envelope. Cada envelope assinado vai para a pasta do cliente como arquivo separado.
 * O contrato só fica "assinado" quando os 3 envelopes estão assinados.
 */
export async function estadoDoContrato(id: number, deps: { config?: ConfigZapSign | null; http?: typeof fetch } = {}) {
  const l = db.prepare("SELECT * FROM zapsign_contratos WHERE id=?").get(id) as { id: number; pessoa_id: number | null; status: string; assinado_em: string | null } | undefined;
  if (!l) throw new ErroContrato("Contrato não encontrado.", 404);
  const http = deps.http ?? fetch;
  const docs = db.prepare("SELECT * FROM zapsign_documentos WHERE contrato_id=? ORDER BY id").all(id) as LinhaDocumento[];
  if (l.status === "assinado" && docs.every((d) => d.arquivo_id)) return resumo(l, docs);
  const config = deps.config === undefined ? lerConfigZapSign() : deps.config;
  if (!config) throw new ErroContrato("O ZapSign ainda não foi configurado neste escritório.", 409);
  for (const d of [...docs]) {
    if (d.tipo === "extra") continue;
    if (d.status === "assinado" && d.arquivo_id && d.tipo !== "modelo") continue;
    let doc: DocumentoZapSign;
    try { doc = await consultarDocumento(config, d.doc_token, http); } catch (e) { if (e instanceof ErroZapSign) throw new ErroContrato(e.message, e.status); throw e; }
    if (d.status !== "assinado" && doc.status !== "signed") continue;
    if (d.status !== "assinado") db.prepare("UPDATE zapsign_documentos SET status='assinado', assinado_em=CURRENT_TIMESTAMP WHERE id=?").run(d.id);
    d.status = "assinado";
    const arquivoId = doc.arquivoAssinado ? await guardarAssinado(id, l.pessoa_id, d.nome || doc.nome || "Documento", doc.arquivoAssinado, http) : null;
    if (arquivoId) { db.prepare("UPDATE zapsign_documentos SET arquivo_id=? WHERE id=?").run(arquivoId, d.id); d.arquivo_id = arquivoId; }
    // Modelo com documentos complementares: cada um vira um arquivo separado na pasta do cliente (uma linha por complementar).
    for (const extra of doc.extras) {
      if (!extra.arquivoAssinado) continue;
      const ja = docs.find((x) => x.tipo === "extra" && x.nome === extra.nome);
      if (ja?.arquivo_id) continue;
      const arq = await guardarAssinado(id, l.pessoa_id, extra.nome || "Documento complementar", extra.arquivoAssinado, http);
      if (!arq) continue;
      if (ja) { db.prepare("UPDATE zapsign_documentos SET arquivo_id=? WHERE id=?").run(arq, ja.id); ja.arquivo_id = arq; }
      else {
        const ins = db.prepare("INSERT INTO zapsign_documentos(contrato_id,tipo,nome,doc_token,sign_url,status,arquivo_id) VALUES (?,?,?,?,?,?,?)").run(id, "extra", extra.nome, d.doc_token, "", "assinado", arq);
        docs.push({ id: Number(ins.lastInsertRowid), contrato_id: id, tipo: "extra", nome: extra.nome, doc_token: d.doc_token, sign_url: "", status: "assinado", arquivo_id: arq });
      }
    }
  }
  if (l.status !== "assinado" && docs.length > 0 && docs.every((d) => d.status === "assinado")) {
    db.prepare("UPDATE zapsign_contratos SET status='assinado', assinado_em=CURRENT_TIMESTAMP WHERE id=?").run(id);
    l.status = "assinado"; l.assinado_em = new Date().toISOString();
  }
  return resumo(l, docs);
}

function resumo(l: { id: number; status: string; assinado_em: string | null }, docs: LinhaDocumento[]) {
  const assinados = docs.filter((d) => d.status === "assinado").length;
  return {
    id: l.id, status: l.status === "assinado" ? ("assinado" as const) : ("enviado" as const), assinado_em: l.assinado_em,
    assinados, total: docs.length, arquivo_salvo: docs.length > 0 && docs.every((d) => d.status !== "assinado" || d.arquivo_id !== null),
    documentos: docs.map((d) => ({ tipo: d.tipo, nome: d.nome, status: d.status, sign_url: d.sign_url })),
  };
}
