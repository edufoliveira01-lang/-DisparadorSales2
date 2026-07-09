import { emitEvent } from "../websocket";
import type { Pericia } from "./parserService";
import { getTemplate, renderMessages } from "./templateService";
import { createLog, type SendLog } from "./logsService";
import { whatsappManager } from "./whatsappService";
import { getSetting } from "./settingsService";
import { moveCard } from "./trelloService";

export interface SendItem {
  cardId: string;
  /** Nome real do cliente (extraído da perícia), usado na variável {{NOME}} da mensagem. */
  nomeCliente: string;
  telefone: string;
  contactId: number | null;
  pericias: Pericia[];
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export async function dispatchSingle(item: SendItem, templateId: number): Promise<SendLog> {
  const template = getTemplate(templateId);
  if (!template) throw new Error("Template não encontrado.");

  try {
    if (!whatsappManager.isReady()) throw new Error("WhatsApp não está conectado.");

    const chatId = await whatsappManager.resolveChatId(onlyDigits(item.telefone));
    if (!chatId) throw new Error("Este telefone não foi encontrado no WhatsApp.");

    const mensagens = renderMessages(template, item.nomeCliente, item.pericias);
    if (mensagens.length === 0) throw new Error("Nenhuma perícia válida para gerar mensagem.");

    for (const mensagem of mensagens) {
      await whatsappManager.sendMessage(chatId, mensagem);
    }

    // Movimentação automática no Trello se configurada
    const moveListId = getSetting("trello_move_list_id");
    const trelloKey = getSetting("trello_key");
    const trelloToken = getSetting("trello_token");

    if (moveListId && trelloKey && trelloToken) {
      try {
        await moveCard(trelloKey, trelloToken, item.cardId, moveListId);
      } catch (moveErr) {
        console.error(`Erro ao mover cartão ${item.cardId} no Trello:`, moveErr);
        // Não falhamos o envio se apenas a movimentação falhar, mas logamos o erro
      }
    }

    const log = createLog({
      card_id: item.cardId,
      card_nome: item.nomeCliente,
      contact_id: item.contactId,
      telefone: item.telefone,
      pericias_json: JSON.stringify(item.pericias),
      mensagem_enviada: mensagens.join("\n\n---\n\n"),
      status: "sucesso",
      erro: null,
    });
    emitEvent("send:update", { cardId: item.cardId, status: "sucesso", log });
    return log;
  } catch (err) {
    const erro = (err as Error).message;
    const log = createLog({
      card_id: item.cardId,
      card_nome: item.nomeCliente,
      contact_id: item.contactId,
      telefone: item.telefone,
      pericias_json: JSON.stringify(item.pericias),
      mensagem_enviada: null,
      status: "falha",
      erro,
    });
    emitEvent("send:update", { cardId: item.cardId, status: "falha", erro, log });
    throw err;
  }
}

function randomDelayMs(minSec: number, maxSec: number): number {
  const min = Math.min(minSec, maxSec);
  const max = Math.max(minSec, maxSec);
  return (min + Math.random() * (max - min)) * 1000;
}

export async function dispatchBatch(
  items: SendItem[],
  templateId: number,
  intervalMinSec: number,
  intervalMaxSec: number
): Promise<void> {
  emitEvent("send:batch-started", { total: items.length });

  for (let i = 0; i < items.length; i++) {
    if (!whatsappManager.isReady()) {
      emitEvent("send:batch-paused", {
        reason: "O WhatsApp desconectou durante o envio em lote. Reconecte e tente novamente para os cards restantes.",
        enviados: i,
        total: items.length,
      });
      return;
    }

    try {
      await dispatchSingle(items[i], templateId);
    } catch {
      // erro já registrado no log e emitido via websocket dentro de dispatchSingle
    }

    if (i < items.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, randomDelayMs(intervalMinSec, intervalMaxSec)));
    }
  }

  emitEvent("send:batch-completed", { total: items.length });
}
