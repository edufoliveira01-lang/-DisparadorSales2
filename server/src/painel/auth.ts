import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { Banco } from "./banco";
import type { ConfigPainel } from "./config";

const scrypt = promisify(scryptCb) as (senha: string, sal: Buffer, tam: number) => Promise<Buffer>;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export async function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  const h = await scrypt(senha, sal, 64);
  return `scrypt$${sal.toString("base64")}$${h.toString("base64")}`;
}
export async function conferirSenha(senha: string, guardado: string): Promise<boolean> {
  const [alg, sal, hash] = guardado.split("$");
  if (alg !== "scrypt" || !sal || !hash) return false;
  const esperado = Buffer.from(hash, "base64");
  const h = await scrypt(senha, Buffer.from(sal, "base64"), esperado.length);
  return h.length === esperado.length && timingSafeEqual(h, esperado);
}

/** Cria o administrador na primeira execução, a partir de PAINEL_ADMIN_PASSWORD (mínimo 12 caracteres). */
export async function garantirAdmin(db: Banco, cfg: ConfigPainel): Promise<"existente" | "criado" | "ausente"> {
  if (db.prepare("SELECT usuario FROM admins LIMIT 1").get()) return "existente";
  if (cfg.adminSenhaInicial.length < 12) return "ausente";
  db.prepare("INSERT INTO admins(usuario,senha_hash,criado_em) VALUES (?,?,?)").run(cfg.adminUsuario, await hashSenha(cfg.adminSenhaInicial), new Date().toISOString());
  return "criado";
}

export async function entrar(db: Banco, cfg: ConfigPainel, usuario: string, senha: string, agora = new Date()): Promise<string | null> {
  const adm = db.prepare("SELECT * FROM admins WHERE usuario=?").get(usuario) as { usuario: string; senha_hash: string } | undefined;
  // Mesmo custo quando o usuário não existe, para não revelar quais usuários existem.
  const ok = await conferirSenha(senha, adm?.senha_hash ?? "scrypt$AAAAAAAAAAAAAAAAAAAAAA==$AAAA");
  if (!adm || !ok) return null;
  const token = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM sessoes WHERE expira_em < ?").run(agora.toISOString());
  db.prepare("INSERT INTO sessoes(token_hash,usuario,criado_em,expira_em) VALUES (?,?,?,?)")
    .run(sha(token), usuario, agora.toISOString(), new Date(agora.getTime() + cfg.sessaoHoras * 3_600_000).toISOString());
  return token;
}
export function usuarioDaSessao(db: Banco, token: unknown, agora = new Date()): string | null {
  if (typeof token !== "string" || token.length < 20 || token.length > 100) return null;
  const s = db.prepare("SELECT usuario,expira_em FROM sessoes WHERE token_hash=?").get(sha(token)) as { usuario: string; expira_em: string } | undefined;
  return s && s.expira_em > agora.toISOString() ? s.usuario : null;
}
export function sair(db: Banco, token: unknown) {
  if (typeof token === "string") db.prepare("DELETE FROM sessoes WHERE token_hash=?").run(sha(token));
}

/** Limitador simples por chave (IP). Em memória: suficiente para um painel de uso interno. */
export function criarLimitador(max: number, janelaMs: number) {
  const m = new Map<string, { n: number; fim: number }>();
  return (chave: string, agora = Date.now()): boolean => {
    const e = m.get(chave);
    if (!e || e.fim <= agora) { m.set(chave, { n: 1, fim: agora + janelaMs }); if (m.size > 5000) for (const [k, v] of m) if (v.fim <= agora) m.delete(k); return true; }
    e.n++;
    return e.n <= max;
  };
}
