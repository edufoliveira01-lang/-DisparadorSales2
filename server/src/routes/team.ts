import { Router } from "express";
import { db } from "../db";
import { hashPassword, getUserById, type User } from "../services/authService";
import {
  auditAccess, effectivePermissions, invalidateUserSessions, isRole,
  publicUser, PERMISSIONS, ROLE_PERMISSIONS, validPermissions, type Permission, type Role,
} from "../services/accessService";
import { disconnectUserSockets } from "../websocket";

export const teamRouter = Router();
teamRouter.use((req, res, next) => req.accessUser?.role === "administrador" ? next() : res.status(403).json({ error: "A gestão da equipe é exclusiva do administrador." }));

function parseInput(body: Record<string, unknown>, existing?: User) {
  const username = String(body.username ?? existing?.username ?? "").trim();
  const displayName = String(body.display_name ?? existing?.display_name ?? "").trim();
  const email = String(body.email ?? existing?.email ?? "").trim();
  const role = body.role ?? existing?.role ?? "consulta";
  const active = body.active === undefined ? (existing ? Boolean(existing.active) : true) : body.active === true;
  if (!/^[a-zA-Z0-9._-]{3,40}$/.test(username)) throw new Error("O usuário deve ter de 3 a 40 caracteres (letras, números, ponto, traço ou sublinhado).");
  if (displayName.length < 2 || displayName.length > 100) throw new Error("Informe o nome da pessoa (2 a 100 caracteres).");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Informe um e-mail válido.");
  if (!isRole(role)) throw new Error("Perfil inválido.");
  const rawPermissions = body.permissions === undefined
    ? existing && existing.role === role ? effectivePermissions(existing) : ROLE_PERMISSIONS[role]
    : body.permissions;
  if (!validPermissions(rawPermissions)) throw new Error("Permissões inválidas.");
  const permissions = [...new Set(rawPermissions)] as Permission[];
  if (role !== "administrador" && permissions.some((permission) => permission === "team.manage" || permission === "backup.manage")) {
    throw new Error("Equipe e backup são exclusivos de administradores.");
  }
  return { username, displayName, email: email || null, role: role as Role, active, permissions };
}

teamRouter.get("/", (_req, res) => {
  const users = db.prepare("SELECT * FROM users ORDER BY active DESC, display_name COLLATE NOCASE, username COLLATE NOCASE").all() as User[];
  res.json(users.map(publicUser));
});

teamRouter.get("/profiles", (_req, res) => res.json({ roles: ROLE_PERMISSIONS, permissions: PERMISSIONS }));

teamRouter.get("/audit", (_req, res) => {
  const rows = db.prepare(`SELECT a.id, a.action, a.details_json, a.created_at,
    u.username AS actor, t.username AS target
    FROM access_audit a LEFT JOIN users u ON u.id = a.actor_user_id
    LEFT JOIN users t ON t.id = a.target_user_id
    ORDER BY a.id DESC LIMIT 100`).all();
  res.json(rows);
});

teamRouter.post("/", (req, res) => {
  try {
    const input = parseInput(req.body || {});
    const password = req.body?.password;
    if (typeof password !== "string" || password.length < 12) return res.status(400).json({ error: "Informe uma senha inicial de pelo menos 12 caracteres." });
    const info = db.prepare(`INSERT INTO users (username, display_name, email, role, permissions_json, active, password_hash)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(input.username, input.displayName, input.email, input.role,
        JSON.stringify(input.permissions), input.active ? 1 : 0, hashPassword(password));
    const user = getUserById(Number(info.lastInsertRowid))!;
    auditAccess("pessoa_criada", req.accessUser!.id, user.id, { perfil: user.role, permissoes: input.permissions });
    res.status(201).json(publicUser(user));
  } catch (error) {
    res.status(error instanceof Error && error.message.includes("UNIQUE") ? 409 : 400).json({ error: error instanceof Error && error.message.includes("UNIQUE") ? "Este usuário já está em uso." : (error as Error).message });
  }
});

teamRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = Number.isSafeInteger(id) ? getUserById(id) : undefined;
  if (!existing) return res.status(404).json({ error: "Pessoa não encontrada." });
  try {
    const input = parseInput(req.body || {}, existing);
    if (id === req.accessUser!.id && (!input.active || input.role !== "administrador")) {
      return res.status(400).json({ error: "Você não pode desativar ou remover seu próprio acesso administrativo." });
    }
    if (existing.role === "administrador" && (!input.active || input.role !== "administrador")) {
      const others = db.prepare("SELECT count(*) AS total FROM users WHERE role = 'administrador' AND active = 1 AND id != ?").get(id) as { total: number };
      if (!others.total) return res.status(400).json({ error: "É necessário manter ao menos um administrador ativo." });
    }
    db.prepare(`UPDATE users SET username = ?, display_name = ?, email = ?, role = ?, permissions_json = ?, active = ? WHERE id = ?`)
      .run(input.username, input.displayName, input.email, input.role, JSON.stringify(input.permissions), input.active ? 1 : 0, id);
    const changed = existing.role !== input.role || existing.active !== Number(input.active)
      || JSON.stringify(effectivePermissions(existing)) !== JSON.stringify(input.permissions);
    if (changed) { invalidateUserSessions(id); disconnectUserSockets(id); }
    auditAccess("pessoa_atualizada", req.accessUser!.id, id, { perfil: input.role, ativo: input.active, permissoes: input.permissions });
    res.json(publicUser(getUserById(id)!));
  } catch (error) {
    res.status(error instanceof Error && error.message.includes("UNIQUE") ? 409 : 400).json({ error: error instanceof Error && error.message.includes("UNIQUE") ? "Este usuário já está em uso." : (error as Error).message });
  }
});

teamRouter.put("/:id/password", (req, res) => {
  const id = Number(req.params.id);
  const user = Number.isSafeInteger(id) ? getUserById(id) : undefined;
  if (!user) return res.status(404).json({ error: "Pessoa não encontrada." });
  const password = req.body?.password;
  if (typeof password !== "string" || password.length < 12) return res.status(400).json({ error: "Informe uma senha de pelo menos 12 caracteres." });
  db.prepare("UPDATE users SET password_hash = ?, recovery_token = NULL, recovery_expires = NULL WHERE id = ?")
    .run(hashPassword(password), id);
  invalidateUserSessions(id);
  disconnectUserSockets(id);
  auditAccess("senha_redefinida", req.accessUser!.id, id);
  res.json({ ok: true, relogin: id === req.accessUser!.id });
});
