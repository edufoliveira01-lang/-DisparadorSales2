import { Router } from "express";
import { whatsappManager } from "../services/whatsappService";
import { WhatsappSessionRecoveryError } from "../services/whatsappProfile";
import { getUserById } from "../services/authService";
import { hasPermission } from "../services/accessService";

export const whatsappRouter = Router();

whatsappRouter.get("/status", (req, res) => {
  const state = whatsappManager.getState();
  res.json(req.accessUser && hasPermission(req.accessUser, "whatsapp.manage") ? state : { status: state.status });
});

whatsappRouter.post("/connect", async (_req, res, next) => {
  try {
    await whatsappManager.connectWithRecovery();
    res.json(whatsappManager.getState());
  } catch (error) {
    if (error instanceof WhatsappSessionRecoveryError) { res.status(409).json({ error: error.message }); return; }
    next(error);
  }
});

whatsappRouter.post("/stop", async (_req, res) => {
  await whatsappManager.stop();
  res.json(whatsappManager.getState());
});

whatsappRouter.post("/recreate-session", async (_req, res, next) => {
  try {
    await whatsappManager.recreateSession();
    res.json(whatsappManager.getState());
  } catch (error) {
    if (error instanceof WhatsappSessionRecoveryError) { res.status(409).json({ error: error.message }); return; }
    next(error);
  }
});

whatsappRouter.post("/disconnect", async (_req, res) => {
  await whatsappManager.disconnect();
  res.json(whatsappManager.getState());
});

whatsappRouter.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    // Evita que um proxy reverso na frente (ex: Nginx) segure os eventos em buffer em vez de
    // repassar em tempo real — sem isso, atualizações de status só chegam ao navegador quando
    // o buffer enche ou a conexão fecha, dando a impressão de que o app não atualiza sozinho.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = () => {
    const user = req.accessUser && getUserById(req.accessUser.id);
    if (!user || !hasPermission(user, "whatsapp.manage")) { res.end(); return; }
    res.write(`data: ${JSON.stringify(whatsappManager.getState())}\n\n`);
  };
  send();
  const unsubscribe = whatsappManager.onChange(send);
  // Comentários SSE mantêm o fluxo ativo mesmo quando o estado não muda por minutos.
  const heartbeat = setInterval(() => res.write(": keep-alive\n\n"), 15000);
  heartbeat.unref();

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
    res.end();
  });
});

