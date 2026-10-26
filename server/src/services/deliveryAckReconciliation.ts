import type { Client, Message } from "whatsapp-web.js";
import { whatsappMessageIdCandidates, whatsappMessageStableKey } from "../utils/whatsappMessageId";
import { normalizePhone } from "../utils/phone";
import { emitEvent } from "../websocket";
import { updateLogAckByMessageId, type LogAguardandoConfirmacao } from "./logsService";
import { updatePendingReplyAckByMessageId } from "./pendingRepliesService";

async function comLimite<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("Consulta de confirmação expirou")), 8000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function correspondeAoEnvio(message: Message | null, messageId: string): message is Message {
  return Boolean(message?.fromMe && whatsappMessageIdCandidates(message.id).some(
    (candidate) => whatsappMessageStableKey(candidate) === whatsappMessageStableKey(messageId),
  ));
}

/** Consulta somente o ACK da mensagem exata; nunca infere entrega pelo estado do chat. */
export async function reconciliarConfirmacaoDeEnvio(
  client: Client,
  envio: LogAguardandoConfirmacao,
): Promise<boolean> {
  const id = envio.whatsapp_message_id;
  let mensagem: Message | null = null;

  // A consulta direta requer o identificador completo. Alguns envios antigos têm só o stanza ID.
  if (id.includes("@") && id.includes("_")) {
    try {
      const encontrada = await comLimite(client.getMessageById(id));
      if (correspondeAoEnvio(encontrada, id)) mensagem = encontrada;
    } catch {
      // O WhatsApp Web pode não ter a mensagem em memória; buscamos na conversa abaixo.
    }
  }

  if (!mensagem) {
    let chatId = envio.whatsapp_chat_id;
    if (!chatId && envio.telefone) {
      try {
        chatId = (await comLimite(client.getNumberId(normalizePhone(envio.telefone))))?._serialized ?? null;
      } catch {
        return false;
      }
    }
    if (!chatId) return false;
    const chat = await comLimite(client.getChatById(chatId));
    const recentes = await comLimite(chat.fetchMessages({ limit: 50 }));
    mensagem = recentes.find((item) => correspondeAoEnvio(item, id)) ?? null;
  }

  const ack = Number(mensagem?.ack);
  if (!mensagem || !Number.isInteger(ack) || ack < 2 || ack > 4) return false;

  const log = updateLogAckByMessageId(id, ack);
  const pendente = updatePendingReplyAckByMessageId(id, ack);
  if (log) emitEvent("send:ack-update", log);
  if (pendente) emitEvent("pendingReply:ack-update", pendente);
  return Boolean(log || pendente);
}
