import { Router } from "express";
import { dispatchBatch, dispatchSingle, type SendItem } from "../services/dispatchService";

export const sendRouter = Router();

sendRouter.post("/single", async (req, res) => {
  const { cardId, nomeCliente, telefone, contactId, pericias, templateId } = req.body as SendItem & { templateId: number };

  if (!telefone?.trim()) return res.status(400).json({ error: "Este cliente não tem telefone cadastrado." });
  if (!templateId) return res.status(400).json({ error: "Selecione um template de mensagem." });

  try {
    const log = await dispatchSingle({ cardId, nomeCliente, telefone, contactId: contactId ?? null, pericias }, templateId);
    res.json({ ok: true, log });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

sendRouter.post("/batch", (req, res) => {
  const { items, templateId, intervalMinSec, intervalMaxSec } = req.body as {
    items: SendItem[];
    templateId: number;
    intervalMinSec?: number;
    intervalMaxSec?: number;
  };

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Nenhum card selecionado para envio em lote." });
  }
  if (!templateId) return res.status(400).json({ error: "Selecione um template de mensagem." });

  // Roda em background: o progresso é acompanhado via WebSocket (send:update / send:batch-*).
  dispatchBatch(items, templateId, intervalMinSec ?? 5, intervalMaxSec ?? 15).catch(() => {});
  res.json({ ok: true, total: items.length });
});
