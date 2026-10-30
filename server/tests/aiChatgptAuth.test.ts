import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ spawn: vi.fn(), children: [] as any[], invalidUrl: false, autoComplete: false }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
import { cancelChatgptLogin, chatgptLoginBusy, chatgptLoginStatus, disconnectChatgpt, listChatgptModels, startChatgptLogin, stopChatgptAuth } from "../src/services/ai/chatgptAuth";

import { createSession, deleteSession } from "../src/services/authService";
let sessionId = "";

beforeEach(() => {
  vi.useFakeTimers();
  sessionId = createSession(1); vi.stubEnv("AI_DEPLOYMENT_MODE", "local"); mocks.children.length = 0; mocks.invalidUrl = false; mocks.autoComplete = false;
  mocks.spawn.mockImplementation(() => {
    const child = new EventEmitter() as any;
    child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.exitCode = null; child.signalCode = null;
    child.kill = vi.fn(() => { child.signalCode = "SIGTERM"; queueMicrotask(() => child.emit("close", 0)); return true; });
    child.requests = [];
    child.stdin.on("data", (buffer: Buffer) => {
      for (const line of buffer.toString().trim().split("\n")) {
        const request = JSON.parse(line); child.requests.push(request); if (!request.id) continue;
        let result: unknown = {};
        if (request.method === "account/login/start") result = { type: "chatgptDeviceCode", loginId: "login-official", verificationUrl: mocks.invalidUrl ? "https://evil.invalid/device" : "https://auth.openai.com/codex/device", userCode: "ABCD-1234" };
        if (request.method === "model/list") result = { data: [{ id: "test", model: "test-model", displayName: "Test model" }] };
        queueMicrotask(() => {
          if (request.method === "account/login/start" && mocks.autoComplete) child.stdout.write(JSON.stringify({ method: "account/login/completed", params: { loginId: "login-official", success: true } }) + "\n");
          child.stdout.write(JSON.stringify({ id: request.id, result }) + "\n");
        });
      }
    });
    mocks.children.push(child); return child;
  });
});
afterEach(() => { stopChatgptAuth(); vi.restoreAllMocks(); vi.unstubAllEnvs(); vi.useRealTimers(); });

describe("autorização oficial da conta ChatGPT no painel", () => {
  it("inicializa o protocolo e retorna somente código e URL oficiais ao dono da tentativa", async () => {
    const status = await startChatgptLogin(1, sessionId);
    expect(status).toMatchObject({ state: "waiting", user_code: "ABCD-1234", verification_url: "https://auth.openai.com/codex/device" });
    const child = mocks.children[0];
    expect(child.requests.map((r: any) => r.method)).toEqual(["initialize", "initialized", "account/login/start"]);
    expect(child.requests[2].params).toEqual({ type: "chatgptDeviceCode" });
    expect(JSON.stringify(chatgptLoginStatus(2))).not.toMatch(/ABCD|verification_url|login-official/);
    await expect(startChatgptLogin(1, sessionId)).rejects.toThrow(/andamento/);
    expect(mocks.spawn.mock.calls[0][2]).toMatchObject({ shell: false });
  });
  it("cancela apenas a tentativa correta, remove o código e encerra o processo", async () => {
    const state = await startChatgptLogin(1, sessionId) as { id: string };
    await expect(cancelChatgptLogin(2, state.id)).rejects.toThrow();
    await expect(cancelChatgptLogin(1, "wrong-id")).rejects.toThrow();
    const cancelled = await cancelChatgptLogin(1, state.id);
    expect(cancelled).toMatchObject({ state: "cancelled" }); expect(JSON.stringify(cancelled)).not.toContain("ABCD");
    expect(mocks.children[0].kill).toHaveBeenCalledWith("SIGTERM"); expect(chatgptLoginBusy()).toBe(false);
  });
  it("confirma a conexão por notificação e aceita notificação que chega antes da resposta inicial", async () => {
    mocks.autoComplete = true;
    const status = await startChatgptLogin(1, sessionId);
    expect(status.state).toBe("completed"); expect(JSON.stringify(status)).not.toContain("ABCD");
    expect(chatgptLoginBusy()).toBe(false);
  });
  it("expira a autorização e apaga o código da resposta", async () => {
    await startChatgptLogin(1, sessionId);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(chatgptLoginStatus(1)).toMatchObject({ state: "failed", message: expect.stringContaining("expirou") });
    expect(JSON.stringify(chatgptLoginStatus(1))).not.toContain("ABCD");
  });
  it("rejeita URLs fora da autorização oficial", async () => {
    mocks.invalidUrl = true;
    await expect(startChatgptLogin(1, sessionId)).rejects.toThrow(/oficial/);
    expect(chatgptLoginBusy()).toBe(false);
  });
  it("bloqueia o login tradicional em instalação hospedada sem iniciar processo", async () => {
    vi.stubEnv("AI_DEPLOYMENT_MODE", "hosted");
    await expect(startChatgptLogin(1, sessionId)).rejects.toThrow(/hospedado/);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("libera a conexão após falha ao iniciar o processo", async () => {
    mocks.spawn.mockImplementationOnce(() => { throw new Error("spawn failure"); });
    await expect(startChatgptLogin(1, sessionId)).rejects.toThrow(/não pôde/);
    expect(chatgptLoginBusy()).toBe(false);
    await expect(startChatgptLogin(1, sessionId)).resolves.toMatchObject({ state: "waiting" });
  });
  it("não bloqueia a fila indefinidamente se falhar ao iniciar a desconexão", async () => {
    mocks.spawn.mockImplementationOnce(() => { throw new Error("spawn failure"); });
    await expect(disconnectChatgpt()).rejects.toThrow();
    expect(chatgptLoginBusy()).toBe(false);
  });
  it("interrompe a tentativa quando a sessão é encerrada e não expõe mais o código", async () => {
    await startChatgptLogin(1, sessionId);
    deleteSession(sessionId);
    await vi.advanceTimersByTimeAsync(5001);
    expect(chatgptLoginStatus(1)).toMatchObject({ state: "failed" });
    expect(JSON.stringify(chatgptLoginStatus(1))).not.toContain("ABCD");
    expect(chatgptLoginBusy()).toBe(false);
  });
  it("desfaz uma conclusão tardia de uma sessão revogada", async () => {
    await startChatgptLogin(1, sessionId);
    deleteSession(sessionId);
    mocks.children[0].stdout.write(JSON.stringify({ method: "account/login/completed", params: { loginId: "login-official", success: true } }) + "\n");
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.children[0].requests.map((r: any) => r.method)).toContain("account/logout");
    expect(chatgptLoginStatus(1)).toMatchObject({ state: "failed" });
    expect(chatgptLoginBusy()).toBe(false);
  });
  it("não inicia autorização para sessão inexistente ou de outro usuário", async () => {
    await expect(startChatgptLogin(1, "unknown-session")).rejects.toThrow(/sessão/);
    await expect(startChatgptLogin(2, sessionId)).rejects.toThrow(/sessão/);
    expect(mocks.spawn).not.toHaveBeenCalled();
  });
  it("consulta modelos e desconecta por comandos oficiais, encerrando os processos auxiliares", async () => {
    expect(await listChatgptModels()).toEqual([{ id: "test-model", name: "Test model" }]);
    expect(await disconnectChatgpt()).toEqual({ ok: true });
    expect(mocks.children[1].requests.map((r: any) => r.method)).toContain("account/logout");
    expect(mocks.children.every((c) => c.kill.mock.calls.length > 0)).toBe(true);
  });
});
