import { Router } from "express";
import { getLastStatusForCard, getLog } from "../services/logsService";
import { type Pericia, sortPericiasByDate } from "../services/parserService";
import { getSetting } from "../services/settingsService";
import { COBRANCA_AUDIENCIA_MENSAGEM_PADRAO, COBRANCA_MENSAGEM_PADRAO, renderCobranca } from "../services/templateService";
import { moveCard, TrelloError } from "../services/trelloService";
import {
  cancelPendingReply,
  deletePendingReplies,
  deletePendingReply,
  finalizePendingReply,
  getPendingReply,
  listPendingReplies,
  resolvePendingReply,
} from "../services/pendingRepliesService";
import { canalPronto, enviarTextoConfirmado, mensagemCanalIndisponivel, resolverDestino } from "../services/canalWhatsapp";
import { emitEvent } from "../websocket";
import { normalizePhone } from "../utils/phone";
import { recordSystemLog } from "../services/systemLogsService";

const cobrancasEmAndamento = new Set<string>();
const cobrancasRecentes = new Map<string, number>();
const INTERVALO_COBRANCA_MS = 30000;

/** Perícia mais próxima do card, usada para preencher {{TIPO_PERICIA}}/{{DATA}}/{{HORARIO}}/
 * {{LOCAL}} na mensagem de cobrança — null quando o log original não tem esses dados (ex: log
 * bem antigo) ou não existe mais. */
function periciaMaisRelevante(cardId: string, sendLogId: number | null): Pericia | null {
  const log = (sendLogId ? getLog(sendLogId) : undefined) || getLastStatusForCard(cardId);
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
  if (!canalPronto()) return res.status(400).json({ error: mensagemCanalIndisponivel() });

  // telefone_digits pode ser um LID, e não um telefone. Consultamos o número real
  // novamente, em vez de confiar em um identificador antigo da sessão anterior.
  const telefone = normalizePhone(pending.telefone);
  if (!/^\d{10,15}$/.test(telefone)) return res.status(400).json({ error: "O registro não possui um telefone válido para a cobrança." });
  for (const [chave, ate] of cobrancasRecentes) if (ate <= Date.now()) cobrancasRecentes.delete(chave);
  if (cobrancasEmAndamento.has(telefone) || cobrancasRecentes.has(telefone)) {
    return res.status(409).json({ error: "Uma cobrança para este telefone está em andamento ou acabou de ser tentada. Aguarde 30 segundos e confira a conversa antes de reenviar." });
  }
  cobrancasEmAndamento.add(telefone);
  let chatId: string | null = null;
  let tentouEnviar = false;
  try {
    chatId = await resolverDestino(telefone);
    if (!chatId) throw new Error("Este telefone não foi encontrado no WhatsApp.");
    // O cliente pode ter respondido enquanto o telefone era consultado.
    if (getPendingReply(id)?.status !== "aguardando") {
      return res.status(400).json({ error: "Este registro já foi resolvido." });
    }

    const pericia = periciaMaisRelevante(pending.card_id, pending.send_log_id);
    const ehAudiencia = pericia?.origem === "audiencia";
    const mensagemConfigurada = ehAudiencia
      ? getSetting("cobranca_audiencia_mensagem") || COBRANCA_AUDIENCIA_MENSAGEM_PADRAO
      : getSetting("cobranca_mensagem") || COBRANCA_MENSAGEM_PADRAO;
    const texto = renderCobranca(mensagemConfigurada, pending.card_nome || "", pericia);
    if (!texto.trim()) throw new Error("A mensagem de cobrança está vazia. Revise o modelo nas configurações.");
    tentouEnviar = true;
    const resultado = await enviarTextoConfirmado(chatId, texto, { nome: pending.card_nome, finalidade: "avisos" });
    recordSystemLog({
      nivel: "info", categoria: "whatsapp", evento: "cobranca_enviada",
      titulo: "Mensagem de cobrança enviada", origem: "usuario",
      mensagem: `Envio de cobrança confirmado pelo servidor do WhatsApp para ${pending.card_nome || "cliente"}. Isso não confirma entrega ou leitura no aparelho.`,
      detalhes: { pending_id: id, cliente: pending.card_nome, telefone: pending.telefone,
        chat_id_anterior: pending.whatsapp_chat_id, chat_id: chatId,
        whatsapp_message_id: resultado.messageId, ack: resultado.ack, mensagem: texto },
    });
    // Mantemos o vínculo, o ACK e o status do envio ORIGINAL: cobrar não confirma resposta.
    res.json({ ok: true, whatsapp_message_id: resultado.messageId, ack: resultado.ack });
  } catch (err) {
    const mensagem = err instanceof Error ? err.message : "Erro ao enviar mensagem de cobrança.";
    console.error(`[WhatsApp] Falha na cobrança do pendente ${id}:`, err);
    recordSystemLog({
      nivel: "erro", categoria: "whatsapp", evento: "cobranca_falhou",
      titulo: "Falha na mensagem de cobrança", origem: "usuario", mensagem,
      detalhes: { pending_id: id, cliente: pending.card_nome, telefone: pending.telefone,
        chat_id_anterior: pending.whatsapp_chat_id, chat_id: chatId, tentativa_envio: tentouEnviar },
    });
    res.status(502).json({ error: mensagem });
  } finally {
    cobrancasEmAndamento.delete(telefone);
    if (tentouEnviar) cobrancasRecentes.set(telefone, Date.now() + INTERVALO_COBRANCA_MS);
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

// Encerra o acompanhamento sem registrar uma resposta inexistente. A observação obrigatória
// permanece vinculada ao envio original e aparece nos detalhes do Histórico.
pendingRepliesRouter.post("/:id/finalizar", (req, res) => {
  const id = Number(req.params.id);
  const pending = getPendingReply(id);
  if (!pending) return res.status(404).json({ error: "Registro não encontrado." });
  if (pending.status !== "aguardando") return res.status(400).json({ error: "Este registro já foi resolvido." });

  const observacao = typeof req.body?.observacao === "string" ? req.body.observacao.trim() : "";
  if (observacao.length < 3) {
    return res.status(400).json({ error: "Informe uma observação com pelo menos 3 caracteres." });
  }
  if (observacao.length > 1000) {
    return res.status(400).json({ error: "A observação deve ter no máximo 1000 caracteres." });
  }

  const finalized = finalizePendingReply(id, observacao);
  if (!finalized) return res.status(409).json({ error: "Esta espera já foi finalizada por outra ação." });

  recordSystemLog({
    nivel: "info",
    categoria: "whatsapp",
    evento: "espera_resposta_finalizada",
    titulo: "Espera por resposta finalizada",
    origem: "usuario",
    mensagem: `A espera por resposta de ${pending.card_nome || "cliente"} foi finalizada manualmente.`,
    detalhes: {
      pending_id: id,
      send_log_id: pending.send_log_id,
      cliente: pending.card_nome,
      telefone: pending.telefone,
      observacao,
    },
  });
  emitEvent("pendingReply:resolved", finalized);
  res.json({ ok: true, log: finalized });
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
