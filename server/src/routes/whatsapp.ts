import { Router } from "express";
import { whatsappManager } from "../services/whatsappService";

export const whatsappRouter = Router();

whatsappRouter.get("/status", (_req, res) => {
  res.json(whatsappManager.getState());
});

whatsappRouter.post("/connect", (_req, res) => {
  whatsappManager.connect();
  res.json(whatsappManager.getState());
});

whatsappRouter.post("/stop", async (_req, res) => {
  await whatsappManager.stop();
  res.json(whatsappManager.getState());
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
    res.write(`data: ${JSON.stringify(whatsappManager.getState())}\n\n`);
  };
  send();
  const unsubscribe = whatsappManager.onChange(send);

  req.on("close", () => {
    unsubscribe();
    res.end();
  });
});
