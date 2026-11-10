import type { RequestHandler } from "express";
import { getSession, getUserById } from "../services/authService";
import { auditAccess, hasPermission, type AccessUser, type Permission } from "../services/accessService";

declare global {
  namespace Express {
    interface Request { accessUser?: AccessUser }
  }
}

function permissionsFor(path: string, method: string): Permission[] {
  const read = method === "GET" || method === "HEAD";
  if (path === "/license/status") return []; // qualquer pessoa autenticada vê o aviso da assinatura
  if (path.startsWith("/license")) return ["team.manage"];
  if (path === "/ai" || path.startsWith("/ai/")) return ["integrations.manage"];
  if (path.startsWith("/team")) return ["team.manage"];
  if (path.startsWith("/armazenamento") || path.startsWith("/dropbox")) return ["integrations.manage"]; // drive externo (Dropbox): como as demais integrações
  if (path.startsWith("/branding")) return ["team.manage"];
  if (path.startsWith("/backup")) return ["backup.manage"];
  if (path.startsWith("/settings") || path.startsWith("/trello") || path.startsWith("/google-calendar")) return ["integrations.manage"];
  if (path.startsWith("/whatsapp")) {
    if (path === "/whatsapp/status") return [];
    return ["whatsapp.manage"];
  }
  if (path.startsWith("/system-logs")) return ["activity.view"];
  if (path.startsWith("/contacts")) return [read ? "contacts.view" : "contacts.manage"];
  if (path.startsWith("/cards")) return [read ? "dashboard.view" : "calendar.manage"];
  if (path.startsWith("/templates") || path.startsWith("/message-templates")) return [read || path.endsWith("/preview") ? "templates.view" : "templates.manage"];
  if (path.startsWith("/send")) return ["messages.send"];
  if (path.startsWith("/logs")) return [read ? "history.view" : path.includes("/reenviar") ? "messages.send" : "history.manage"];
  if (path.startsWith("/pending-replies")) return [read ? "pending.view" : path.endsWith("/cobrar") ? "messages.send" : "pending.manage"];
  if (path.startsWith("/pericias-agendadas")) return [
    read ? "calendar.view" : /lembrete|completar-telefone|completar-processo/.test(path) ? "messages.send" : "calendar.manage",
  ];
  if (path.startsWith("/atendimento")) return ["atendimento.use"];
  if (path.startsWith("/gestao/financeiro")) return [read ? "financeiro.view" : "financeiro.manage"];
  if (path.startsWith("/gestao")) return [read ? "gestao.view" : "gestao.manage"];
  if (path.startsWith("/djen")) {
    const sub = path.slice(5);
    if (sub.startsWith("/calendarios") || sub.startsWith("/prazos/config")) return [read ? "deadlines.view" : "deadlines.manage"];
    if (sub.includes("/prazos") || sub === "/prazos") return [read ? "deadlines.view" : "deadlines.manage"];
    if (sub.includes("/mensagem")) return ["processes.view", "messages.send"];
    if (sub.startsWith("/buscar") || sub.startsWith("/config") || (sub.startsWith("/codex") || sub.startsWith("/ia")) || (!read && sub.startsWith("/advogados"))) return ["djen.manage"];
    return [read ? "processes.view" : "processes.manage"];
  }
  // Novas rotas exigem classificação explícita antes de entrar em produção.
  return ["team.manage"];
}

export const authenticatedApi: RequestHandler = (req, res, next) => {
  if (req.path === "/health") return next();
  const sessionId = req.cookies?.session_id;
  if (!sessionId) return res.status(401).json({ error: "Não autenticado." });
  const session = getSession(sessionId);
  const user = session && getUserById(session.user_id);
  if (!user || !user.active) return res.status(401).json({ error: "Sessão expirada." });
  req.accessUser = user;
  // Senha definida por outra pessoa: nada funciona até a pessoa criar a própria (POST /api/auth/trocar-senha-inicial).
  if (user.must_change_password) return res.status(403).json({ error: "Crie sua senha pessoal para continuar.", codigo: "troca_de_senha_obrigatoria" });
  const missing = permissionsFor(req.path, req.method).filter((permission) => !hasPermission(user, permission));
  if (missing.length) return res.status(403).json({ error: "Você não tem permissão para esta área ou ação." });
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    res.on("finish", () => {
      if (res.statusCode < 200 || res.statusCode >= 300) return;
      try { auditAccess("operacao", user.id, null, { metodo: req.method, rota: req.path }); }
      catch (error) { console.error("[Auditoria] Não foi possível registrar ação:", error); }
    });
  }
  next();
};

