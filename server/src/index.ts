import "./loadEnv";
import { aiRouter } from "./routes/ai";
import { stopChatgptAuth } from "./services/ai/chatgptAuth";
import cors from "cors";
import express from "express";
import cookieParser from "cookie-parser";
import http from "node:http";
import { djenRouter } from "./routes/djen";
import { gestaoRouter } from "./routes/gestao";
import { atendimentoRouter } from "./routes/atendimento";
import { iniciarMonitorDjen, pararMonitorDjen } from "./services/djen/sync";
import { cardsRouter } from "./routes/cards";
import { authRouter } from "./routes/auth";
import { teamRouter } from "./routes/team";
import { brandingRouter } from "./routes/branding";
import { backupRouter } from "./routes/backup";
import { authenticatedApi } from "./middleware/access";
import { licencaSomenteLeitura } from "./middleware/licenca";
import { licenseRouter } from "./routes/license";
import { licenca, licencaPermiteOperar } from "./licenca/cliente";
import { contactsRouter } from "./routes/contacts";
import { logsRouter } from "./routes/logs";
import { pendingRepliesRouter } from "./routes/pendingReplies";
import { periciasAgendadasRouter } from "./routes/periciasAgendadas";
import { sendRouter } from "./routes/send";
import { settingsRouter } from "./routes/settings";
import { systemLogsRouter } from "./routes/systemLogs";
import { messageTemplatesRouter } from "./routes/messageTemplates";
import { templatesRouter } from "./routes/templates";
import { trelloRouter } from "./routes/trello";
import { whatsappRouter } from "./routes/whatsapp";
import { googleCalendarRouter } from "./routes/googleCalendar";
import { initWebsocket } from "./websocket";
import { notifyDashboardChanges } from "./websocket/dashboardChanges";
import { whatsappManager } from "./services/whatsappService";
import { verificarNotificacoesPendentes } from "./services/notificationService";
import { podarPericiasAgendadasAntigas, reconciliarRemarcacoesAntigas } from "./services/periciasAgendadasService";
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

// Assinatura inativa: somente leitura (login, logout e consulta da licença continuam)
app.use("/api", licencaSomenteLeitura);

// Middleware de autenticação para as demais rotas
app.use("/api", authenticatedApi);

app.use("/api", notifyDashboardChanges);
app.use("/api/license", licenseRouter);
app.use("/api/djen", djenRouter);
app.use("/api/gestao", gestaoRouter);
app.use("/api/atendimento", atendimentoRouter);
app.use("/api/ai", aiRouter);
app.use("/api/settings", settingsRouter);
app.use("/api/team", teamRouter);
app.use("/api/branding", brandingRouter);
app.use("/api/backup", backupRouter);
app.use("/api/trello", trelloRouter);
app.use("/api/contacts", contactsRouter);
app.use("/api/templates", templatesRouter);
app.use("/api/message-templates", messageTemplatesRouter);
app.use("/api/whatsapp", whatsappRouter);
app.use("/api/cards", cardsRouter);
app.use("/api/send", sendRouter);
app.use("/api/logs", logsRouter);
app.use("/api/system-logs", systemLogsRouter);
app.use("/api/pending-replies", pendingRepliesRouter);
app.use("/api/pericias-agendadas", periciasAgendadasRouter);
app.use("/api/google-calendar", googleCalendarRouter);

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
  try { licenca().iniciar(); } catch (error) { console.error("[Licença]", (error as Error).message); }
  try {
    const remarcacoesCorrigidas = reconciliarRemarcacoesAntigas();
    if (remarcacoesCorrigidas > 0) {
      console.log(`[Calendário] ${remarcacoesCorrigidas} agendamento(s) antigo(s) de remarcação foram substituídos.`);
    }
  } catch (error) {
    console.error("[Calendário] Falha ao reconciliar remarcações antigas:", error);
  }
  iniciarMonitorDjen();
  if (whatsappManager.restoreSavedSession()) {
    console.log("[WhatsApp] Restaurando sessão salva automaticamente...");
  }
});

// Ao vencer o prazo configurado, verifica os acompanhamentos a cada 15 segundos.
// A rotina tem trava interna para não sobrepor consultas e envios de canais lentos.
const INTERVALO_VERIFICACAO_MS = 15_000;
setTimeout(
  () => !licencaPermiteOperar() ? Promise.resolve() : verificarNotificacoesPendentes("inicializacao").catch((err) => {
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
  5_000
);
setInterval(
  () => !licencaPermiteOperar() ? Promise.resolve() : verificarNotificacoesPendentes("periodica").catch((err) => {
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

// Poda diária apenas de eventos antigos encerrados ou com laudo identificado.
// Preserva eventos futuros e perícias ativas ainda sob acompanhamento. Não afeta
// send_logs (Histórico) nem pending_replies — são tabelas independentes, com retenção própria.
const DIAS_RETENCAO_PERICIAS_AGENDADAS = 90;
const INTERVALO_PODA_PERICIAS_MS = 24 * 60 * 60 * 1000;
function podarPericiasAgendadas(): void {
  try {
    const apagadas = podarPericiasAgendadasAntigas(DIAS_RETENCAO_PERICIAS_AGENDADAS);
    if (apagadas > 0) console.log(`[Calendário] ${apagadas} evento(s) encerrado(s) com mais de 3 meses removido(s).`);
  } catch (err) {
    console.error("[Calendário] Erro ao podar perícias agendadas antigas:", err);
  }
}
setTimeout(podarPericiasAgendadas, 90_000);
setInterval(podarPericiasAgendadas, INTERVALO_PODA_PERICIAS_MS);

async function shutdown() {
  console.log("Encerrando servidor...");
  pararMonitorDjen();
  stopChatgptAuth();
  await whatsappManager.shutdown().catch(() => {});
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);


