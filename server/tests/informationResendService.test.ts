import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isReady: vi.fn(), resolveChatId: vi.fn(), sendMessageConfirmed: vi.fn(),
  createLog: vi.fn(), recordSystemLog: vi.fn(), emitEvent: vi.fn(),
}));

vi.mock("../src/services/whatsappService", () => ({ whatsappManager: {
  isReady: mocks.isReady,
  resolveChatId: mocks.resolveChatId,
  sendMessageConfirmed: mocks.sendMessageConfirmed,
} }));
vi.mock("../src/services/logsService", () => ({ createLog: mocks.createLog }));
vi.mock("../src/services/systemLogsService", () => ({ recordSystemLog: mocks.recordSystemLog }));
vi.mock("../src/websocket", () => ({ emitEvent: mocks.emitEvent }));

import { resendStoredInformation } from "../src/services/informationResendService";

const original = {
  id: 42, card_id: "card-42", card_nome: "CLIENTE TESTE", contact_id: 7,
  telefone: "(13) 99999-9999", pericias_json: '[{"tipo":"Perícia médica"}]',
  mensagem_enviada: "Primeira mensagem", status: "sucesso", erro: null,
  whatsapp_message_id: "ORIGINAL", ack: 3, ack_updated_at: null,
  tipo_envio: "disparo", created_at: "2026-09-21 12:00:00",
} as const;

beforeEach(() => {
  vi.resetAllMocks();
  mocks.isReady.mockReturnValue(true);
  mocks.resolveChatId.mockResolvedValue("5513999999999@c.us");
  mocks.sendMessageConfirmed.mockResolvedValue({ messageId: "REENVIO-1", ack: 1 });
  mocks.createLog.mockImplementation((entry) => ({ id: entry.status === "sucesso" ? 43 : 44, ...entry, ack: entry.status === "sucesso" ? 1 : null }));
});

describe("reenvio das informações guardadas no Histórico", () => {
  it("envia exatamente a mensagem original e cria novo log sem reabrir atendimento", async () => {
    const result = await resendStoredInformation(original as any);
    expect(mocks.resolveChatId).toHaveBeenCalledWith("5513999999999");
    expect(mocks.sendMessageConfirmed).toHaveBeenCalledOnce();
    expect(mocks.sendMessageConfirmed).toHaveBeenCalledWith("5513999999999@c.us", "Primeira mensagem");
    expect(mocks.createLog).toHaveBeenCalledWith(expect.objectContaining({
      card_id: original.card_id, telefone: original.telefone,
      mensagem_enviada: original.mensagem_enviada, status: "sucesso",
      tipo_envio: "reenvio", whatsapp_message_id: "REENVIO-1",
    }));
    expect(result.id).toBe(43);
    expect(mocks.emitEvent).toHaveBeenCalledWith("send:update", expect.objectContaining({ status: "sucesso" }));
    expect(mocks.recordSystemLog).toHaveBeenCalledWith(expect.objectContaining({ evento: "informacoes_reenviadas" }));
  });

  it("preserva envios originalmente separados, sem mandar o separador visual", async () => {
    mocks.sendMessageConfirmed
      .mockResolvedValueOnce({ messageId: "REENVIO-1", ack: 1 })
      .mockResolvedValueOnce({ messageId: "REENVIO-2", ack: 2 });
    await resendStoredInformation({ ...original, mensagem_enviada: "Mensagem A\n\n---\n\nMensagem B" } as any);
    expect(mocks.sendMessageConfirmed).toHaveBeenNthCalledWith(1, "5513999999999@c.us", "Mensagem A");
    expect(mocks.sendMessageConfirmed).toHaveBeenNthCalledWith(2, "5513999999999@c.us", "Mensagem B");
    expect(mocks.createLog).toHaveBeenCalledWith(expect.objectContaining({ whatsapp_message_id: "REENVIO-2" }));
  });

  it("registra falha sem repetir automaticamente a mensagem", async () => {
    mocks.sendMessageConfirmed.mockRejectedValue(new Error("Envio não confirmado"));
    await expect(resendStoredInformation(original as any)).rejects.toThrow("Envio não confirmado");
    expect(mocks.sendMessageConfirmed).toHaveBeenCalledOnce();
    expect(mocks.createLog).toHaveBeenCalledWith(expect.objectContaining({
      status: "falha", tipo_envio: "reenvio", mensagem_enviada: null,
    }));
    expect(mocks.recordSystemLog).toHaveBeenCalledWith(expect.objectContaining({ evento: "reenvio_informacoes_falhou" }));
  });

  it("informa reenvio parcial e não recomeça a sequência", async () => {
    mocks.sendMessageConfirmed
      .mockResolvedValueOnce({ messageId: "REENVIO-1", ack: 1 })
      .mockRejectedValueOnce(new Error("Segunda mensagem não confirmada"));
    await expect(resendStoredInformation({ ...original, mensagem_enviada: "A\n\n---\n\nB" } as any))
      .rejects.toThrow("Reenvio incompleto: 1 de 2");
    expect(mocks.sendMessageConfirmed).toHaveBeenCalledTimes(2);
    expect(mocks.createLog).toHaveBeenCalledWith(expect.objectContaining({
      status: "falha", erro: expect.stringContaining("1 de 2"),
    }));
  });

  it.each([
    [{ ...original, telefone: null }, "telefone associado"],
    [{ ...original, mensagem_enviada: null }, "mensagem para reenviar"],
    [{ ...original, telefone: "123" }, "telefone válido"],
  ])("recusa registro incompleto antes do envio", async (registro, erro) => {
    await expect(resendStoredInformation(registro as any)).rejects.toThrow(erro);
    expect(mocks.sendMessageConfirmed).not.toHaveBeenCalled();
    expect(mocks.createLog).not.toHaveBeenCalled();
  });

  it("recusa reenvio com WhatsApp desconectado", async () => {
    mocks.isReady.mockReturnValue(false);
    await expect(resendStoredInformation(original as any)).rejects.toThrow("não está conectado");
    expect(mocks.resolveChatId).not.toHaveBeenCalled();
  });
});
