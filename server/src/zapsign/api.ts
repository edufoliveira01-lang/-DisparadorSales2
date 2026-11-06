/** Cliente mínimo da API do ZapSign (criar documento a partir de PDF em base64 e consultar o estado). */
export interface ConfigZapSign { token: string; ambiente: "producao" | "sandbox"; urlBase?: string }

export class ErroZapSign extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const BASES = { producao: "https://api.zapsign.com.br/api/v1", sandbox: "https://sandbox.api.zapsign.com.br/api/v1" } as const;
export const urlBaseDe = (c: ConfigZapSign) => (c.urlBase || BASES[c.ambiente] || BASES.producao).replace(/\/+$/, "");

export interface Signatario { nome: string; email?: string; telefone?: string }
export interface DocumentoZapSign { token: string; status: string; signUrl: string | null; arquivoAssinado: string | null }

const soDigitos = (v: string) => v.replace(/\D/g, "");

function lerDocumento(corpo: any): DocumentoZapSign {
  const s = Array.isArray(corpo?.signers) ? corpo.signers[0] : null;
  return {
    token: String(corpo?.token ?? ""),
    status: String(corpo?.status ?? ""),
    signUrl: s?.sign_url ? String(s.sign_url) : null,
    arquivoAssinado: corpo?.signed_file ? String(corpo.signed_file) : null,
  };
}

async function chamar(c: ConfigZapSign, metodo: "GET" | "POST", caminho: string, corpo: unknown, http: typeof fetch) {
  let r: Response;
  try {
    r = await http(`${urlBaseDe(c)}${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${c.token}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(60_000),
    });
  } catch {
    throw new ErroZapSign("Não foi possível falar com o ZapSign. Tente de novo em instantes.", 504);
  }
  const texto = await r.text();
  let json: any = null;
  try { json = texto ? JSON.parse(texto) : null; } catch { /* resposta não-JSON */ }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) throw new ErroZapSign("O ZapSign recusou a chave de acesso. Confira o token e o ambiente (teste ou produção) em Atendimento.", 409);
    throw new ErroZapSign(`O ZapSign recusou o pedido (${r.status}).${json?.detail ? ` ${String(json.detail).slice(0, 200)}` : ""}`, 502);
  }
  return json;
}

/** Cria o documento e devolve o link de assinatura. O e-mail do signatário (se houver) recebe a cópia/convite do próprio ZapSign. */
export async function criarDocumento(
  c: ConfigZapSign,
  d: { nome: string; pdfBase64: string; signatario: Signatario; idExterno?: string },
  http: typeof fetch = fetch,
): Promise<DocumentoZapSign> {
  const tel = soDigitos(d.signatario.telefone ?? "");
  const local = tel.startsWith("55") && tel.length >= 12 ? tel.slice(2) : tel;
  const signer: Record<string, unknown> = {
    name: d.signatario.nome,
    auth_mode: "assinaturaTela",
    send_automatic_email: Boolean(d.signatario.email),
    ...(d.signatario.email ? { email: d.signatario.email } : {}),
    ...(local.length >= 10 ? { phone_country: "55", phone_number: local } : {}),
  };
  const json = await chamar(c, "POST", "/docs/", {
    name: d.nome,
    base64_pdf: d.pdfBase64,
    lang: "pt-br",
    external_id: d.idExterno,
    signers: [signer],
  }, http);
  const doc = lerDocumento(json);
  if (!doc.token || !doc.signUrl) throw new ErroZapSign("O ZapSign não devolveu o link de assinatura.");
  return doc;
}

export async function consultarDocumento(c: ConfigZapSign, token: string, http: typeof fetch = fetch): Promise<DocumentoZapSign> {
  return lerDocumento(await chamar(c, "GET", `/docs/${encodeURIComponent(token)}/`, undefined, http));
}
