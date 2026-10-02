import { normalizePhone } from "../utils/phone";
import { emitEvent } from "../websocket";
import { createLog, type SendLog } from "./logsService";
import { recordSystemLog } from "./systemLogsService";
import { whatsappManager } from "./whatsappService";

const SEPARADOR_MENSAGENS = "\n\n---\n\n";

/**
 * Reenvia exatamente o conteúdo guardado no Histórico. Não renderiza template, não movimenta
 * Trello/calendário e não cria pending_reply: o atendimento original permanece como estava.
 */
export async function resendStoredInformation(original: SendLog): Promise<SendLog> {
  if (!original.telefone) throw new Error("Este registro não tem telefone associado.");
  if (!original.mensagem_enviada?.trim()) throw new Error("Este registro não possui uma mensagem para reenviar.");
  if (!whatsappManager.isReady()) throw new Error("WhatsApp não está conectado.");

  const telefone = normalizePhone(original.telefone);
  if (!/^\d{10,15}$/.test(telefone)) throw new Error("Este registro não possui um telefone válido para o reenvio.");

  const mensagens = original.mensagem_enviada
    .split(SEPARADOR_MENSAGENS)
    .filter((mensagem) => mensagem.trim().length > 0);
  let enviadas = 0;
  let chatId: string | null = null;
  let ultimoMessageId: string | null = null;
  let ultimoAck = 1;

  try {
    chatId = await whatsappManager.resolveChatId(telefone);
    if (!chatId) throw new Error("Este telefone não foi encontrado no WhatsApp.");

    for (const mensagem of mensagens) {
      const resultado = await whatsappManager.sendMessageConfirmed(chatId, mensagem);
      ultimoMessageId = resultado.messageId;
      ultimoAck = resultado.ack;
      enviadas++;
    }

    const novoLog = createLog({
      card_id: original.card_id,
      card_nome: original.card_nome,
      contact_id: original.contact_id,
      telefone: original.telefone,
      pericias_json: original.pericias_json,
      remarcacoes_json: original.remarcacoes_json ?? null,
      mensagem_enviada: original.mensagem_enviada,
      status: "sucesso",
      erro: null,
      whatsapp_message_id: ultimoMessageId,
      tipo_envio: "reenvio",
    });
    emitEvent("send:update", { cardId: original.card_id, status: "sucesso", log: novoLog });
    recordSystemLog({
      nivel: "info", categoria: "whatsapp", evento: "informacoes_reenviadas",
      titulo: "Informações da perícia reenviadas", origem: "usuario",
      mensagem: `Reenvio confirmado pelo servidor do WhatsApp para ${original.card_nome || "cliente"}.`,
      detalhes: { envio_original_id: original.id, novo_envio_id: novoLog.id,
        cliente: original.card_nome, telefone: original.telefone, chat_id: chatId,
        whatsapp_message_id: ultimoMessageId, ack: ultimoAck, mensagens_enviadas: enviadas },
    });
    return novoLog;
  } catch (err) {
    const causa = err instanceof Error ? err.message : "Erro desconhecido no reenvio.";
    const erro = enviadas > 0
      ? `Reenvio incompleto: ${enviadas} de ${mensagens.length} mensagem(ns) confirmada(s). ${causa}`
      : causa;
    const falha = createLog({
      card_id: original.card_id,
      card_nome: original.card_nome,
      contact_id: original.contact_id,
      telefone: original.telefone,
      pericias_json: original.pericias_json,
      remarcacoes_json: original.remarcacoes_json ?? null,
      mensagem_enviada: null,
      status: "falha",
      erro,
      tipo_envio: "reenvio",
    });
    emitEvent("send:update", { cardId: original.card_id, status: "falha", erro, log: falha });
    recordSystemLog({
      nivel: "erro", categoria: "whatsapp", evento: "reenvio_informacoes_falhou",
      titulo: "Falha ao reenviar informações da perícia", origem: "usuario", mensagem: erro,
      detalhes: { envio_original_id: original.id, envio_falha_id: falha.id,
        cliente: original.card_nome, telefone: original.telefone, chat_id: chatId,
        mensagens_confirmadas: enviadas, total_mensagens: mensagens.length },
    });
    throw new Error(erro);
  }
}

