import { db } from "../db";
import { recursoLiberadoNaLicenca } from "../licenca/cliente";
import { atendimentoDaInstancia } from "../atendimento/instancia";

export const PERMISSIONS = [
  "dashboard.view", "calendar.view", "calendar.manage", "templates.view", "templates.manage",
  "pending.view", "pending.manage", "history.view", "history.manage", "messages.send",
  "contacts.view", "contacts.manage", "processes.view", "processes.manage",
  "djen.manage", "deadlines.view", "deadlines.manage", "activity.view",
  "integrations.manage", "whatsapp.manage", "team.manage", "backup.manage",
  "gestao.view", "gestao.manage", "financeiro.view", "financeiro.manage", "atendimento.use",
] as const;
export type Permission = typeof PERMISSIONS[number];
export type Role = "administrador" | "gestor" | "advogado" | "atendimento" | "consulta";

const ALL = [...PERMISSIONS];
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  administrador: ALL,
  gestor: ALL.filter((p) => !["team.manage", "backup.manage", "integrations.manage"].includes(p)),
  advogado: ["dashboard.view", "calendar.view", "contacts.view", "processes.view", "processes.manage", "deadlines.view", "deadlines.manage", "activity.view", "gestao.view", "gestao.manage"],
  atendimento: ["dashboard.view", "calendar.view", "calendar.manage", "templates.view", "templates.manage", "pending.view", "pending.manage", "history.view", "contacts.view", "contacts.manage", "messages.send", "gestao.view", "gestao.manage", "atendimento.use"],
  consulta: ["dashboard.view", "calendar.view", "templates.view", "pending.view", "history.view", "contacts.view", "processes.view", "deadlines.view", "gestao.view"],
};

export interface AccessUser {
  id: number;
  username: string;
  display_name: string | null;
  email: string | null;
  role: Role;
  permissions_json: string | null;
  active: number;
  must_change_password?: number;
  home_page?: string | null;
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, value);
}

export function validPermissions(value: unknown): value is Permission[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string" && (PERMISSIONS as readonly string[]).includes(item));
}

export function effectivePermissions(user: AccessUser): Permission[] {
  if (user.role === "administrador") return ALL;
  if (!user.permissions_json) return [...ROLE_PERMISSIONS[user.role]];
  try {
    const saved: unknown = JSON.parse(user.permissions_json);
    return validPermissions(saved) ? [...new Set(saved)] : [];
  } catch {
    return [];
  }
}

export function hasPermission(user: AccessUser, permission: Permission): boolean {
  return user.active === 1 && effectivePermissions(user).includes(permission);
}

const MODULOS_DO_MENU = ["modulo_arquivos", "modulo_tarefas", "modulo_indicadores", "modulo_captacao", "modulo_contratos", "modulo_financeiro"] as const;

export function publicUser(user: AccessUser) {
  return {
    id: user.id, username: user.username, display_name: user.display_name,
    email: user.email, role: user.role, active: Boolean(user.active),
    permissions: effectivePermissions(user).filter((p) =>
      p === "atendimento.use" ? atendimentoDaInstancia() !== null :
      p.startsWith("gestao.") ? recursoLiberadoNaLicenca("modulo_gestao") : p.startsWith("financeiro.") ? recursoLiberadoNaLicenca("modulo_gestao") && recursoLiberadoNaLicenca("modulo_financeiro") : true),
    must_change_password: Boolean(user.must_change_password),
    home_page: user.home_page || "",
    // Módulos que o plano não inclui: a interface esconde os atalhos (o servidor já recusa o acesso).
    modulos_bloqueados: MODULOS_DO_MENU.filter((m) => !recursoLiberadoNaLicenca(m)),
  };
}

export function invalidateUserSessions(userId: number): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

export function auditAccess(action: string, actorId: number | null, targetId: number | null, details?: object): void {
  db.prepare(`INSERT INTO access_audit (action, actor_user_id, target_user_id, details_json)
    VALUES (?, ?, ?, ?)`).run(action, actorId, targetId, details ? JSON.stringify(details) : null);
}
