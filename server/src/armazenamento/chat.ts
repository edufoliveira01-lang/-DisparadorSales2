/**
 * Armazenamento externo — fase 2: os documentos que o CLIENTE manda pelo chat (CNIS, laudo, comprovante, RG…).
 *
 * O fluxo (decidido com o dono): o agente do atendimento (Deskcomm) classifica o documento e pede ao Sales; o Sales baixa o arquivo por um link temporário
 * assinado, guarda numa pasta TEMPORÁRIA e manda direto ao drive — sem cópia permanente no Sales (os assinados do ZapSign é que ficam aqui).
 *
 * Regra: só depois da assinatura do contrato. Antes dela o cliente nem existe no cadastro com CPF confirmado; o documento espera em `armazenamento_espera`
 * e, quando o contrato é assinado, passa para a MESMA fila dos assinados (reaproveita nova tentativa, pasta parecida, escolha da equipe e a tela Envios).
 * Quem cria a pasta é o sistema (regras de `servico.ts`), nunca o modelo: a IA só informa quem é o cliente e o tipo do documento.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db, dataDir } from "../db";
import { normalizePhone } from "../utils/phone";
import { lerCredenciais } from "./banco";
import { ehTipoDePasta, ErroArmazenamento, type TipoDePasta } from "./pastas";
import { processarFila } from "./fila";

/** O maior arquivo aceito do chat (o Dropbox aceita até 150 MB em um envio simples; o WhatsApp entrega bem menos). */
export const LIMITE_DO_ARQUIVO_DO_CHAT = 25 * 1024 * 1024;

const PASTA_TEMP = () => path.join(dataDir, "armazenamento-temp");

export interface DocumentoDoChat {
  /** Identificador estável do documento no chat (a mensagem): o mesmo documento nunca entra duas vezes. */
  origemRef: string;
  telefone?: string;
  cpf?: string;
  tipoPasta: string;
  titulo: string;
  extensao?: string;
  /** Quando o cliente enviou (ISO). Sem isso, vale agora. */
  dataDocumento?: string;
  /** Link temporário do arquivo no armazenamento do atendimento. */
  url: string;
}

export type SituacaoDoChat = "enfileirado" | "aguardando_assinatura" | "ja_recebido" | "drive_nao_configurado";

const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

/** Recusa endereço que não seja https público: o Sales só baixa de fora, nunca da própria rede. */
export function urlDeDownloadPermitida(bruta: string): URL {
  let u: URL;
  try { u = new URL(bruta); } catch { throw new ErroArmazenamento("Endereço do arquivo inválido."); }
  if (u.protocol !== "https:") throw new ErroArmazenamento("O endereço do arquivo precisa ser https.");
  const h = u.hostname.toLowerCase();
  const privado =
    h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local") || h.endsWith(".internal") || !h.includes(".") ||
    /^\[.*\]$/.test(h) ||
    /^(127|10|0)\./.test(h) || /^192\.168\./.test(h) || /^169\.254\./.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h);
  if (privado) throw new ErroArmazenamento("O endereço do arquivo não é permitido.");
  return u;
}

async function baixar(url: string, http: typeof fetch): Promise<Buffer> {
  const u = urlDeDownloadPermitida(url);
  let r: Response;
  try { r = await http(u.toString(), { redirect: "error", signal: AbortSignal.timeout(60_000) }); }
  catch { throw new ErroArmazenamento("Não foi possível baixar o arquivo do atendimento.", 502); }
  if (!r.ok) throw new ErroArmazenamento(`O atendimento recusou entregar o arquivo (HTTP ${r.status}). O link pode ter expirado.`, 502);
  const declarado = Number(r.headers.get("content-length") ?? 0);
  if (declarado > LIMITE_DO_ARQUIVO_DO_CHAT) throw new ErroArmazenamento("O arquivo é grande demais (máximo 25 MB).", 413);
  const corpo = Buffer.from(await r.arrayBuffer());
  if (corpo.length === 0) throw new ErroArmazenamento("O arquivo veio vazio.", 422);
  if (corpo.length > LIMITE_DO_ARQUIVO_DO_CHAT) throw new ErroArmazenamento("O arquivo é grande demais (máximo 25 MB).", 413);
  return corpo;
}

