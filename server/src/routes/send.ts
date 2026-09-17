import { Router } from "express";
import { dispatchBatch, dispatchSingle, type SendItem } from "../services/dispatchService";
import { batchInProgress, listActiveBatches } from "../services/batchProgressService";

export const sendRouter = Router();

sendRouter.get("/batches", (_req, res) => {
  res.json(listActiveBatches());
});

sendRouter.post("/single", async (req, res) => {
  const { cardId, nomeCliente, telefone, contactId, pericias, templateId, modo } = req.body as SendItem & {
    templateId?: number;
  };

  if (!telefone?.trim()) return res.status(400).json({ error: "Este cliente não tem telefone cadastrado." });
  if ((!modo || modo === "template") && !templateId) {
    return res.status(400).json({ error: "Selecione um template de mensagem." });
  }

  try {
    const log = await dispatchSingle(
      { cardId, nomeCliente, telefone, contactId: contactId ?? null, pericias, modo },
      templateId ?? null
    );
    res.json({ ok: true, log });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

sendRouter.post("/batch", (req, res) => {
  if (batchInProgress("mensagens")) {
    return res.status(409).json({ error: "Já existe um lote de mensagens em andamento." });
  }
  const { items, templateId, intervalMinSec, intervalMaxSec } = req.body as {
    items: SendItem[];
    templateId?: number;
    intervalMinSec?: number;
    intervalMaxSec?: number;
  };

  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Nenhum card selecionado para envio em lote." });
  }
  const precisaTemplate = items.some((item) => !item.modo || item.modo === "template");
  if (precisaTemplate && !templateId) {
    return res.status(400).json({ error: "Selecione um template de mensagem." });
  }

  // Roda em background: o progresso é acompanhado via WebSocket (send:update / send:batch-*).
  dispatchBatch(items, templateId ?? null, intervalMinSec ?? 5, intervalMaxSec ?? 15).catch(() => {});
  res.json({ ok: true, total: items.length });
});
