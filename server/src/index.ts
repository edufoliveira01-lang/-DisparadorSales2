import "dotenv/config";
import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { cardsRouter } from "./routes/cards";
import { authRouter } from "./routes/auth";
import { backupRouter } from "./routes/backup";
import { getSession } from "./services/authService";
import { contactsRouter } from "./routes/contacts";
import { logsRouter } from "./routes/logs";
import { pendingRepliesRouter } from "./routes/pendingReplies";
import { periciasAgendadasRouter } from "./routes/periciasAgendadas";
import { sendRouter } from "./routes/send";
import { settingsRouter } from "./routes/settings";
import { systemLogsRouter } from "./routes/systemLogs";
import { templatesRouter } from "./routes/templates";
import { trelloRouter } from "./routes/trello";
import { whatsappRouter } from "./routes/whatsapp";
import { initWebsocket } from "./websocket";
import { whatsappManager } from "./services/whatsappService";
import { verificarNotificacoesPendentes } from "./services/notificationService";
import { podarPericiasAgendadasAntigas } from "./services/periciasAgendadasService";
import { recordSystemLog } from "./services/systemLogsService";

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
app.use("/api/backup", backupRouter);
app.use("/api/trello", trelloRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/send", sendRouter);
app.use("/api/logs", logsRouter);
app.use("/api/system-logs", systemLogsRouter);
app.use("/api/pending-replies", pendingRepliesRouter);
app.use("/api/pericias-agendadas", periciasAgendadasRouter);

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error("[erro não tratado]", err);
  recordSystemLog({
    nivel: "erro",
    categoria: "sistema",
    evento: "erro_http_nao_tratado",
    titulo: "Erro interno não tratado",
    mensagem: err.message,
    origem: "sistema",
    detalhes: { rota: _req.originalUrl, metodo: _req.method, nome: err.name },
  });
  res.status(500).json({ error: "Erro interno do servidor." });
});

const httpServer = http.createServer(app);
initWebsocket(httpServer);

const port = Number(process.env.PORT) || 3333;
httpServer.listen(port, () => {
  console.log(`Servidor do Disparador de Perícias rodando em http://localhost:${port}`);
  if (whatsappManager.restoreSavedSession()) {
    console.log("[WhatsApp] Restaurando sessão salva automaticamente...");
  }
});

// Verifica periodicamente envios com problema de entrega e pendentes sem resposta para
// notificar no Telegram (não faz nada se a integração não estiver configurada). Roda pouco
// depois do start (não precisa esperar meia hora após um restart pra pegar algo pendente) e
// depois a cada 30 minutos — frequência de sobra para prazos de alerta medidos em horas.
const INTERVALO_VERIFICACAO_MS = 30 * 60 * 1000;
setTimeout(
  () => verificarNotificacoesPendentes("inicializacao").catch((err) => {
    console.error("[Notificações] Erro na verificação inicial:", err);
    recordSystemLog({
      nivel: "erro",
      categoria: "notificacao",
      evento: "falha_verificacao_inicial",
      titulo: "Falha na verificação inicial de notificações",
      mensagem: (err as Error).message,
      origem: "automatico",
    });
  }),
  60_000
);
setInterval(
  () => verificarNotificacoesPendentes("periodica").catch((err) => {
    console.error("[Notificações] Erro na verificação periódica:", err);
    recordSystemLog({
      nivel: "erro",
      categoria: "notificacao",
      evento: "falha_verificacao_periodica",
      titulo: "Falha na verificação periódica de notificações",
      mensagem: (err as Error).message,
      origem: "automatico",
    });
  }),
  INTERVALO_VERIFICACAO_MS
);

// Poda diária do calendário de perícias agendadas: mantém só os últimos 3 meses, para não
// crescer para sempre e para limitar a janela em que comparamos reagendamentos. Não afeta
// send_logs (Histórico) nem pending_replies — são tabelas independentes, com retenção própria.
const DIAS_RETENCAO_PERICIAS_AGENDADAS = 90;
const INTERVALO_PODA_PERICIAS_MS = 24 * 60 * 60 * 1000;
function podarPericiasAgendadas(): void {
  try {
    const apagadas = podarPericiasAgendadasAntigas(DIAS_RETENCAO_PERICIAS_AGENDADAS);
    if (apagadas > 0) console.log(`[Calendário] ${apagadas} perícia(s) agendada(s) com mais de 3 meses removida(s).`);
  } catch (err) {
    console.error("[Calendário] Erro ao podar perícias agendadas antigas:", err);
  }
}
setTimeout(podarPericiasAgendadas, 90_000);
setInterval(podarPericiasAgendadas, INTERVALO_PODA_PERICIAS_MS);

async function shutdown() {
  console.log("Encerrando servidor...");
  await whatsappManager.shutdown().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
