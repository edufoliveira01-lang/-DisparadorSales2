import { afterEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { createLog, updateLogAckByMessageId } from "../src/services/logsService";
import {
  createPendingReply,
  updatePendingReplyAckByMessageId,
} from "../src/services/pendingRepliesService";

const CARD_ID = "teste:rastreamento-entrega";
const RAW_ID = "3EB0TESTEACK123";
const SERIALIZED_ID = `true_5513999999999@c.us_${RAW_ID}`;

afterEach(() => {
  db.prepare("DELETE FROM pending_replies WHERE card_id = ?").run(CARD_ID);
  db.prepare("DELETE FROM send_logs WHERE card_id = ?").run(CARD_ID);
});

describe("rastreamento de entrega do WhatsApp", () => {
  it("registra Enviado como estágio inicial de um envio bem-sucedido", () => {
    const log = createLog({
      card_id: CARD_ID,
      card_nome: "CLIENTE TESTE",
      contact_id: null,
      telefone: "(13) 99999-9999",
      pericias_json: null,
      mensagem_enviada: "Mensagem de teste",
      status: "sucesso",
      erro: null,
      whatsapp_message_id: RAW_ID,
    });

    expect(log.ack).toBe(1);
  });

  it("correlaciona ACK completo com um ID reduzido e não regride o estágio", () => {
    const log = createLog({
      card_id: CARD_ID,
      card_nome: "CLIENTE TESTE",
      contact_id: null,
      telefone: "(13) 99999-9999",
      pericias_json: null,
      mensagem_enviada: "Mensagem de teste",
      status: "sucesso",
      erro: null,
      whatsapp_message_id: RAW_ID,
    });

    expect(updateLogAckByMessageId(SERIALIZED_ID, 2)?.ack).toBe(2);
    expect(updateLogAckByMessageId(SERIALIZED_ID, 1)).toBeUndefined();

    const persisted = db.prepare("SELECT ack FROM send_logs WHERE id = ?").get(log.id) as { ack: number };
    expect(persisted.ack).toBe(2);
  });

  it("aplica a mesma correlação em Pendentes de Resposta", () => {
    const pending = createPendingReply(
      CARD_ID,
      "CLIENTE TESTE",
      "(13) 99999-9999",
      "5513999999999",
      "5513999999999@c.us",
      RAW_ID
    );

    expect(pending.ack).toBe(1);
    expect(updatePendingReplyAckByMessageId(SERIALIZED_ID, 3)?.ack).toBe(3);
  });
});
