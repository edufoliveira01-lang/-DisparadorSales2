import { db } from "../db";
import { cifrar, decifrar } from "../services/gestao/segredos";
import type { ConfigZapSign } from "./api";

db.exec(`CREATE TABLE IF NOT EXISTS zapsign_config (id INTEGER PRIMARY KEY CHECK(id=1), token_cifrado TEXT NOT NULL DEFAULT '', ambiente TEXT NOT NULL DEFAULT 'producao', atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);

interface Linha { token_cifrado: string; ambiente: string }
const linha = () => db.prepare("SELECT token_cifrado, ambiente FROM zapsign_config WHERE id=1").get() as Linha | undefined;

/** Configuração completa (com o token em claro) — só para uso interno do servidor. Variáveis de ambiente valem se nada foi salvo na tela. */
export function lerConfigZapSign(env: NodeJS.ProcessEnv = process.env): ConfigZapSign | null {
  const l = linha();
  if (l?.token_cifrado) return { token: decifrar(l.token_cifrado), ambiente: l.ambiente === "sandbox" ? "sandbox" : "producao" };
  const t = (env.ZAPSIGN_TOKEN || "").trim();
  return t ? { token: t, ambiente: env.ZAPSIGN_AMBIENTE === "sandbox" ? "sandbox" : "producao" } : null;
}

/** O que a tela pode ver: nunca o token inteiro. */
export function configPublicaZapSign() {
  const c = lerConfigZapSign();
  return { configurado: Boolean(c), ambiente: c?.ambiente ?? "producao", token_final: c ? `…${c.token.slice(-4)}` : "" };
}

export function salvarConfigZapSign(d: { token?: unknown; ambiente?: unknown }) {
  const atual = linha();
  const ambiente = d.ambiente === "sandbox" ? "sandbox" : "producao";
  const novo = typeof d.token === "string" ? d.token.trim() : "";
  if (novo && (novo.length < 20 || /\s/.test(novo))) throw new Error("O token do ZapSign parece inválido.");
  const cifrado = novo ? cifrar(novo) : atual?.token_cifrado ?? "";
  db.prepare("INSERT INTO zapsign_config(id,token_cifrado,ambiente) VALUES (1,?,?) ON CONFLICT(id) DO UPDATE SET token_cifrado=excluded.token_cifrado, ambiente=excluded.ambiente, atualizado_em=CURRENT_TIMESTAMP").run(cifrado, ambiente);
  return configPublicaZapSign();
}
