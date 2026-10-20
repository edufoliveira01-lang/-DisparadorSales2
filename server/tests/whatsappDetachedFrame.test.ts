import type { Client } from "whatsapp-web.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isWhatsappBrowserStalledError, whatsappManager } from "../src/services/whatsappService";

type Internals = {
  client: Client | null;
  status: string;
  recuperarBrowserTravado: (motivo: string) => Promise<void>;
};
const manager = whatsappManager as unknown as Internals;
const original = { client: manager.client, status: manager.status };
const error = () => new Error("Attempted to use detached Frame '40333607C2C78738A29CC18601D971BF'.");
let client: { getNumberId: ReturnType<typeof vi.fn>; sendMessage: ReturnType<typeof vi.fn>; getContactLidAndPhone: ReturnType<typeof vi.fn> };
let recuperar: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.useFakeTimers();
  client = { getNumberId: vi.fn(), sendMessage: vi.fn(), getContactLidAndPhone: vi.fn().mockResolvedValue([]) };
  manager.client = client as unknown as Client; manager.status = "conectado";
  recuperar = vi.spyOn(manager, "recuperarBrowserTravado").mockImplementation(async () => {
    manager.client = null; manager.status = "inicializando";
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.clearAllTimers(); vi.useRealTimers(); manager.client = original.client; manager.status = original.status; });

describe("recuperação de Frame removido do WhatsApp", () => {
  it("reconhece o erro real, inclusive quando encapsulado por outro envio", () => {
    expect(isWhatsappBrowserStalledError(error())).toBe(true);
    expect(isWhatsappBrowserStalledError(new Error(`Falha ao enviar mensagem: ${error().message}`))).toBe(true);
  });
  it("recria a conexão na consulta do destinatário, sem repetir chamadas no Frame antigo", async () => {
    client.getNumberId.mockRejectedValue(error());
    await expect(whatsappManager.resolveChatId("5511999998888")).rejects.toThrow("reiniciada automaticamente");
    expect(client.getNumberId).toHaveBeenCalledOnce();
    expect(recuperar).toHaveBeenCalledOnce();
    expect(whatsappManager.isReady()).toBe(false);
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
  it("recupera o navegador durante o envio e não reenvia uma mensagem de resultado incerto", async () => {
    client.sendMessage.mockRejectedValue(error());
    await expect(whatsappManager.sendMessage("5511999998888@c.us", "Lembrete de teste")).rejects.toThrow("Confira a conversa antes de reenviar");
    expect(client.sendMessage).toHaveBeenCalledOnce();
    expect(recuperar).toHaveBeenCalledOnce();
  });
  it("recupera antes de enviar quando a consulta de aliases já detecta Frame removido", async () => {
    client.getContactLidAndPhone.mockRejectedValue(error());
    await expect(whatsappManager.sendMessageConfirmed("5511999998888@c.us", "Teste")).rejects.toThrow("Aguarde o status voltar");
    expect(recuperar).toHaveBeenCalledOnce();
    expect(client.sendMessage).not.toHaveBeenCalled();
  });
  it("não reinicia a conexão nova por causa de outra operação que falhou tardiamente", async () => {
    client.getNumberId.mockRejectedValue(error());
    await Promise.allSettled([whatsappManager.resolveChatId("5511999998888"), whatsappManager.resolveChatId("5511988887777")]);
    expect(recuperar).toHaveBeenCalledOnce();
  });
});
