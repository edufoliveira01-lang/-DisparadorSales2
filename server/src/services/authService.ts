import crypto from "node:crypto";
import { db } from "../db";

export interface User {
  id: number;
  username: string;
  email: string | null;
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
  return crypto.createHash("sha256").update(password).digest("hex");
}

export function getUserByUsername(username: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as User | undefined;
}

export function getUserById(id: number): User | undefined {
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as User | undefined;
}

export function updateUser(id: number, data: Partial<Omit<User, "id">>) {
  const fields = Object.keys(data).map(f => `${f} = ?`).join(", ");
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
  if (!user) return undefined;

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

export function getSession(sessionId: string): Session | undefined {
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(sessionId) as Session | undefined;
  
  if (!session) return undefined;
  
  // Verificar expiração
  if (new Date(session.expires_at) < new Date()) {
    deleteSession(sessionId);
    return undefined;
  }
  
  // Verificar inatividade (3 horas)
  const lastActivity = new Date(session.last_activity);
  const threeHoursAgo = new Date(Date.now() - SESSION_DURATION_HOURS * 60 * 60 * 1000);
  
  if (lastActivity < threeHoursAgo) {
    deleteSession(sessionId);
    return undefined;
  }
  
  // Atualizar última atividade
  db.prepare("UPDATE sessions SET last_activity = CURRENT_TIMESTAMP WHERE id = ?").run(sessionId);
  
  return session;
}

export function deleteSession(sessionId: string): void {
  db.prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
}

export function cleanupSessions(): void {
  db.prepare("DELETE FROM sessions WHERE expires_at < CURRENT_TIMESTAMP").run();
}
