import crypto from "node:crypto";
import { ErroGestao } from "./erro";

/** Criptografia (AES-256-GCM) dos campos do tipo "senha". A chave vem da ENCRYPTION_KEY do escritório. */
function chave(): Buffer {
  const segredo = process.env.ENCRYPTION_KEY || "";
  if (segredo.length < 32) throw new ErroGestao("Para guardar senhas, o servidor precisa de uma ENCRYPTION_KEY de pelo menos 32 caracteres. Fale com o suporte.", 503);
  return crypto.createHash("sha256").update(segredo).digest();
}
export function cifrar(texto: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", chave(), iv);
  const dados = Buffer.concat([c.update(texto, "utf8"), c.final()]);
  return `v1:${Buffer.concat([iv, c.getAuthTag(), dados]).toString("base64")}`;
}
export function decifrar(payload: string): string {
  if (!payload.startsWith("v1:")) throw new ErroGestao("Valor protegido em formato desconhecido.", 500);
  const raw = Buffer.from(payload.slice(3), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", chave(), raw.subarray(0, 12));
  d.setAuthTag(raw.subarray(12, 28));
  try { return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8"); }
  catch { throw new ErroGestao("Não foi possível ler a senha: a chave de criptografia do servidor mudou.", 409); }
}
