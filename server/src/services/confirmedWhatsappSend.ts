import type { Client, Message } from "whatsapp-web.js";
import { whatsappMessageIdCandidates, whatsappMessageStableKey } from "../utils/whatsappMessageId";

export interface ConfirmedWhatsappSend {
  messageId: string;
  ack: number;
}

/**
 * message_create confirma somente a criação local. A mensagem só é considerada enviada
 * quando a chamada termina E a própria mensagem recebe ACK >= 1 (servidor do WhatsApp).
 * Nunca repetimos um envio automaticamente: um timeout pode ter resultado incerto.
 */
export function sendConfirmedWhatsappMessage(
  client: Client,
  chatId: string,
  texto: string,
  chatAliases: string[] = [],
  timeoutMs = 20000,
): Promise<ConfirmedWhatsappSend> {
  if (!texto.trim()) return Promise.reject(new Error("A mensagem está vazia."));

  const destinatarios = new Set([chatId, ...chatAliases]);
  const iniciadoEm = Math.floor(Date.now() / 1000);

  return new Promise((resolve, reject) => {
    let encerrado = false;
    let chamadaConcluida = false;
    let directId: string | null = null;
    const candidates = new Map<string, string>();
    const acks = new Map<string, number>();

    function limpar() {
      clearTimeout(timer);
      client.removeListener("message_create", onCreate);
      client.removeListener("message_ack", onAck);
      client.removeListener("disconnected", onDisconnected);
    }

    function falhar(erro: Error) {
      if (encerrado) return;
      encerrado = true;
      limpar();
      reject(erro);
    }

    function verificar() {
      if (encerrado || !chamadaConcluida) return;
      if (!directId && candidates.size > 1) {
        falhar(new Error("Não foi possível identificar o envio com segurança: mais de uma mensagem corresponde à tentativa. Confira a conversa antes de tentar novamente."));
        return;
      }
      const messageId = directId || candidates.values().next().value;
      if (!messageId) return;
      const ack = acks.get(whatsappMessageStableKey(messageId));
      if (ack === -1) {
        falhar(new Error("O WhatsApp informou falha no envio da mensagem (ACK -1)."));
      } else if (chamadaConcluida && ack !== undefined && ack >= 1) {
        encerrado = true;
        limpar();
        resolve({ messageId, ack });
      }
    }

    function mensagemDoEnvio(message: Message): string | null {
      if (!message.fromMe) return null;
      const id = whatsappMessageIdCandidates(message.id)[0];
      if (!id) return null;
      // Depois do retorno direto, a identidade da mensagem é mais forte que chat/texto.
      if (directId) return whatsappMessageStableKey(id) === whatsappMessageStableKey(directId) ? id : null;
      if (!destinatarios.has(message.to) || message.body !== texto ||
          !Number.isFinite(message.timestamp) || message.timestamp < iniciadoEm) return null;
      candidates.set(whatsappMessageStableKey(id), id);
      return id;
    }

    function onCreate(message: Message) {
      mensagemDoEnvio(message);
      // Não aceitamos criação local como confirmação, nem buscamos mensagens antigas.
    }

    function onAck(message: Message, ack: number) {
      const id = mensagemDoEnvio(message);
      if (!id) return;
      const key = whatsappMessageStableKey(id);
      const anterior = acks.get(key);
      if (anterior !== -1 && (anterior === undefined || ack === -1 || ack > anterior)) acks.set(key, ack);
      verificar();
    }

    function onDisconnected() {
      falhar(new Error("O WhatsApp desconectou durante o envio. Confira a conversa antes de tentar novamente."));
    }

    const timer = setTimeout(() => falhar(new Error(
      "Não foi possível confirmar o envio no WhatsApp. Confira a conversa antes de tentar novamente; o sistema não reenviou automaticamente.",
    )), timeoutMs);

    client.on("message_create", onCreate);
    client.on("message_ack", onAck);
    client.on("disconnected", onDisconnected);

    // Promise.resolve também captura exceções síncronas; callbacks tardios são ignorados.
    Promise.resolve().then(() => client.sendMessage(chatId, texto, { waitUntilMsgSent: true }))
      .then((sent) => {
        if (encerrado) return;
        directId = whatsappMessageIdCandidates(sent?.id)[0] || null;
        chamadaConcluida = true;
        if (directId && Number.isFinite(sent?.ack)) {
          const key = whatsappMessageStableKey(directId);
          const anterior = acks.get(key);
          if (anterior !== -1 && (anterior === undefined || sent.ack === -1 || sent.ack > anterior)) {
            acks.set(key, sent.ack);
          }
        }
        verificar();
      }).catch((err: unknown) => falhar(new Error(
        `Falha ao enviar mensagem: ${err instanceof Error ? err.message : String(err)}. Confira a conversa antes de tentar novamente.`,
      )));
  });
}
