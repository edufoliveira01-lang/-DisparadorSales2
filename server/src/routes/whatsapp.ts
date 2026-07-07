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