/** O cliente do Sales que corresponde ao CPF (preferido) ou ao telefone — só entre os clientes ativos. `null` se não houver. */
export function pessoaDoDocumento(cpf: string, telefone: string): number | null {
  const doc = soDigitos(cpf);
  if (doc.length >= 11) {
    const l = db.prepare(
      "SELECT id FROM gestao_pessoas WHERE tipo='cliente' AND ativo=1 AND replace(replace(replace(replace(documento,'.',''),'-',''),'/',''),' ','')=? ORDER BY id LIMIT 1",
    ).get(doc) as { id: number } | undefined;
    if (l) return l.id;
  }
  const fone = normalizePhone(telefone || "");
  if (fone.length >= 10) {
    const ultimos = fone.slice(-8);
    // O telefone fica gravado como a pessoa digitou ("(13) 97404-5973"): compara só os dígitos.
    const limpo = (c: string) => `replace(replace(replace(replace(replace(replace(${c},'(',''),')',''),' ',''),'-',''),'+',''),'.','')`;
    const candidatos = db.prepare(`SELECT id, telefone, telefone2 FROM gestao_pessoas WHERE tipo='cliente' AND ativo=1 AND (${limpo("telefone")} LIKE ? OR ${limpo("telefone2")} LIKE ?)`)
      .all(`%${ultimos}%`, `%${ultimos}%`) as Array<{ id: number; telefone: string; telefone2: string }>;
    const iguais = candidatos.filter((c) => [c.telefone, c.telefone2].some((t) => normalizePhone(t) === fone));
    if (iguais.length === 1) return iguais[0]!.id; // telefone repetido em dois cadastros é ambíguo: não adivinha
  }
  return null;
}

/** O cliente já assinou algum contrato? (os documentos do chat só seguem depois disso.) */
export function clienteJaAssinou(pessoaId: number): boolean {
  try { return Boolean(db.prepare("SELECT 1 FROM zapsign_contratos WHERE pessoa_id=? AND status='assinado' LIMIT 1").get(pessoaId)); }
  catch { return false; } // escritório sem ZapSign
}

function proximoIdDeChat(): number {
  const r = db.prepare("SELECT COALESCE(MIN(CASE WHEN arquivo_id < 0 THEN arquivo_id END), 0) - 1 AS n FROM armazenamento_fila").get() as { n: number };
  return r.n;
}

function entrarNaFila(pessoaId: number, d: { origemRef: string; tipoPasta: string; titulo: string; extensao: string; dataDocumento: string; caminhoTemp: string }): void {
  db.prepare(
    "INSERT OR IGNORE INTO armazenamento_fila(pessoa_id,arquivo_id,tipo_pasta,titulo,extensao,data_documento,caminho_temp,origem_ref) VALUES (?,?,?,?,?,?,?,?)",
  ).run(pessoaId, proximoIdDeChat(), d.tipoPasta, d.titulo, d.extensao, d.dataDocumento, d.caminhoTemp, d.origemRef);
}

/**
 * Recebe um documento do chat. Idempotente por `origemRef`. Sem drive configurado, nada é baixado (o agente é avisado).
 * Cliente com contrato assinado: vai para a fila. Sem assinatura (ou sem cadastro): espera.
 */
