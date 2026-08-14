import { Router } from "express";
import { getLastStatusForCard } from "../services/logsService";
import { type Pericia, sortPericiasByDate } from "../services/parserService";
import { getSetting } from "../services/settingsService";
import { COBRANCA_AUDIENCIA_MENSAGEM_PADRAO, COBRANCA_MENSAGEM_PADRAO, renderCobranca } from "../services/templateService";
import { moveCard, TrelloError } from "../services/trelloService";
import {
  cancelPendingReply,
  deletePendingReplies,
  deletePendingReply,
  getPendingReply,
  listPendingReplies,
  resolvePendingReply,
} from "../services/pendingRepliesService";
import { whatsappManager } from "../services/whatsappService";
import { emitEvent } from "../websocket";

/** Perícia mais próxima do card, usada para preencher {{TIPO_PERICIA}}/{{DATA}}/{{HORARIO}}/
 * {{LOCAL}} na mensagem de cobrança — null quando o log original não tem esses dados (ex: log
 * bem antigo) ou não existe mais. */
function periciaMaisRelevante(cardId: string): Pericia | null {
  const log = getLastStatusForCard(cardId);
  if (!log?.pericias_json) return null;
  try {
    const pericias = JSON.parse(log.pericias_json) as Pericia[];
    if (pericias.length === 0) return null;
    return sortPericiasByDate(pericias)[0];
  } catch {
    return null;
  }
}

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

// Cobrança manual: manda uma nova mensagem perguntando se o cliente recebeu o envio anterior e
// que ainda aguardamos retorno — não muda o status do pendente (continua "aguardando"), é só um
// empurrãozinho pra quem esqueceu de responder.
pendingRepliesRouter.post("/:id/cobrar", async (req, res) => {
  const id = Number(req.params.id);
  const pending = getPendingReply(id);
  if (!pending) return res.status(404).json({ error: "Registro não encontrado." });
  if (pending.status !== "aguardando") return res.status(400).json({ error: "Este registro já foi resolvido." });
  if (!whatsappManager.isReady()) return res.status(400).json({ error: "WhatsApp não está conectado." });

  try {
    // Preferimos o chat id completo já resolvido no envio original (funciona mesmo quando o
    // contato usa "LID" em vez de telefone). Só re-resolvemos via telefone_digits para
    // registros antigos, criados antes desse campo existir.
    const chatId = pending.whatsapp_chat_id || (await whatsappManager.resolveChatId(pending.telefone_digits));
    if (!chatId) return res.status(400).json({ error: "Este telefone não foi encontrado no WhatsApp." });

    const pericia = periciaMaisRelevante(pending.card_id);
    const ehAudiencia = pericia?.origem === "audiencia";
    const mensagemConfigurada = ehAudiencia
      ? getSetting("cobranca_audiencia_mensagem") || COBRANCA_AUDIENCIA_MENSAGEM_PADRAO
      : getSetting("cobranca_mensagem") || COBRANCA_MENSAGEM_PADRAO;
    const texto = renderCobranca(mensagemConfigurada, pending.card_nome || "", pericia);
    await whatsappManager.sendMessage(chatId, texto);
    res.json({ ok: true });
  } catch (err) {
    res.status(502).json({ error: (err as Error).message || "Erro ao enviar mensagem de cobrança." });
  }
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

// Apaga o registro em definitivo — útil quando o cliente só reagiu à mensagem durante uma
// desconexão do WhatsApp: a reconciliação automática não detecta reações perdidas (só
// mensagens de texto), então o pendente ficaria preso em "aguardando" sem essa opção manual.
pendingRepliesRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  const pending = getPendingReply(id);
  if (!pending) return res.status(404).json({ error: "Registro não encontrado." });

  deletePendingReply(id);
  res.json({ ok: true });
});

pendingRepliesRouter.post("/apagar-em-massa", (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Nenhum registro selecionado." });
  }

  const apagados = deletePendingReplies(ids.filter((id) => Number.isInteger(id)));
  res.json({ ok: true, apagados });
});
