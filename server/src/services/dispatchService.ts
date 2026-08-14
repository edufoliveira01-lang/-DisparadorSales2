import { emitEvent } from "../websocket";
import { sortPericiasByDate, type Pericia } from "./parserService";
import {
  AUDIENCIA_HIBRIDA_MENSAGEM_PADRAO,
  AUDIENCIA_ONLINE_MENSAGEM_PADRAO,
  AUDIENCIA_PRESENCIAL_MENSAGEM_PADRAO,
  getTemplate,
  renderAudiencia,
  renderMessages,
} from "./templateService";
import { createLog, type SendLog } from "./logsService";
import { whatsappManager } from "./whatsappService";
import { getSetting } from "./settingsService";
import { moveCard } from "./trelloService";
import { createPendingReply } from "./pendingRepliesService";

export type ModoEnvio = "template" | "audiencia_presencial" | "audiencia_online" | "audiencia_hibrida";

const CONFIGURACAO_AUDIENCIA: Record<
  Exclude<ModoEnvio, "template">,
  { chaveSetting: string; padrao: string }
> = {
  audiencia_presencial: { chaveSetting: "audiencia_presencial_mensagem", padrao: AUDIENCIA_PRESENCIAL_MENSAGEM_PADRAO },
  audiencia_online: { chaveSetting: "audiencia_online_mensagem", padrao: AUDIENCIA_ONLINE_MENSAGEM_PADRAO },
  audiencia_hibrida: { chaveSetting: "audiencia_hibrida_mensagem", padrao: AUDIENCIA_HIBRIDA_MENSAGEM_PADRAO },
};

export interface SendItem {
  cardId: string;
  /** Nome real do cliente (extraído da perícia), usado na variável {{NOME}} da mensagem. */
  nomeCliente: string;
  telefone: string;
  contactId: number | null;
  pericias: Pericia[];
  /** "template" (padrão) usa o template de perícia selecionado; os outros dois ignoram o
   * template e mandam a mensagem de audiência configurada em Templates > Audiência. */
  modo?: ModoEnvio;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export async function dispatchSingle(item: SendItem, templateId: number | null): Promise<SendLog> {
  const modo: ModoEnvio = item.modo ?? "template";

  let template: ReturnType<typeof getTemplate>;
  if (modo === "template") {
    if (!templateId) throw new Error("Selecione um template de mensagem.");
    template = getTemplate(templateId);
    if (!template) throw new Error("Template não encontrado.");
  }

  try {
    if (!whatsappManager.isReady()) throw new Error("WhatsApp não está conectado.");

    const chatId = await whatsappManager.resolveChatId(onlyDigits(item.telefone));
    if (!chatId) throw new Error("Este telefone não foi encontrado no WhatsApp.");

    const sortedPericias = sortPericiasByDate(item.pericias);

    let mensagens: string[];
    if (modo !== "template") {
      if (sortedPericias.length === 0) throw new Error("Nenhuma perícia válida para gerar mensagem.");
      const { chaveSetting, padrao } = CONFIGURACAO_AUDIENCIA[modo];
      const mensagemConfigurada = getSetting(chaveSetting) || padrao;
      mensagens = [renderAudiencia(mensagemConfigurada, item.nomeCliente, sortedPericias[0])];
    } else {
      mensagens = renderMessages(template!, item.nomeCliente, sortedPericias);
    }
    if (mensagens.length === 0) throw new Error("Nenhuma perícia válida para gerar mensagem.");

    // Guarda o id da última mensagem enviada para rastrear entrega/leitura (✓✓) no Histórico.
    let ultimoMessageId: string | null = null;
    for (const mensagem of mensagens) {
      ultimoMessageId = await whatsappManager.sendMessage(chatId, mensagem);
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

    // Se houver uma lista de confirmação configurada, passamos a monitorar esse telefone:
    // quando o cliente responder ou reagir à mensagem, o cartão é movido automaticamente.
    // Importante: usamos o chatId já resolvido pelo WhatsApp (linha acima) para CASAR com a
    // resposta, não item.telefone bruto — números brasileiros têm uma ambiguidade conhecida do
    // 9º dígito, e o JID que chega em "message"/"message_reaction" é sempre o canônico do
    // WhatsApp (às vezes nem é baseado no telefone, quando o contato já migrou para "LID").
    // O telefone bruto do contato continua sendo usado só para EXIBIÇÃO na tela.
    const confirmListId = getSetting("trello_confirm_list_id");
    if (confirmListId) {
      createPendingReply(item.cardId, item.nomeCliente, item.telefone, chatId.split("@")[0], chatId, ultimoMessageId);
    }

    const log = createLog({
      card_id: item.cardId,
      card_nome: item.nomeCliente,
      contact_id: item.contactId,
      telefone: item.telefone,
      pericias_json: JSON.stringify(sortedPericias),
      mensagem_enviada: mensagens.join("\n\n---\n\n"),
      status: "sucesso",
      erro: null,
      whatsapp_message_id: ultimoMessageId,
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

// Quanto tempo esperar por uma reconexão manual do WhatsApp antes de desistir de vez do lote.
// O whatsappManager não reconecta sozinho depois de uma queda inesperada (só reagenda QR
// enquanto ainda está no meio de uma tentativa de conexão) — o usuário precisa clicar em
// "Conectar WhatsApp" de novo. Esse prazo dá tempo real pra isso acontecer (inclusive pra quem
// só vai notar pelo alerta do Telegram) sem travar o processo do servidor indefinidamente se a
// queda for definitiva (ex: sessão desconectada do celular).
const TEMPO_LIMITE_RECONEXAO_MS = 15 * 60 * 1000;
const INTERVALO_VERIFICACAO_RECONEXAO_MS = 5000;

async function aguardarReconexao(timeoutMs: number): Promise<boolean> {
  const inicio = Date.now();
  while (Date.now() - inicio < timeoutMs) {
    if (whatsappManager.isReady()) return true;
    await new Promise((resolve) => setTimeout(resolve, INTERVALO_VERIFICACAO_RECONEXAO_MS));
  }
  return whatsappManager.isReady();
}

export async function dispatchBatch(
  items: SendItem[],
  templateId: number | null,
  intervalMinSec: number,
  intervalMaxSec: number
): Promise<void> {
  emitEvent("send:batch-started", { total: items.length });

  for (let i = 0; i < items.length; i++) {
    if (!whatsappManager.isReady()) {
      emitEvent("send:batch-waiting-reconnect", {
        reason: "O WhatsApp desconectou durante o envio em lote. Aguardando reconexão para continuar automaticamente...",
        enviados: i,
        total: items.length,
      });

      const reconectou = await aguardarReconexao(TEMPO_LIMITE_RECONEXAO_MS);
      if (!reconectou) {
        emitEvent("send:batch-paused", {
          reason: "O WhatsApp continua desconectado. Reconecte e tente novamente para os cards restantes.",
          enviados: i,
          total: items.length,
        });
        return;
      }

      emitEvent("send:batch-resumed", { enviados: i, total: items.length });
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
