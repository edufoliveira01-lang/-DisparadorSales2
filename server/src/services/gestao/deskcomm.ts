/**
 * Envio de mensagens pelo Deskcomm (atendimento): é por onde as cobranças saem, para a conversa ficar no histórico do cliente
 * e as respostas caírem no atendimento. Usa a API do próprio Deskcomm com um token de API do escritório (Configurações → Atendimento).
 */
import crypto from "node:crypto";
import { getSetting, setSetting } from "../settingsService";
import { atendimentoDaInstancia } from "../../atendimento/instancia";

export class ErroDeskcomm extends Error { constructor(m: string, public status = 502) { super(m); } }
type Http = typeof fetch;

export const tokenDoDeskcomm = () => (getSetting("deskcomm_api_token") || "").trim();
export const urlDoDeskcomm = () => atendimentoDaInstancia()?.url ?? "";
export const envioPeloDeskcommLigado = () => Boolean(tokenDoDeskcomm() && urlDoDeskcomm());
export const mascaraDeskcomm = (c: string) => (c ? `…${c.slice(-4)}` : "");

export function salvarTokenDoDeskcomm(valor: unknown) {
  const v = String(valor ?? "").trim().replace(/^bearer\s+/i, "").replace(/^["'`]+|["'`]+$/g, "").trim();
  if (v && !/^dsk_[\w-]{10,200}$/.test(v)) throw new ErroDeskcomm("O token parece inválido. Cole o token gerado no Deskcomm (começa com dsk_), sem aspas.", 400);
  setSetting("deskcomm_api_token", v);
}

const chamarForm = <T>(caminho: string, form: FormData, http: Http) => chamar<T>("POST", caminho, undefined, http, {}, form);
async function chamar<T>(metodo: string, caminho: string, corpo: unknown, http: Http, extra: Record<string, string> = {}, form?: FormData): Promise<T> {
  const base = urlDoDeskcomm(), token = tokenDoDeskcomm();
  if (!base) throw new ErroDeskcomm("O atendimento (Deskcomm) não está ligado a este escritório.", 409);
  if (!token) throw new ErroDeskcomm("Falta o token de API do Deskcomm. Cadastre em Configurações → Atendimento (envio de mensagens).", 409);
  let r: Response;
  try {
    r = await http(`${base}${caminho}`, { method: metodo, headers: { Authorization: `Bearer ${token}`, ...(form ? {} : { "Content-Type": "application/json" }), ...extra }, body: form ?? (corpo ? JSON.stringify(corpo) : undefined), signal: AbortSignal.timeout(25_000) });
  } catch { throw new ErroDeskcomm("Não consegui falar com o Deskcomm agora. Tente de novo em instantes.", 502); }
  const txt = await r.text();
  let j: { data?: T; error?: { message?: string } | string; message?: string } = {};
  try { j = txt ? JSON.parse(txt) : {}; } catch { /* resposta fora do padrão */ }
  if (!r.ok) {
    const det = typeof j.error === "string" ? j.error : j.error?.message ?? j.message ?? "";
    if (r.status === 401) throw new ErroDeskcomm("O Deskcomm recusou o token (inválido, revogado ou vencido). Gere outro em Deskcomm → Configurações → API e atualize aqui.", 409);
    if (r.status === 403) throw new ErroDeskcomm(`O token do Deskcomm não tem permissão para enviar mensagens${det ? ` (${det})` : ""}. Gere um com a permissão de escrita (mcp:write).`, 409);
    if (r.status === 404) throw new ErroDeskcomm("O Deskcomm não tem um WhatsApp conectado pronto para enviar. Confira a conexão no Atendimento.", 409);
    if (r.status === 429) throw new ErroDeskcomm("O Deskcomm pediu para esperar (muitos envios seguidos). Tente em alguns minutos.", 429);
    throw new ErroDeskcomm(det || `O Deskcomm recusou o envio (HTTP ${r.status}).`, 502);
  }
  return (j.data ?? (j as unknown)) as T;
}

/** Abre (ou acha) a conversa do telefone e envia o texto pelo canal do atendimento. Devolve o id da mensagem. */
export async function enviarPeloDeskcomm(telefone: string, nome: string, texto: string, http: Http = fetch, seguintes: string[] = [], anexos: { nome: string; conteudo: Buffer; mime: string }[] = []): Promise<{ conversation_id: string; message_id: string | null }> {
  const d = telefone.replace(/\D/g, "");
  if (d.length < 10) throw new ErroDeskcomm("Telefone inválido.", 422);
  const fone = `+${d.startsWith("55") ? d : `55${d}`}`;
  const c = await chamar<{ conversation_id: string }>("POST", "/api/v1/conversations/open-with-contact", { phone_number: fone, name: nome.slice(0, 200) || undefined }, http);
  if (!c?.conversation_id) throw new ErroDeskcomm("O Deskcomm não abriu a conversa deste telefone.", 502);
  const enviar = (corpo: string) => chamar<{ id?: string }>("POST", "/api/v1/messages", { conversation_id: c.conversation_id, type: "text", body: corpo.slice(0, 4096) }, http, { "Idempotency-Key": crypto.randomUUID() });
  const m = await enviar(texto);
  // Primeiro o texto, depois os arquivos (boleto em PDF) e por último os códigos (PIX copia e cola, linha digitável), cada um sozinho: chegam inteiros e fáceis de copiar.
  for (const a of anexos) {
    await new Promise((r) => setTimeout(r, 1200));
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(a.conteudo)], { type: a.mime }), a.nome);
    form.append("nome_arquivo", a.nome); // o Deskcomm atualizado usa este nome; versões antigas ignoram e mantêm o nome gerado
    const up = await chamarForm<{ storage_path: string; media_mime: string; media_size_bytes: number }>("/api/v1/conversations/" + c.conversation_id + "/media", form, http);
    await chamar("POST", "/api/v1/messages", { conversation_id: c.conversation_id, type: "document", media_storage_path: up.storage_path, media_mime: up.media_mime, media_size_bytes: up.media_size_bytes }, http, { "Idempotency-Key": crypto.randomUUID() });
  }
  for (const parte of seguintes) { await new Promise((r) => setTimeout(r, 1200)); await enviar(parte); }
  return { conversation_id: c.conversation_id, message_id: m?.id ?? null };
}

/** Confere se o token vale (autenticação e permissão) sem enviar nada: a rota autentica antes de validar o corpo, então um corpo vazio só falha DEPOIS de o token passar. */
export async function testarDeskcomm(http: Http = fetch): Promise<{ ok: true }> {
  const base = urlDoDeskcomm(), token = tokenDoDeskcomm();
  if (!base) throw new ErroDeskcomm("O atendimento (Deskcomm) não está ligado a este escritório.", 409);
  if (!token) throw new ErroDeskcomm("Cadastre o token primeiro.", 409);
  let r: Response;
  try { r = await http(`${base}/api/v1/conversations/open-with-contact`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({}), signal: AbortSignal.timeout(20_000) }); }
  catch { throw new ErroDeskcomm("Não consegui falar com o Deskcomm. Confira o endereço do atendimento.", 502); }
  if (r.status === 401) throw new ErroDeskcomm("O Deskcomm recusou o token (inválido, revogado ou vencido).", 409);
  if (r.status === 403) throw new ErroDeskcomm("O token não tem permissão de escrita (mcp:write). Gere outro com essa permissão.", 409);
  // Corpo vazio é recusado com 400/422 depois de autenticar: significa que o token vale.
  return { ok: true };
}
