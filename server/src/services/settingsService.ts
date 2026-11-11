import crypto from "node:crypto";
import { db } from "../db";

const ENCRYPTED_KEYS = new Set(["trello_token", "telegram_bot_token", "whapi_token", "google_refresh_token", "ai_openai_api_key", "ai_anthropic_api_key", "asaas_api_key", "asaas_webhook_token"]);
const LEGACY_DEFAULT_SECRET = "chave-padrao-nao-segura-troque-no-env";

export class SettingDecryptionError extends Error {
  chave: string;

  constructor(chave: string) {
    super(`A credencial salva em "${chave}" não pode ser lida com a ENCRYPTION_KEY atual.`);
    this.name = "SettingDecryptionError";
    this.chave = chave;
  }
}

function getEncryptionKey(secret = process.env.ENCRYPTION_KEY || LEGACY_DEFAULT_SECRET): Buffer {
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decrypt(payload: string, secret?: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(secret), iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
}

const upsertStmt = db.prepare(
  `INSERT INTO settings (chave, valor) VALUES (?, ?)
   ON CONFLICT(chave) DO UPDATE SET valor = excluded.valor`
);
const getStmt = db.prepare("SELECT valor FROM settings WHERE chave = ?");
const getAllStmt = db.prepare("SELECT chave, valor FROM settings");
const deleteStmt = db.prepare("DELETE FROM settings WHERE chave = ?");

export function setSetting(chave: string, valor: string): void {
  const stored = ENCRYPTED_KEYS.has(chave) ? encrypt(valor) : valor;
  upsertStmt.run(chave, stored);
}

export function getSetting(chave: string): string | null {
  const row = getStmt.get(chave) as { valor: string } | undefined;
  if (!row) return null;
  if (!ENCRYPTED_KEYS.has(chave)) return row.valor;
  try {
    return decrypt(row.valor);
  } catch {
    // Instalações antigas podiam ter salvo tokens com a chave padrão. Quando o administrador
    // adiciona ENCRYPTION_KEY para habilitar o Google Agenda, recupera uma única vez com a
    // chave legada e já regrava usando a chave segura, sem interromper Trello/Telegram/Whapi.
    if (process.env.ENCRYPTION_KEY) {
      try {
        const plain = decrypt(row.valor, LEGACY_DEFAULT_SECRET);
        upsertStmt.run(chave, encrypt(plain));
        return plain;
      } catch {
        // A credencial foi cifrada com outra chave e precisa ser informada novamente.
      }
    }
    throw new SettingDecryptionError(chave);
  }
}

export function getAllSettings(): Record<string, string> {
  const rows = getAllStmt.all() as { chave: string; valor: string }[];
  const result: Record<string, string> = {};
  for (const row of rows) {
    result[row.chave] = ENCRYPTED_KEYS.has(row.chave) ? "" : row.valor;
  }
  // Expor apenas se existe, sem vazar o valor de campos sensíveis
  for (const key of ENCRYPTED_KEYS) {
    if (rows.some((r) => r.chave === key)) {
      result[`${key}_configurado`] = "true";
    }
  }
  return result;
}

export function deleteSetting(chave: string): void {
  deleteStmt.run(chave);
}

