import crypto from "node:crypto";
import { db } from "../db";
import type { AccessUser } from "./accessService";

export interface User extends AccessUser {
  password_hash: string;
}

interface UserWithRecovery extends User {
  recovery_token: string | null;
  recovery_expires: string | null;
}

const RECOVERY_TOKEN_DURATION_HOURS = 1;

export interface Session {
  id: string;
  user_id: number;
  expires_at: string;
  last_activity: string;
}

const SESSION_DURATION_HOURS = 3;

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString("hex");
  return `scrypt$${salt}$${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length === 3 && parts[0] === "scrypt" && /^[a-f0-9]{32}$/.test(parts[1]) && /^[a-f0-9]{128}$/.test(parts[2])) {
    const actual = crypto.scryptSync(password, parts[1], 64);
    return crypto.timingSafeEqual(actual, Buffer.from(parts[2], "hex"));
  }
  if (/^[a-f0-9]{64}$/.test(stored)) {
    return crypto.timingSafeEqual(crypto.createHash("sha256").update(password).digest(), Buffer.from(stored, "hex"));
  }
  return false;
}

export function getUserByUsername(username: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as User | undefined;
}

export function getUserById(id: number): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export function updateUser(id: number, data: Partial<Pick<User, "username" | "email" | "display_name" | "password_hash" | "must_change_password">>) {
  const fields = Object.keys(data).map(f => `${f} = ?`).join(", ");
  if (!fields) return;
  const values = Object.values(data);
  db.prepare(`UPDATE users SET ${fields} WHERE id = ?`).run(...values, id);
}

/** Gera um token de recuperação de senha (válido por 1h) e salva no usuário. */
export function generateRecoveryToken(userId: number): string {
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RECOVERY_TOKEN_DURATION_HOURS * 60 * 60 * 1000).toISOString();

  db.prepare("UPDATE users SET recovery_token = ?, recovery_expires = ? WHERE id = ?").run(token, expiresAt, userId);

  return token;
}

/** Retorna o usuário dono do token, ou undefined se o token não existir ou já tiver expirado. */
export function getUserByRecoveryToken(token: string): User | undefined {
  const user = db.prepare("SELECT * FROM users WHERE recovery_token = ?").get(token) as UserWithRecovery | undefined;
  if (!user || !user.active) return undefined;

  if (!user.recovery_expires || new Date(user.recovery_expires) < new Date()) {
    clearRecoveryToken(user.id);
    return undefined;
  }

  return user;
}

/** Invalida o token de recuperação — chamado após o uso (senha trocada) ou quando ele expira. */
export function clearRecoveryToken(userId: number): void {
  db.prepare("UPDATE users SET recovery_token = NULL, recovery_expires = NULL WHERE id = ?").run(userId);
}

export function createSession(userId: number): string {
  const sessionId = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();
  
  db.prepare("INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
    .run(sessionId, userId, expiresAt);
    
  return sessionId;
}

export function getSession(sessionId: string, touch = true): Session | undefined {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as Session | undefined;
  
  if (!session) return undefined;
  
  // Verificar expiração
  if (new Date(session.expires_at) < new Date()) {
    deleteSession(sessionId);
    return undefined;
  }
  
  // Verificar inatividade (3 horas)
  const lastActivity = new Date(session.last_activity.includes("T") ? session.last_activity : session.last_activity.replace(" ", "T") + "Z");
  const threeHoursAgo = new Date(Date.now() - SESSION_DURATION_HOURS * 60 * 60 * 1000);
  
  if (lastActivity < threeHoursAgo) {
    deleteSession(sessionId);
    return undefined;
  }
  
  // Atualizar última atividade
  if (touch) db.prepare("UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
  
  return session;
}

export function deleteSession(sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function cleanupSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP").run();
}

