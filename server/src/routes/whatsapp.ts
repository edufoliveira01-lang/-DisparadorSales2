import { Router } from "express";
import { whatsappManager, motorWhatsappAtual } from "../services/whatsappService";
import { estadoDoCanalDeskcomm } from "../services/canalWhatsapp";
import { usaDeskcomm } from "../services/canalProvedor";
import { WhatsappSessionRecoveryError } from "../services/whatsappProfile";
import { getUserById, getSession } from "../services/authService";
import { hasPermission } from "../services/accessService";

export const whatsappRouter = Router();

whatsappRouter.get("/status", async (req, res) => {
  const state = usaDeskcomm() ? await estadoDoCanalDeskcomm() : whatsappManager.getState();
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

whatsappRouter.get("/engine", (_req, res) => { res.json({ engine: motorWhatsappAtual() }); });

whatsappRouter.post("/engine", async (req, res, next) => {
  try {
    const engine = req.body?.engine;
    if (engine !== "wwebjs" && engine !== "baileys") { res.status(400).json({ error: "Motor inválido." }); return; }
    await whatsappManager.trocarMotor(engine);
    res.json({ engine: motorWhatsappAtual(), ...whatsappManager.getState() });
  } catch (error) { next(error); }
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

  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let unsubscribe = () => {};
  const close = () => {
    if (closed) return;
    closed = true;
    if (heartbeat) clearInterval(heartbeat);
    unsubscribe();
    res.end();
  };
  const valid = () => {
    const session = req.cookies?.session_id && getSession(req.cookies.session_id, false);
    const user = session && getUserById(session.user_id);
    return Boolean(user && user.id === req.accessUser?.id && hasPermission(user, "whatsapp.manage"));
  };
  const send = () => {
    if (closed) return;
    if (!valid()) { close(); return; }
    if (usaDeskcomm()) { void estadoDoCanalDeskcomm().then((e) => { if (!closed) res.write(`data: ${JSON.stringify(e)}\n\n`); }); return; }
    res.write(`data: ${JSON.stringify(whatsappManager.getState())}\n\n`);
  };
  send();
  if (closed) return;
  unsubscribe = whatsappManager.onChange(send);
  // Comentários SSE mantêm o fluxo ativo mesmo quando o estado não muda por minutos.
  heartbeat = setInterval(() => { if (!valid()) close(); else if (usaDeskcomm()) send(); else res.write(": keep-alive\n\n"); }, 15000);
  heartbeat.unref();

  req.on("close", close);
});


