import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPendingReply: vi.fn(), resolvePendingReply: vi.fn(), cancelPendingReply: vi.fn(),
  getLog: vi.fn(), getLastStatusForCard: vi.fn(), getSetting: vi.fn(),
  isReady: vi.fn(), resolveChatId: vi.fn(), sendMessageConfirmed: vi.fn(), sendMessage: vi.fn(),
  recordSystemLog: vi.fn(), renderCobranca: vi.fn(), emitEvent: vi.fn(),
}));

vi.mock("../src/services/pendingRepliesService", () => ({
  getPendingReply: mocks.getPendingReply, resolvePendingReply: mocks.resolvePendingReply,
  cancelPendingReply: mocks.cancelPendingReply, listPendingReplies: vi.fn(),
  deletePendingReply: vi.fn(), deletePendingReplies: vi.fn(),
}));
vi.mock("../src/services/logsService", () => ({ getLog: mocks.getLog, getLastStatusForCard: mocks.getLastStatusForCard }));
vi.mock("../src/services/settingsService", () => ({ getSetting: mocks.getSetting }));
vi.mock("../src/services/whatsappService", () => ({ whatsappManager: {
  isReady: mocks.isReady, resolveChatId: mocks.resolveChatId,
  sendMessageConfirmed: mocks.sendMessageConfirmed, sendMessage: mocks.sendMessage,
} }));
vi.mock("../src/services/systemLogsService", () => ({ recordSystemLog: mocks.recordSystemLog }));
vi.mock("../src/services/templateService", () => ({
  COBRANCA_MENSAGEM_PADRAO: "Cobrança padrão", COBRANCA_AUDIENCIA_MENSAGEM_PADRAO: "Cobrança audiência",
  renderCobranca: mocks.renderCobranca,
}));
vi.mock("../src/services/parserService", () => ({ sortPericiasByDate: (pericias: unknown[]) => pericias }));
vi.mock("../src/services/trelloService", () => ({ moveCard: vi.fn(), TrelloError: class extends Error {} }));
vi.mock("../src/websocket", () => ({ emitEvent: mocks.emitEvent }));

import { pendingRepliesRouter } from "../src/routes/pendingReplies";

let server: Server;
let baseUrl: string;
let sequencia = 0;
let pending: Record<string, unknown>;

