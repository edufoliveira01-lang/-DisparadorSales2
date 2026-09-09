import crypto from "node:crypto";
import { db } from "../db";

const ENCRYPTED_KEYS = new Set(["trello_token", "telegram_bot_token", "whapi_token", "google_refresh_token"]);

function getEncryptionKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || "chave-padrao-nao-segura-troque-no-env";
  return crypto.createHash("sha256").update(secret).digest();
}

function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, encrypted]).toString("base64");
}

function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0, 12);
  const authTag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", getEncryptionKey(), iv);
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
  return ENCRYPTED_KEYS.has(chave) ? decrypt(row.valor) : row.valor;
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
