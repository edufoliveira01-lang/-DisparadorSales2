import { Router } from "express";
import { getSetting } from "../services/settingsService";
import { moveCard, TrelloError } from "../services/trelloService";
import { cancelPendingReply, getPendingReply, listPendingReplies, resolvePendingReply } from "../services/pendingRepliesService";
import { emitEvent } from "../websocket";

export const pendingRepliesRouter = Router();

pendingRepliesRouter.get("/", (_req, res) => {
  res.json(listPendingReplies());
});

// Confirmação manual: o cliente já respondeu antes de o monitoramento existir, ou o
// usuário simplesmente quer marcar como concluído sem esperar a resposta pelo WhatsApp.
pendingRepliesRouter.post("/:id/confirmar", async (req, res) => {
  const id = Number(req.params.id);
  const pending = getPendingReply(id);
  if (!pending) return res.status(404).json({ error: "Registro não encontrado." });
  if (pending.status !== "aguardando") return res.status(400).json({ error: "Este registro já foi resolvido." });

  const resolved = resolvePendingReply(id, "mensagem", "Confirmado manualmente");
  emitEvent("pendingReply:resolved", resolved);

  const trelloKey = getSetting("trello_key");
  const trelloToken = getSetting("trello_token");
  const confirmListId = getSetting("trello_confirm_list_id");
  if (trelloKey && trelloToken && confirmListId) {
    try {
      await moveCard(trelloKey, trelloToken, pending.card_id, confirmListId);
    } catch (err) {
      const message = err instanceof TrelloError ? err.message : "Erro ao mover cartão no Trello.";
      return res.status(502).json({ error: message, log: resolved });
    }
  }
  res.json({ ok: true, log: resolved });
});

pendingRepliesRouter.post("/:id/cancelar", (req, res) => {
  const id = Number(req.params.id);
  const pending = getPendingReply(id);
  if (!pending) return res.status(404).json({ error: "Registro não encontrado." });
  if (pending.status !== "aguardando") return res.status(400).json({ error: "Este registro já foi resolvido." });

  const cancelled = cancelPendingReply(id);
  emitEvent("pendingReply:resolved", cancelled);
  res.json({ ok: true, log: cancelled });
});