beforeAll(async () => {
  const app = express();
  app.use("/pending-replies", pendingRepliesRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
});
beforeEach(() => {
  vi.resetAllMocks();
  pending = { id: 1, status: "aguardando", card_id: "teste:cobranca", card_nome: "CLIENTE TESTE",
    telefone: `(13) 99999-${String(++sequencia).padStart(4, "0")}`,
    telefone_digits: "100000000000001", whatsapp_chat_id: "100000000000001@lid",
    whatsapp_message_id: "ORIGINAL123", send_log_id: 10, ack: 2 };
  mocks.getPendingReply.mockImplementation(() => pending);
  mocks.isReady.mockReturnValue(true);
  mocks.resolveChatId.mockResolvedValue("5513999999999@c.us");
  mocks.sendMessageConfirmed.mockResolvedValue({ messageId: "COBRANCA123", ack: 1 });
  mocks.renderCobranca.mockReturnValue("Texto da cobrança");
});

async function cobrar() {
  const response = await fetch(`${baseUrl}/pending-replies/1/cobrar`, { method: "POST" });
  return { status: response.status, body: await response.json() };
}

describe("cobrança manual de pendentes", () => {
  it("resolve telefone real, não reutiliza LID antigo, confirma e mantém atendimento original", async () => {
    const original = { ...pending };
    const response = await cobrar();
    expect(response).toEqual({ status: 200, body: { ok: true, whatsapp_message_id: "COBRANCA123", ack: 1 } });
    expect(mocks.resolveChatId).toHaveBeenCalledWith(`551399999${String(sequencia).padStart(4, "0")}`);
    expect(mocks.sendMessageConfirmed).toHaveBeenCalledWith("5513999999999@c.us", "Texto da cobrança");
    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(mocks.resolvePendingReply).not.toHaveBeenCalled();
    expect(mocks.cancelPendingReply).not.toHaveBeenCalled();
    expect(pending).toEqual(original);
    expect(mocks.recordSystemLog).toHaveBeenCalledWith(expect.objectContaining({
      evento: "cobranca_enviada", detalhes: expect.objectContaining({ whatsapp_message_id: "COBRANCA123", ack: 1 }),
    }));
  });

  it("usa dados do envio vinculado, não de um lembrete posterior", async () => {
    const pericia = { origem: "audiencia", data: "20/10/2026", horario: "10:00" };
    mocks.getLog.mockReturnValue({ pericias_json: JSON.stringify([pericia]) });
    await cobrar();
    expect(mocks.getLog).toHaveBeenCalledWith(10);
    expect(mocks.getLastStatusForCard).not.toHaveBeenCalled();
    expect(mocks.getSetting).toHaveBeenCalledWith("cobranca_audiencia_mensagem");
    expect(mocks.renderCobranca).toHaveBeenCalledWith("Cobrança audiência", "CLIENTE TESTE", pericia);
  });

  it("registra falha e não retorna sucesso quando envio não foi confirmado", async () => {
    mocks.sendMessageConfirmed.mockRejectedValue(new Error("Não foi possível confirmar o envio"));
    const response = await cobrar();
    expect(response.status).toBe(502);
    expect(response.body.error).toContain("Não foi possível confirmar");
    expect(mocks.recordSystemLog).toHaveBeenCalledWith(expect.objectContaining({ evento: "cobranca_falhou", nivel: "erro" }));
    expect(pending.status).toBe("aguardando");
  });

  it("não tenta enviar para LID antigo se telefone real não pode ser resolvido", async () => {
    mocks.resolveChatId.mockResolvedValue(null);
    expect((await cobrar()).status).toBe(502);
    expect(mocks.sendMessageConfirmed).not.toHaveBeenCalled();
    expect(mocks.recordSystemLog).toHaveBeenCalledWith(expect.objectContaining({ evento: "cobranca_falhou" }));
  });

  it("bloqueia repetição imediata inclusive após resultado incerto", async () => {
    mocks.sendMessageConfirmed.mockRejectedValue(new Error("Timeout: confira a conversa"));
    expect((await cobrar()).status).toBe(502);
    expect((await cobrar()).status).toBe(409);
    expect(mocks.sendMessageConfirmed).toHaveBeenCalledOnce();
  });

  it("bloqueia duas requisições simultâneas para o mesmo telefone", async () => {
    let concluir!: (chat: string) => void;
    let iniciou!: () => void;
    const inicio = new Promise<void>((resolve) => { iniciou = resolve; });
    mocks.resolveChatId.mockImplementation(() => { iniciou(); return new Promise((resolve) => { concluir = resolve; }); });
    const primeiro = cobrar();
    await inicio;
    expect((await cobrar()).status).toBe(409);
    concluir("5513999999999@c.us");
    expect((await primeiro).status).toBe(200);
    expect(mocks.sendMessageConfirmed).toHaveBeenCalledOnce();
  });

  it("não cobra registro que foi respondido durante consulta do telefone", async () => {
    mocks.resolveChatId.mockImplementation(async () => { pending.status = "respondido"; return "5513999999999@c.us"; });
    expect((await cobrar()).status).toBe(400);
    expect(mocks.sendMessageConfirmed).not.toHaveBeenCalled();
  });

  it("não envia template que ficou vazio após renderização", async () => {
    mocks.renderCobranca.mockReturnValue("  ");
    expect((await cobrar()).status).toBe(502);
    expect(mocks.sendMessageConfirmed).not.toHaveBeenCalled();
  });

  it.each(["respondido", "cancelado"])("não cobra registro %s", async (status) => {
    pending.status = status;
    expect((await cobrar()).status).toBe(400);
    expect(mocks.resolveChatId).not.toHaveBeenCalled();
  });

  it("não envia se WhatsApp desconectado", async () => {
    mocks.isReady.mockReturnValue(false);
    expect((await cobrar()).status).toBe(400);
    expect(mocks.sendMessageConfirmed).not.toHaveBeenCalled();
  });
});
