import { Router } from "express";
import {
  getUserByUsername,
  hashPassword,
  verifyPassword,
  createSession,
  getSession,
  deleteSession,
  getUserById,
  updateUser,
  generateRecoveryToken,
  getUserByRecoveryToken,
  clearRecoveryToken
} from "../services/authService";
import { sendRecoveryEmail } from "../services/emailService";
import { getSetting } from "../services/settingsService";
import { enviarMensagemTelegram } from "../services/telegramService";
import { auditAccess, invalidateUserSessions, publicUser } from "../services/accessService";
import { db } from "../db";
import { loginBranding, loginImage } from "./branding";
import { disconnectUserSockets, disconnectSessionSockets } from "../websocket";

export const authRouter = Router();
authRouter.get("/login-branding", loginBranding);
authRouter.get("/login-image", loginImage);
const failures = new Map<string, { count: number; until: number }>();

authRouter.post("/login", (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: "Usuário e senha são obrigatórios." });
  }
  
  const key = `${req.ip}:${String(username).toLowerCase()}`;
  const attempt = failures.get(key);
  if (attempt && attempt.count >= 6 && attempt.until > Date.now()) {
    return res.status(429).json({ error: "Muitas tentativas. Aguarde 15 minutos." });
  }
  const user = getUserByUsername(String(username));
  if (!user || !user.active || !verifyPassword(String(password), user.password_hash)) {
    failures.set(key, { count: (attempt?.until && attempt.until > Date.now() ? attempt.count : 0) + 1, until: Date.now() + 15 * 60_000 });
    return res.status(401).json({ error: "Usuário ou senha incorretos." });
  }
  failures.delete(key);
  // Senhas anteriores eram SHA-256 sem salt. Atualiza ao autenticar sem interromper contas existentes.
  if (!user.password_hash.startsWith("scrypt$")) updateUser(user.id, { password_hash: hashPassword(String(password)) });
  
  const sessionId = createSession(user.id);
  
  // Cookie seguro por 3 horas
  res.cookie("session_id", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 3 * 60 * 60 * 1000,
    sameSite: "lax"
  });
  
  res.json({ user: publicUser(user) });
});

authRouter.post("/logout", (req, res) => {
  const sessionId = req.cookies.session_id;
  if (sessionId) {
    deleteSession(sessionId);
    disconnectSessionSockets(sessionId);
  }
  res.clearCookie("session_id");
  res.json({ ok: true });
});

authRouter.get("/me", (req, res) => {
  const sessionId = req.cookies.session_id;
  if (!sessionId) return res.status(401).json({ error: "Não autenticado." });
  
  const session = getSession(sessionId);
  if (!session) return res.status(401).json({ error: "Sessão expirada." });
  
  const user = getUserById(session.user_id);
  if (!user || !user.active) return res.status(401).json({ error: "Usuário não encontrado." });
  
  res.json({ user: publicUser(user) });
});

/** Primeiro acesso com senha definida por outra pessoa: cria a senha própria e libera o sistema. */
authRouter.post("/trocar-senha-inicial", (req, res) => {
  const sessionId = req.cookies.session_id;
  if (!sessionId) return res.status(401).json({ error: "Não autenticado." });
  const session = getSession(sessionId);
  if (!session) return res.status(401).json({ error: "Sessão expirada." });
  const user = getUserById(session.user_id);
  if (!user || !user.active) return res.status(404).json({ error: "Usuário não encontrado." });
  const { currentPassword, newPassword } = req.body || {};
  if (typeof currentPassword !== "string" || !verifyPassword(currentPassword, user.password_hash)) return res.status(401).json({ error: "A senha recebida está incorreta." });
  if (typeof newPassword !== "string" || newPassword.length < 12) return res.status(400).json({ error: "A nova senha deve ter pelo menos 12 caracteres." });
  if (newPassword === currentPassword) return res.status(400).json({ error: "Escolha uma senha diferente da recebida." });
  updateUser(user.id, { password_hash: hashPassword(newPassword), must_change_password: 0 });
  // Encerra as outras sessões; esta continua aberta.
  db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").run(user.id, sessionId);
  auditAccess("senha_inicial_trocada", user.id, user.id);
  res.json({ ok: true });
});

