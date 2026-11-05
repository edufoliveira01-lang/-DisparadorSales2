import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

/**
 * Assinatura das chamadas à ponte do atendimento (LexSync/DeskcommCRM). O formato é o MESMO de sales-bridge/src/assinatura.ts
 * no repositório LexSync; o vetor de teste fixo em tests/atendimento.test.ts garante que os dois lados não divergem.
 */
const sha256 = (v: string) => createHash("sha256").update(v).digest("hex");
const hmac = (chave: string, texto: string) => createHmac("sha256", chave).update(texto).digest("hex");
const b64u = (b: string) => Buffer.from(b).toString("base64url");

export const assinarRequisicao = (segredo: string, d: { metodo: string; caminho: string; corpo: string }, ts: number) =>
  hmac(segredo, `${ts}.${d.metodo.toUpperCase()}.${d.caminho}.${sha256(d.corpo)}`);

/** Chave própria de cada escritório para a entrada direta (derivada do segredo geral; só o painel conhece o segredo). */
export const chaveSso = (segredo: string, slug: string) => hmac(segredo, `sso:${slug}`);

export function emitirTokenSso(chave: string, d: { slug: string; email: string }, agora = Math.floor(Date.now() / 1000), validadeS = 60): string {
  const carga = b64u(JSON.stringify({ slug: d.slug, email: d.email, exp: agora + validadeS, jti: randomUUID() }));
  return `${carga}.${hmac(chave, carga)}`;
}

const igual = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
export const JANELA_SEGUNDOS = 300;

/** Lado que RECEBE as chamadas (ponte embutida no painel): confere método, caminho e corpo dentro de uma janela de 5 minutos. */
export function verificarRequisicao(segredo: string, d: { metodo: string; caminho: string; corpo: string }, ts: string | undefined, assinatura: string | undefined, agora = Math.floor(Date.now() / 1000)): boolean {
  const n = Number(ts);
  if (!segredo || !assinatura || !Number.isInteger(n) || Math.abs(agora - n) > JANELA_SEGUNDOS) return false;
  return igual(assinarRequisicao(segredo, d, n), assinatura);
}

export interface TokenSso { slug: string; email: string; exp: number; jti: string }
export function lerTokenSso(segredo: string, token: string, agora = Math.floor(Date.now() / 1000)): TokenSso | null {
  const [carga, assinatura, resto] = String(token).split(".");
  if (!carga || !assinatura || resto !== undefined) return null;
  let d: TokenSso;
  try { d = JSON.parse(Buffer.from(carga, "base64url").toString("utf8")) as TokenSso; } catch { return null; }
  if (typeof d?.slug !== "string" || typeof d.email !== "string" || typeof d.jti !== "string" || !Number.isInteger(d.exp) || !/^[a-z0-9-]{2,40}$/.test(d.slug)) return null;
  if (!igual(hmac(chaveSso(segredo, d.slug), carga), assinatura) || d.exp < agora) return null;
  return d;
}
