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

whatsappRouter.post("/disconnect", async (_req, res) => {
  await whatsappManager.disconnect();
  res.json({ ok: true });
});

whatsappRouter.get("/events", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
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