export async function receberDocumentoDoChat(d: DocumentoDoChat, deps: { http?: typeof fetch; processar?: boolean } = {}): Promise<{ situacao: SituacaoDoChat }> {
  if (!lerCredenciais()) return { situacao: "drive_nao_configurado" };
  const origemRef = String(d.origemRef ?? "").trim();
  if (!origemRef || origemRef.length > 120) throw new ErroArmazenamento("Referência do documento inválida.");
  if (!ehTipoDePasta(d.tipoPasta)) throw new ErroArmazenamento("Tipo de pasta inválido.");
  const titulo = String(d.titulo ?? "").trim();
  if (!titulo) throw new ErroArmazenamento("O documento precisa de um título.");
  const extensao = String(d.extensao ?? "pdf").replace(/^\./, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8) || "pdf";
  const quando = d.dataDocumento && !Number.isNaN(new Date(d.dataDocumento).getTime()) ? new Date(d.dataDocumento).toISOString() : new Date().toISOString();

  const jaTem = db.prepare("SELECT 1 FROM armazenamento_fila WHERE origem_ref=? UNION SELECT 1 FROM armazenamento_espera WHERE origem_ref=?").get(origemRef, origemRef);
  if (jaTem) return { situacao: "ja_recebido" };

  const conteudo = await baixar(d.url, deps.http ?? fetch);
  fs.mkdirSync(PASTA_TEMP(), { recursive: true, mode: 0o700 });
  const caminhoTemp = path.join(PASTA_TEMP(), `${crypto.randomUUID()}.bin`);
  fs.writeFileSync(caminhoTemp, conteudo, { mode: 0o600 });

  try {
    const pessoaId = pessoaDoDocumento(d.cpf ?? "", d.telefone ?? "");
    if (pessoaId !== null && clienteJaAssinou(pessoaId)) {
      entrarNaFila(pessoaId, { origemRef, tipoPasta: d.tipoPasta, titulo, extensao, dataDocumento: quando, caminhoTemp });
      if (deps.processar !== false) void processarFila().catch(() => undefined);
      return { situacao: "enfileirado" };
    }
    db.prepare("INSERT OR IGNORE INTO armazenamento_espera(origem_ref,telefone,cpf,tipo_pasta,titulo,extensao,data_documento,caminho_temp) VALUES (?,?,?,?,?,?,?,?)")
      .run(origemRef, normalizePhone(d.telefone ?? ""), soDigitos(d.cpf), d.tipoPasta, titulo, extensao, quando, caminhoTemp);
    return { situacao: "aguardando_assinatura" };
  } catch (e) {
    try { fs.unlinkSync(caminhoTemp); } catch { /* nada a apagar */ }
    throw e;
  }
}

/**
 * O contrato do cliente foi assinado: os documentos dele que esperavam (casados pelo CPF ou pelo telefone) entram na fila de envio.
 * Chamado quando a assinatura é registrada. Devolve quantos foram liberados.
 */
export function liberarEsperaDaPessoa(pessoaId: number, opcoes: { processar?: boolean } = {}): number {
  const p = db.prepare("SELECT documento, telefone, telefone2 FROM gestao_pessoas WHERE id=?").get(pessoaId) as { documento: string; telefone: string; telefone2: string } | undefined;
  if (!p) return 0;
  const cpf = soDigitos(p.documento);
  const fones = [p.telefone, p.telefone2].map((t) => normalizePhone(t || "")).filter((t) => t.length >= 10);
  const esperando = db.prepare("SELECT * FROM armazenamento_espera ORDER BY id").all() as Array<{
    id: number; origem_ref: string; telefone: string; cpf: string; tipo_pasta: string; titulo: string; extensao: string; data_documento: string; caminho_temp: string;
  }>;
  let n = 0;
  for (const e of esperando) {
    const casaCpf = cpf.length >= 11 && e.cpf === cpf;
    const casaFone = e.telefone.length >= 10 && fones.includes(e.telefone);
    if (!casaCpf && !casaFone) continue;
    entrarNaFila(pessoaId, { origemRef: e.origem_ref, tipoPasta: e.tipo_pasta, titulo: e.titulo, extensao: e.extensao, dataDocumento: e.data_documento, caminhoTemp: e.caminho_temp });
    db.prepare("DELETE FROM armazenamento_espera WHERE id=?").run(e.id);
    n++;
  }
  if (n > 0 && opcoes.processar !== false) void processarFila().catch(() => undefined);
  return n;
}

/** Quantos documentos do chat esperam a assinatura (para a tela). */
export function documentosEsperandoAssinatura(): number {
  return (db.prepare("SELECT COUNT(*) n FROM armazenamento_espera").get() as { n: number }).n;
}

export type { TipoDePasta };
