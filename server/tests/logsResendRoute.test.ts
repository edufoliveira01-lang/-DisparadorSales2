import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getLog: vi.fn(), resendStoredInformation: vi.fn(),
}));

vi.mock("../src/services/logsService", () => ({
  getLog: mocks.getLog, listLogs: vi.fn(), deleteLog: vi.fn(), deleteLogs: vi.fn(),
}));
vi.mock("../src/services/informationResendService", () => ({ resendStoredInformation: mocks.resendStoredInformation }));
vi.mock("../src/services/dispatchService", () => ({ dispatchSingle: vi.fn() }));

import { logsRouter } from "../src/routes/logs";

let server: Server;
let baseUrl: string;
let sequence = 0;
let log: Record<string, unknown>;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use("/logs", logsRouter);
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
  log = { id: 1, card_nome: "CLIENTE TESTE", telefone: `(13) 99999-${String(++sequence).padStart(4, "0")}`,
    mensagem_enviada: "Informações originais", tipo_envio: "disparo" };
  mocks.getLog.mockReturnValue(log);
  mocks.resendStoredInformation.mockResolvedValue({ id: 2, ...log, tipo_envio: "reenvio" });
});

async function reenviar() {
  const response = await fetch(`${baseUrl}/logs/1/reenviar-informacoes`, { method: "POST" });
  return { status: response.status, body: await response.json() };
}

describe("rota de reenvio de informações", () => {
  it("reenvia o registro exato e retorna o novo log", async () => {
    const response = await reenviar();
    expect(response.status).toBe(200);
    expect(response.body.log.tipo_envio).toBe("reenvio");
    expect(mocks.resendStoredInformation).toHaveBeenCalledOnce();
    expect(mocks.resendStoredInformation).toHaveBeenCalledWith(log);
  });

  it("bloqueia clique repetido por 30 segundos", async () => {
    expect((await reenviar()).status).toBe(200);
    expect((await reenviar()).status).toBe(409);
    expect(mocks.resendStoredInformation).toHaveBeenCalledOnce();
  });

  it("bloqueia requisições simultâneas para o mesmo telefone", async () => {
    let concluir!: (valor: unknown) => void;
    let iniciou!: () => void;
    const inicio = new Promise<void>((resolve) => { iniciou = resolve; });
    mocks.resendStoredInformation.mockImplementation(() => { iniciou(); return new Promise((resolve) => { concluir = resolve; }); });
    const primeiro = reenviar();
    await inicio;
    expect((await reenviar()).status).toBe(409);
    concluir({ id: 2, ...log, tipo_envio: "reenvio" });
    expect((await primeiro).status).toBe(200);
  });

  it.each([
    [undefined, 404],
    [{ ...log, telefone: null }, 400],
    [{ ...log, mensagem_enviada: null }, 400],
    [{ ...log, tipo_envio: "lembrete" }, 400],
  ])("recusa registro incompatível %#", async (registro, status) => {
    mocks.getLog.mockReturnValue(registro);
    expect((await reenviar()).status).toBe(status);
    expect(mocks.resendStoredInformation).not.toHaveBeenCalled();
  });

  it("propaga falha sem transformar em sucesso", async () => {
    mocks.resendStoredInformation.mockRejectedValue(new Error("Envio não confirmado"));
    const response = await reenviar();
    expect(response.status).toBe(502);
    expect(response.body.error).toBe("Envio não confirmado");
  });
});
