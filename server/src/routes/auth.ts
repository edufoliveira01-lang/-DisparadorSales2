import { Router } from "express";
import {
  getUserByUsername,
  hashPassword,
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

export const authRouter = Router();

authRouter.post("/login", (req, res) => {
  const { username, password } = req.body;
  
  if (!username || !password) {
    return res.status(400).json({ error: "Usuário e senha são obrigatórios." });
  }
  
  const user = getUserByUsername(username);
  if (!user || user.password_hash !== hashPassword(password)) {
    return res.status(401).json({ error: "Usuário ou senha incorretos." });
  }
  
  const sessionId = createSession(user.id);
  
  // Cookie seguro por 3 horas
  res.cookie("session_id", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    maxAge: 3 * 60 * 60 * 1000,
    sameSite: "lax"
  });
  
  res.json({ 
    user: { 
      id: user.id, 
      username: user.username, 
      email: user.email 
    } 
  });
});

authRouter.post("/logout", (req, res) => {
  const sessionId = req.cookies.session_id;
  if (sessionId) {
    deleteSession(sessionId);
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
  if (!user) return res.status(401).json({ error: "Usuário não encontrado." });
  
  res.json({ 
    user: { 
      id: user.id, 
      username: user.username, 
      email: user.email 
    } 
  });
});

authRouter.put("/update", (req, res) => {
  const sessionId = req.cookies.session_id;
  if (!sessionId) return res.status(401).json({ error: "Não autenticado." });
  
  const session = getSession(sessionId);
  if (!session) return res.status(401).json({ error: "Sessão expirada." });
  
  const { username, email, password, currentPassword } = req.body;
  
  const user = getUserById(session.user_id);
  if (!user) return res.status(404).json({ error: "Usuário não encontrado." });
  
  // Validar senha atual para qualquer mudança sensível
  if (currentPassword && user.password_hash !== hashPassword(currentPassword)) {
    return res.status(401).json({ error: "Senha atual incorreta." });
  }

  const updateData: any = {};
  if (username) updateData.username = username;
  if (email !== undefined) updateData.email = email;
  if (password) updateData.password_hash = hashPassword(password);
  
  if (Object.keys(updateData).length > 0) {
    updateUser(user.id, updateData);
  }
  
  res.json({ ok: true });
});

authRouter.post("/forgot-password", async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: "Informe o usuário." });

  const user = getUserByUsername(username);
  if (!user) {
    return res.status(404).json({ error: "Usuário não encontrado." });
  }

  // Telegram é o canal preferido (mais simples de configurar que SMTP, e já costuma estar
  // pronto por causa das notificações de entrega/resposta). E-mail continua como alternativa
  // pra quem não usa o Telegram.
  const telegramToken = getSetting("telegram_bot_token");
  const telegramChatId = getSetting("telegram_chat_id");
  const telegramConfigurado = Boolean(telegramToken && telegramChatId);

  if (!telegramConfigurado && !user.email) {
    return res.status(400).json({
      error:
        "Nenhum canal de recuperação configurado. Configure o Telegram em Configurações → Notificações, ou cadastre um e-mail de recuperação.",
    });
  }

  const token = generateRecoveryToken(user.id);

  if (telegramConfigurado) {
    try {
      const recoveryUrl = `${process.env.APP_URL || "http://localhost:3333"}/login?token=${token}`;
      await enviarMensagemTelegram(
        telegramToken!,
        telegramChatId!,
        `🔑 Recuperação de senha do DisparaZap solicitada.\n\nDefina uma nova senha (link expira em 1h):\n${recoveryUrl}\n\nSe não foi você, ignore esta mensagem.`
      );
      return res.json({ message: "Link de recuperação enviado no Telegram." });
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
    res.json({ message: "E-mail de recuperação enviado com sucesso." });
  } catch (err) {
    console.error("[Auth] Erro na recuperação:", err);
    res.status(500).json({ error: "Erro ao enviar e-mail. Verifique as configurações de SMTP no arquivo .env ou consulte o log do servidor." });
  }
});

authRouter.post("/reset-password", (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Token e nova senha são obrigatórios." });
  
  const user = getUserByRecoveryToken(token);
  if (!user) return res.status(400).json({ error: "Token inválido ou expirado." });
  
  updateUser(user.id, { password_hash: hashPassword(password) });
  clearRecoveryToken(user.id);
  
  res.json({ message: "Senha alterada com sucesso." });
});
