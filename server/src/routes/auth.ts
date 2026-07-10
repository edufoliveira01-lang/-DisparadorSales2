import { Router } from "express";
import { 
  getUserByUsername, 
  hashPassword, 
  createSession, 
  getSession, 
  deleteSession,
  getUserById,
  updateUser
} from "../services/authService";

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
  
  if (!user.email) {
    return res.status(400).json({ error: "Este usuário não possui um e-mail de recuperação cadastrado. Acesse o sistema com a senha padrão e configure um e-mail." });
  }
  
  try {
    const token = generateRecoveryToken(user.id);
    await sendRecoveryEmail(user.email, token);
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
