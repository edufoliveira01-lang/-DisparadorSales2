import "dotenv/config";
import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { cardsRouter } from "./routes/cards";
import { authRouter } from "./routes/auth";
import { getSession } from "./services/authService";
import { contactsRouter } from "./routes/contacts";
import { logsRouter } from "./routes/logs";
import { pendingRepliesRouter } from "./routes/pendingReplies";
import { sendRouter } from "./routes/send";
import { settingsRouter } from "./routes/settings";
import { templatesRouter } from "./routes/templates";
import { trelloRouter } from "./routes/trello";
import { whatsappRouter } from "./routes/whatsapp";
import { initWebsocket } from "./websocket";
import { whatsappManager } from "./services/whatsappService";

const app = express();
app.use(cors({
  origin: true,
  credentials: true
}));
app.use(cookieParser());
app.use(express.json({ limit: "2mb" }));

// Rotas públicas
app.use("/api/auth", authRouter);

// Middleware de autenticação para as demais rotas
app.use("/api", (req, res, next) => {
  // Pular autenticação para rotas de auth e health
  if (req.path.startsWith("/auth") || req.path === "/health") {
    return next();
  }

  const sessionId = req.cookies.session_id;
  if (!sessionId) return res.status(401).json({ error: "Não autenticado." });
  
  const session = getSession(sessionId);
  if (!session) return res.status(401).json({ error: "Sessão expirada." });
  
  next();
});

app.use("/api/settings", settingsRouter);
app.use("/api/trello", trelloRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/send", sendRouter);
app.use("/api/logs", logsRouter);
app.use("/api/pending-replies", pendingRepliesRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[erro não tratado]", err);
  res.status(500).json({ error: "Erro interno do servidor." });
});

const httpServer = http.createServer(app);
initWebsocket(httpServer);

const port = Number(process.env.PORT) || 3333;
httpServer.listen(port, () => {
  console.log(`Servidor do Disparador de Perícias rodando em http://localhost:${port}`);
});

async function shutdown() {
  console.log("Encerrando servidor...");
  await whatsappManager.shutdown().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
