import { createHash, createHmac, randomUUID } from "node:crypto";

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
