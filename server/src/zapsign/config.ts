import { db } from "../db";
import { cifrar, decifrar } from "../services/gestao/segredos";
import type { ConfigZapSign } from "./api";

db.exec(`CREATE TABLE IF NOT EXISTS zapsign_config (id INTEGER PRIMARY KEY CHECK(id=1), token_cifrado TEXT NOT NULL DEFAULT '', ambiente TEXT NOT NULL DEFAULT 'producao', atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
if (!(db.prepare("PRAGMA table_info(zapsign_config)").all() as { name: string }[]).some((c) => c.name === "modelo_id")) db.exec("ALTER TABLE zapsign_config ADD COLUMN modelo_id TEXT NOT NULL DEFAULT ''");

interface Linha { token_cifrado: string; ambiente: string; modelo_id: string }
const linha = () => db.prepare("SELECT token_cifrado, ambiente, modelo_id FROM zapsign_config WHERE id=1").get() as Linha | undefined;

/** Configuração completa (com o token em claro) — só para uso interno do servidor. Variáveis de ambiente valem se nada foi salvo na tela. */
export function lerConfigZapSign(env: NodeJS.ProcessEnv = process.env): ConfigZapSign | null {
  const l = linha();
  if (l?.token_cifrado) return { token: decifrar(l.token_cifrado), ambiente: l.ambiente === "sandbox" ? "sandbox" : "producao", ...(l.modelo_id ? { modeloId: l.modelo_id } : {}) };
  const t = (env.ZAPSIGN_TOKEN || "").trim();
  return t ? { token: t, ambiente: env.ZAPSIGN_AMBIENTE === "sandbox" ? "sandbox" : "producao" } : null;
}

/** O que a tela pode ver: nunca o token inteiro. */
export function configPublicaZapSign() {
  const c = lerConfigZapSign();
  return { configurado: Boolean(c), ambiente: c?.ambiente ?? "producao", token_final: c ? `…${c.token.slice(-4)}` : "", modelo_id: c?.modeloId ?? "" };
}

export function salvarConfigZapSign(d: { token?: unknown; ambiente?: unknown; modelo_id?: unknown }) {
  const atual = linha();
  const ambiente = d.ambiente === "sandbox" ? "sandbox" : "producao";
  const novo = typeof d.token === "string" ? d.token.trim() : "";
  if (novo && (novo.length < 20 || /\s/.test(novo))) throw new Error("O token do ZapSign parece inválido.");
  const cifrado = novo ? cifrar(novo) : atual?.token_cifrado ?? "";
  const modelo = typeof d.modelo_id === "string" ? d.modelo_id.trim() : atual?.modelo_id ?? "";
  if (modelo && !/^[A-Za-z0-9._-]{8,80}$/.test(modelo)) throw new Error("O ID do modelo parece inválido (use só o código, sem espaços).");
  db.prepare("INSERT INTO zapsign_config(id,token_cifrado,ambiente,modelo_id) VALUES (1,?,?,?) ON CONFLICT(id) DO UPDATE SET token_cifrado=excluded.token_cifrado, ambiente=excluded.ambiente, modelo_id=excluded.modelo_id, atualizado_em=CURRENT_TIMESTAMP").run(cifrado, ambiente, modelo);
  return configPublicaZapSign();
}
