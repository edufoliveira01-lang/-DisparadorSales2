import type { Client } from "whatsapp-web.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { reconciliarConfirmacaoDeEnvio } from "../src/services/deliveryAckReconciliation";
import { createLog, listLogsAguardandoConfirmacao } from "../src/services/logsService";
import { createPendingReply, linkPendingReplyToSendLog } from "../src/services/pendingRepliesService";

const CARD_ID = "teste:reconciliacao-ack";
const CHAT_ID = "5511999999999@c.us";
const RAW_ID = "3EB0RECONCILIACAO123";
const SERIALIZED_ID = `true_${CHAT_ID}_${RAW_ID}`;

function prepararEnvio(id: string) {
  const log = createLog({
    card_id: CARD_ID, card_nome: "CLIENTE TESTE", contact_id: null,
    telefone: "(11) 99999-9999", pericias_json: null,
    mensagem_enviada: "Mensagem de teste", status: "sucesso", erro: null,
    whatsapp_message_id: id,
  });
  const pendente = createPendingReply(CARD_ID, "CLIENTE TESTE", "(11) 99999-9999", "5511999999999", CHAT_ID, id);
  linkPendingReplyToSendLog(pendente.id, log.id);
  const item = listLogsAguardandoConfirmacao(log.id - 1, 10).find((envio) => envio.id === log.id);
  if (!item) throw new Error("Envio de teste ausente da conferência");
  return { log, pendente, item };
}

afterEach(() => {
  db.prepare("DELETE FROM pending_replies WHERE card_id = ?").run(CARD_ID);
  db.prepare("DELETE FROM send_logs WHERE card_id = ?").run(CARD_ID);
});

describe("conferência posterior de entrega", () => {
  it("recupera ACK perdido pelo ID completo e atualiza log e pendente", async () => {
    const { log, pendente, item } = prepararEnvio(SERIALIZED_ID);
    const client = {
      getMessageById: vi.fn().mockResolvedValue({ fromMe: true, id: { _serialized: SERIALIZED_ID }, ack: 2 }),
      getChatById: vi.fn(),
    } as unknown as Client;

    expect(await reconciliarConfirmacaoDeEnvio(client, item)).toBe(true);
    expect(client.getChatById).not.toHaveBeenCalled();
    expect((db.prepare("SELECT ack FROM send_logs WHERE id = ?").get(log.id) as { ack: number }).ack).toBe(2);
    expect((db.prepare("SELECT ack FROM pending_replies WHERE id = ?").get(pendente.id) as { ack: number }).ack).toBe(2);
    expect(listLogsAguardandoConfirmacao(log.id - 1, 10).some((envio) => envio.id === log.id)).toBe(false);
  });

  it("busca o ID reduzido na conversa e só aceita o ACK da mensagem certa", async () => {
    const { log, item } = prepararEnvio(RAW_ID);
    const chat = { fetchMessages: vi.fn().mockResolvedValue([
      { fromMe: true, id: { id: "OUTRA_MENSAGEM" }, ack: 3 },
      { fromMe: true, id: { _serialized: SERIALIZED_ID }, ack: 2 },
    ]) };
    const client = { getMessageById: vi.fn(), getChatById: vi.fn().mockResolvedValue(chat) } as unknown as Client;

    expect(await reconciliarConfirmacaoDeEnvio(client, item)).toBe(true);
    expect(client.getMessageById).not.toHaveBeenCalled();
    expect(client.getChatById).toHaveBeenCalledWith(CHAT_ID);
    expect((db.prepare("SELECT ack FROM send_logs WHERE id = ?").get(log.id) as { ack: number }).ack).toBe(2);
  });

  it("não presume entrega se o WhatsApp mostrar só envio ou mensagem diferente", async () => {
    const { log, item } = prepararEnvio(SERIALIZED_ID);
    const client = {
      getMessageById: vi.fn().mockResolvedValue({ fromMe: true, id: { _serialized: SERIALIZED_ID }, ack: 1 }),
      getChatById: vi.fn().mockResolvedValue({ fetchMessages: vi.fn().mockResolvedValue([
        { fromMe: true, id: { id: "OUTRA_MENSAGEM" }, ack: 3 },
      ]) }),
    } as unknown as Client;

    expect(await reconciliarConfirmacaoDeEnvio(client, item)).toBe(false);
    expect((db.prepare("SELECT ack FROM send_logs WHERE id = ?").get(log.id) as { ack: number }).ack).toBe(1);
  });
});