authRouter.put("/update", (req, res) => {
  const sessionId = req.cookies.session_id;
  if (!sessionId) return res.status(401).json({ error: "Não autenticado." });
  
  const session = getSession(sessionId);
  if (!session) return res.status(401).json({ error: "Sessão expirada." });
  
  const { username, email, password, currentPassword } = req.body;
  
  const user = getUserById(session.user_id);
  if (!user || !user.active) return res.status(404).json({ error: "Usuário não encontrado." });
  
  // Validar senha atual para qualquer mudança sensível
  if (!currentPassword || !verifyPassword(String(currentPassword), user.password_hash)) {
    return res.status(401).json({ error: "Senha atual incorreta." });
  }
  if (password && (typeof password !== "string" || password.length < 12)) {
    return res.status(400).json({ error: "A nova senha deve ter pelo menos 12 caracteres." });
  }

  const updateData: any = {};
  if (username && typeof username === "string") updateData.username = username.trim();
  if (email !== undefined) updateData.email = typeof email === "string" ? email.trim() || null : null;
  if (password) { updateData.password_hash = hashPassword(password); updateData.must_change_password = 0; }
  
  if (Object.keys(updateData).length > 0) {
    try { updateUser(user.id, updateData); }
    catch { return res.status(409).json({ error: "Este usuário já está em uso." }); }
    auditAccess("conta_atualizada", user.id, user.id, { campos: Object.keys(updateData).filter((field) => field !== "password_hash"), senha_alterada: Boolean(password) });
    if (password) {
      invalidateUserSessions(user.id);
      disconnectUserSockets(user.id);
      res.clearCookie("session_id");
      return res.json({ ok: true, relogin: true });
    }
  }
  
  res.json({ ok: true });
});

authRouter.post("/forgot-password", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Informe o usuário." });

  const user = getUserByUsername(username);
  const resposta = { message: "Se a conta tiver um canal de recuperação, as instruções serão enviadas." };
  if (!user || !user.active) return res.json(resposta);

  // Telegram é o canal preferido (mais simples de configurar que SMTP, e já costuma estar
  // pronto por causa das notificações de entrega/resposta). E-mail continua como alternativa
  // pra quem não usa o Telegram.
  const telegramToken = getSetting("telegram_bot_token");
  const telegramChatId = getSetting("telegram_chat_id");
  const telegramConfigurado = user.role === "administrador" && Boolean(telegramToken && telegramChatId);

  if (!telegramConfigurado && !user.email) {
    return res.json(resposta);
  }

  const token = generateRecoveryToken(user.id);

  if (!user.email && telegramConfigurado) {
    try {
      const recoveryUrl = `${process.env.APP_URL || "http://localhost:3333"}/login?token=${token}`;
      await enviarMensagemTelegram(
        telegramToken!,
        telegramChatId!,
        `🔑 Recuperação de senha do DisparaZap solicitada.\n\nDefina uma nova senha (link expira em 1h):\n${recoveryUrl}\n\nSe não foi você, ignore esta mensagem.`
      );
      return res.json(resposta);
    } catch (err) {
      console.error("[Auth] Erro ao enviar recuperação via Telegram:", err);
      if (!user.email) {
        return res.status(502).json({ error: "Falha ao enviar pelo Telegram, e nenhum e-mail de recuperação está configurado." });
      }
      // cai para e-mail abaixo
    }
  }

  try {
    await sendRecoveryEmail(user.email!, token);
    res.json(resposta);
  } catch (err) {
    console.error("[Auth] Erro na recuperação:", err);
    res.status(500).json({ error: "Erro ao enviar e-mail. Verifique as configurações de SMTP no arquivo .env ou consulte o log do servidor." });
  }
});

authRouter.post("/reset-password", (req, res) => {
  const { token, password } = req.body;
  if (!token || typeof password !== "string" || password.length < 12) return res.status(400).json({ error: "Informe o token e uma senha de pelo menos 12 caracteres." });
  
  const user = getUserByRecoveryToken(token);
  if (!user) return res.status(400).json({ error: "Token inválido ou expirado." });
  
  updateUser(user.id, { password_hash: hashPassword(password), must_change_password: 0 });
  clearRecoveryToken(user.id);
  invalidateUserSessions(user.id);
  disconnectUserSockets(user.id);
  auditAccess("senha_recuperada", user.id, user.id);
  
  res.json({ message: "Senha alterada com sucesso." });
});

