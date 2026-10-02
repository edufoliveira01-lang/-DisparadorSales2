import { emitEvent } from "../websocket";
import { startBatch, updateBatch, finishBatch } from "./batchProgressService";
import { sortPericiasByDate, type Pericia } from "./parserService";
import { composeDispatch, type ModoEnvio } from "./messageComposer";
export type { ModoEnvio } from "./messageComposer";
import { createLog, type SendLog } from "./logsService";
import { whatsappManager } from "./whatsappService";
import { getSetting } from "./settingsService";
import { moveCard } from "./trelloService";
import { createPendingReply, linkPendingReplyToSendLog, type PendingReply } from "./pendingRepliesService";
import { registrarPericiaAgendada } from "./periciasAgendadasService";

export interface SendItem {
  cardId: string;
  /** Nome real do cliente (extraído da perícia), usado na variável {{NOME}} da mensagem. */
  nomeCliente: string;
  telefone: string;
  contactId: number | null;
  pericias: Pericia[];
  /** "template" (padrão) usa o template de perícia selecionado; os modos de audiência ignoram o
   * template e mandam o padrão da modalidade de audiência. Remarcações usam seu padrão próprio. */
  modo?: ModoEnvio;
}

function onlyDigits(value: string): string {
  return value.replace(/\D/g, "");
}

export async function dispatchSingle(item: SendItem, templateId: number | null): Promise<SendLog> {
  const modo: ModoEnvio = item.modo ?? "template";

  let remarcacoesJson: string | null = null;
  try {
    const composicao = composeDispatch(item, templateId);
    remarcacoesJson = composicao.remarcacoes.length ? JSON.stringify(composicao.remarcacoes) : null;
    if (!whatsappManager.isReady()) throw new Error("WhatsApp não está conectado.");

    const chatId = await whatsappManager.resolveChatId(onlyDigits(item.telefone));
    if (!chatId) throw new Error("Este telefone não foi encontrado no WhatsApp.");

    const sortedPericias = sortPericiasByDate(item.pericias);

    const mensagens = composicao.mensagens;
    if (mensagens.some(mensagem => !mensagem.trim())) throw new Error("A mensagem ficou vazia. Revise o template antes de enviar.");
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
    let pendingReply: PendingReply | null = null;
    if (confirmListId) {
      pendingReply = createPendingReply(
        item.cardId,
        item.nomeCliente,
        item.telefone,
        chatId.split("@")[0],
        chatId,
        ultimoMessageId
      );
    }

    // Alimenta o calendário de perícias agendadas só com o que foi de fato comunicado ao
    // cliente nesta mensagem — no modo audiência, só sortedPericias[0] é usada em renderAudiencia,
    // as demais (se houver) não entraram na mensagem enviada.
    const periciasComunicadas = modo === "template" ? sortedPericias : sortedPericias.slice(0, 1);
    for (const pericia of periciasComunicadas) {
      registrarPericiaAgendada(item.cardId, pericia);
    }

    const log = createLog({
      card_id: item.cardId,
      card_nome: item.nomeCliente,
      contact_id: item.contactId,
      telefone: item.telefone,
      remarcacoes_json: remarcacoesJson,
      pericias_json: JSON.stringify(sortedPericias),
      mensagem_enviada: mensagens.join("\n\n---\n\n"),
      status: "sucesso",
      erro: null,
      whatsapp_message_id: ultimoMessageId,
    });
    if (pendingReply) linkPendingReplyToSendLog(pendingReply.id, log.id);
    emitEvent("send:update", { cardId: item.cardId, status: "sucesso", log });
    return log;
  } catch (err) {
    const erro = (err as Error).message;
    const log = createLog({
      card_id: item.cardId,
      card_nome: item.nomeCliente,
      contact_id: item.contactId,
      telefone: item.telefone,
      remarcacoes_json: remarcacoesJson,
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
  const loteId = startBatch("mensagens", items.length);
  let enviados = 0;
  let falhas = 0;
  emitEvent("send:batch-started", { total: items.length });

  try {
    for (let i = 0; i < items.length; i++) {
      if (!whatsappManager.isReady()) {
        updateBatch(loteId, { aguardandoReconexao: true });
        emitEvent("send:batch-waiting-reconnect", {
          reason: "O WhatsApp desconectou durante o envio em lote. Aguardando reconexão para continuar automaticamente...",
          enviados,
          total: items.length,
        });
        const reconectou = await aguardarReconexao(TEMPO_LIMITE_RECONEXAO_MS);
        if (!reconectou) {
          emitEvent("send:batch-paused", {
            reason: "O WhatsApp continua desconectado. Reconecte e tente novamente para os cards restantes.",
            enviados,
            falhas,
            total: items.length,
          });
          return;
        }
        updateBatch(loteId, { aguardandoReconexao: false });
        emitEvent("send:batch-resumed", { enviados, total: items.length });
      }
      try {
        await dispatchSingle(items[i], templateId);
        enviados++;
      } catch {
        falhas++;
        // O erro já foi registrado e emitido por dispatchSingle.
      }
      updateBatch(loteId, { processados: i + 1, enviados, falhas });
      if (i < items.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, randomDelayMs(intervalMinSec, intervalMaxSec)));
      }
    }
    emitEvent("send:batch-completed", { total: items.length, enviados, falhas });
  } catch (err) {
    emitEvent("send:batch-paused", { reason: (err as Error).message, enviados, falhas, total: items.length });
    throw err;
  } finally {
    finishBatch(loteId);
  }
}

