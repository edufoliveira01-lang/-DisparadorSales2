import { EventEmitter } from "node:events";
import type { Client, Message } from "whatsapp-web.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendConfirmedWhatsappMessage } from "../src/services/confirmedWhatsappSend";

const CHAT = "5513999999999@c.us";
const LID = "100000000000001@lid";
const TEXTO = "Olá CLIENTE TESTE, você recebeu nossa mensagem?";
const ID = "COBRANCA123";

class FakeClient extends EventEmitter {
  sendMessage = vi.fn().mockResolvedValue(undefined);
}

function message(overrides: Record<string, unknown> = {}): Message {
  return { fromMe: true, to: CHAT, body: TEXTO, timestamp: Math.floor(Date.now() / 1000),
    id: { id: ID }, ack: 0, ...overrides } as unknown as Message;
}

let client: FakeClient;
function enviar(aliases: string[] = []) {
  return sendConfirmedWhatsappMessage(client as unknown as Client, CHAT, TEXTO, aliases, 1000);
}

beforeEach(() => { vi.useFakeTimers(); client = new FakeClient(); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

function semListeners() {
  for (const event of ["message_create", "message_ack", "disconnected"]) expect(client.listenerCount(event)).toBe(0);
}

describe("envio confirmado de cobrança", () => {
  it("aguarda resultado do envio e ACK real, não apenas message_create", async () => {
    const resultado = enviar();
    const concluido = vi.fn();
    resultado.then(concluido);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.sendMessage).toHaveBeenCalledOnce();
    expect(client.sendMessage).toHaveBeenCalledWith(CHAT, TEXTO, { waitUntilMsgSent: true });
    client.emit("message_create", message());
    await vi.advanceTimersByTimeAsync(100);
    expect(concluido).not.toHaveBeenCalled();
    client.emit("message_ack", message(), 1);
    await expect(resultado).resolves.toEqual({ messageId: ID, ack: 1 });
    semListeners();
  });

  it("não informa sucesso se há criação local mas nenhum ACK", async () => {
    const resultado = enviar();
    const rejeicao = expect(resultado).rejects.toThrow("Não foi possível confirmar");
    await vi.advanceTimersByTimeAsync(0);
    client.emit("message_create", message());
    await vi.advanceTimersByTimeAsync(1000);
    await rejeicao;
    expect(client.sendMessage).toHaveBeenCalledOnce();
    semListeners();
  });

  it("aceita ACK pelo alias LID validado a partir do telefone", async () => {
    const resultado = enviar([LID]);
    client.emit("message_ack", message({ to: LID }), 2);
    await expect(resultado).resolves.toEqual({ messageId: ID, ack: 2 });
  });

  it("aceita ACK que chegou antes do retorno da chamada sem completar cedo", async () => {
    let concluir!: (msg: Message) => void;
    client.sendMessage.mockImplementation(() => new Promise((resolve) => { concluir = resolve; }));
    const resultado = enviar();
    const concluido = vi.fn();
    resultado.then(concluido);
    await vi.advanceTimersByTimeAsync(0);
    client.emit("message_ack", message(), 3);
    await vi.advanceTimersByTimeAsync(0);
    expect(concluido).not.toHaveBeenCalled();
    concluir(message({ id: { _serialized: `true_${CHAT}_${ID}` } }));
    await expect(resultado).resolves.toEqual({ messageId: `true_${CHAT}_${ID}`, ack: 3 });
  });

  it("usa ACK positivo retornado na própria mensagem", async () => {
    client.sendMessage.mockResolvedValue(message({ ack: 1 }));
    await expect(enviar()).resolves.toEqual({ messageId: ID, ack: 1 });
    semListeners();
  });

  it("um ID direto com ACK 0 não é confirmação", async () => {
    client.sendMessage.mockResolvedValue(message());
    const resultado = enviar();
    const rejeicao = expect(resultado).rejects.toThrow("Não foi possível confirmar");
    await vi.advanceTimersByTimeAsync(1000);
    await rejeicao;
  });

  it.each([
    { body: "Outra mensagem" },
    { body: "" },
    { to: "5511999999999@c.us" },
    { to: LID },
    { fromMe: false },
    { timestamp: Math.floor(Date.now() / 1000) - 60 },
    { timestamp: undefined },
  ])("ignora mensagens fora do envio atual: %j", async (overrides) => {
    const resultado = enviar();
    const rejeicao = expect(resultado).rejects.toThrow("Não foi possível confirmar");
    await vi.advanceTimersByTimeAsync(0);
    client.emit("message_create", message(overrides));
    client.emit("message_ack", message(overrides), 2);
    await vi.advanceTimersByTimeAsync(1000);
    await rejeicao;
    semListeners();
  });

  it("correlaciona formato completo/reduzido pelo ID direto, mesmo com alias indisponível", async () => {
    client.sendMessage.mockResolvedValue(message({ id: { _serialized: `true_${CHAT}_${ID}` } }));
    const resultado = enviar();
    await vi.advanceTimersByTimeAsync(0);
    client.emit("message_ack", message({ to: LID }), 2);
    await expect(resultado).resolves.toEqual({ messageId: `true_${CHAT}_${ID}`, ack: 2 });
  });

  it("não associa ACK de outra mensagem com texto idêntico após obter ID direto", async () => {
    client.sendMessage.mockResolvedValue(message());
    const resultado = enviar();
    const rejeicao = expect(resultado).rejects.toThrow("Não foi possível confirmar");
    await vi.advanceTimersByTimeAsync(0);
    client.emit("message_ack", message({ id: { id: "OUTRA123" } }), 3);
    await vi.advanceTimersByTimeAsync(1000);
    await rejeicao;
  });

  it("prefere ID direto mesmo se outra mensagem idêntica foi criada antes", async () => {
    let concluir!: (msg: Message) => void;
    client.sendMessage.mockImplementation(() => new Promise((resolve) => { concluir = resolve; }));
    const resultado = enviar();
    await vi.advanceTimersByTimeAsync(0);
    client.emit("message_create", message({ id: { id: "OUTRA123" } }));
    client.emit("message_ack", message(), 2);
    concluir(message());
    await expect(resultado).resolves.toEqual({ messageId: ID, ack: 2 });
  });

  it("não aceita fallback ambíguo entre duas mensagens idênticas", async () => {
    const resultado = enviar();
    const rejeicao = expect(resultado).rejects.toThrow("mais de uma mensagem");
    await vi.advanceTimersByTimeAsync(0);
    client.emit("message_create", message({ id: { id: "OUTRA123" } }));
    client.emit("message_ack", message(), 1);
    await rejeicao;
    semListeners();
  });

  it("reporta ACK -1 como falha, sem reenviar", async () => {
    const resultado = enviar();
    const rejeicao = expect(resultado).rejects.toThrow("ACK -1");
    await vi.advanceTimersByTimeAsync(0);
    client.emit("message_ack", message(), -1);
    await rejeicao;
    expect(client.sendMessage).toHaveBeenCalledOnce();
    semListeners();
  });

  it("propaga erro da biblioteca mesmo após criação local", async () => {
    client.sendMessage.mockImplementation(async () => {
      client.emit("message_create", message());
      throw new Error("Execution context was destroyed");
    });
    await expect(enviar()).rejects.toThrow("Execution context was destroyed");
    expect(client.sendMessage).toHaveBeenCalledOnce();
    semListeners();
  });

  it("termina se a chamada fica pendurada e ignora conclusão tardia", async () => {
    let concluir!: (msg: Message) => void;
    client.sendMessage.mockImplementation(() => new Promise((resolve) => { concluir = resolve; }));
    const resultado = enviar();
    const rejeicao = expect(resultado).rejects.toThrow("Não foi possível confirmar");
    await vi.advanceTimersByTimeAsync(1000);
    await rejeicao;
    concluir(message({ ack: 2 }));
    await vi.advanceTimersByTimeAsync(0);
    semListeners();
    expect(client.sendMessage).toHaveBeenCalledOnce();
  });

  it("informa desconexão e remove observadores", async () => {
    const resultado = enviar();
    const rejeicao = expect(resultado).rejects.toThrow("desconectou");
    await vi.advanceTimersByTimeAsync(0);
    client.emit("disconnected", "CONNECTION_LOST");
    await rejeicao;
    semListeners();
  });

  it("não envia mensagem vazia", async () => {
    await expect(sendConfirmedWhatsappMessage(client as unknown as Client, CHAT, "  ")).rejects.toThrow("vazia");
    expect(client.sendMessage).not.toHaveBeenCalled();
    semListeners();
  });
});
