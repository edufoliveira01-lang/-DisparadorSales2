import { createServer, request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ executing: 0 }));
vi.mock("../src/services/djen/codexAnalysis", () => ({ statusAnalisesCodex: () => ({ execucoes_simultaneas: mocks.executing }) }));
import { db } from "../src/db";
import { createSession } from "../src/services/authService";
import { authenticatedApi } from "../src/middleware/access";
import { aiRouter } from "../src/routes/ai";

const app = express(); app.use(express.json(), cookieParser()); app.use("/api", authenticatedApi); app.use("/api/ai", aiRouter);
const server = createServer(app);
const ready = new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/ai`)));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
let adminCookie = ""; let readerCookie = "";
beforeEach(() => {
  mocks.executing = 0; db.prepare("DELETE FROM settings WHERE chave LIKE 'ai_%'").run();
  vi.stubEnv("ENCRYPTION_KEY", "test-only-long-encryption-key-more-than-32");
  const admin = db.prepare("SELECT id FROM users WHERE role='administrador' LIMIT 1").get() as { id: number };
  const info = db.prepare("INSERT INTO users(username,display_name,role,password_hash) VALUES (?,'Test reader','consulta','unused')").run(`aireader_${Date.now()}_${Math.random()}`);
  adminCookie = `session_id=${createSession(admin.id)}`; readerCookie = `session_id=${createSession(Number(info.lastInsertRowid))}`;
});
afterEach(() => { vi.unstubAllEnvs(); db.prepare("DELETE FROM settings WHERE chave LIKE 'ai_%'").run(); db.prepare("UPDATE djen_config SET ia_pausa=NULL WHERE id=1").run(); });
async function request(path: string, method = "GET", data?: unknown, cookie = adminCookie) {
  return fetch(`${await ready}${path}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: data ? JSON.stringify(data) : undefined });
}
// node:http preserva o Host do proxy; o fetch do Node o substitui pelo destino.
async function proxyRequest(path: string, headers: Record<string, string>, method = "GET", data?: unknown): Promise<Response> {
  const url = `${await ready}${path}`;
  return new Promise((resolve, reject) => {
    const req = httpRequest(url, { method, headers }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => { body += chunk; });
      res.on("end", () => resolve(new Response(body, { status: res.statusCode })));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.end(data === undefined ? undefined : JSON.stringify(data));
  });
}
const input = { provider: "openai", models: { economico: "test-model", equilibrado: "test-model", precisao: "test-model" }, api_key: "never-expose-this-test-key" };

describe("API administrativa da central de IA", () => {
  it.each(["/config", "/chatgpt/status"])("protege %s por sessão e permissão de integrações", async (path) => {
    expect((await request(path, "GET", undefined, "")).status).toBe(401);
    expect((await request(path, "GET", undefined, readerCookie)).status).toBe(403);
  });
  it("recusa origens externas mesmo quando há uma sessão válida", async () => {
    const response = await fetch(`${await ready}/config`, { headers: { Cookie: adminCookie, Origin: "https://evil.invalid" } });
    expect(response.status).toBe(403);
    const local = await fetch(`${await ready}/config`, { headers: { Cookie: adminCookie, Origin: new URL(await ready).origin } });
    expect(local.status).toBe(200);
  });
  it("aceita leitura e alteração pelo HTTPS do painel atrás do Nginx", async () => {
    vi.stubEnv("APP_URL", "http://localhost:8081");
    const headers = { Cookie: adminCookie, Host: "disparazap.saleseassociados.com.br", Origin: "https://disparazap.saleseassociados.com.br", "Content-Type": "application/json" };
    expect((await proxyRequest("/config", headers)).status).toBe(200);
    const saved = await proxyRequest("/config", headers, "PUT", input);
    expect(saved.status).toBe(200);
    expect((await saved.json()).provider).toBe("openai");
  });
  it.each(["https://evil.invalid", "https://disparazap.saleseassociados.com.br.evil.invalid", "https://disparazap.saleseassociados.com.br:444", "null"])("recusa %s mesmo com headers encaminhados forjados", async (origin) => {
    vi.stubEnv("APP_URL", "http://localhost:8081");
    const response = await proxyRequest("/config", { Cookie: adminCookie, Host: "disparazap.saleseassociados.com.br", Origin: origin, "X-Forwarded-Host": "evil.invalid", "X-Forwarded-Proto": "https", "Content-Type": "application/json" }, "PUT", input);
    expect(response.status).toBe(403);
    expect(db.prepare("SELECT 1 FROM settings WHERE chave='ai_openai_api_key'").get()).toBeUndefined();
  });
  it("aceita a origem pública explícita quando o proxy usa um Host interno", async () => {
    vi.stubEnv("APP_URL", "https://painel.example/path");
    expect((await proxyRequest("/config", { Cookie: adminCookie, Host: "localhost:3333", Origin: "https://painel.example" })).status).toBe(200);
  });
  it("salva modelos e criptografa a chave sem devolvê-la na configuração nem na auditoria", async () => {
    const saved = await request("/config", "PUT", input); expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(input.api_key);
    const config = await request("/config"); expect(await config.text()).not.toContain(input.api_key);
    const logs = db.prepare("SELECT details_json FROM access_audit WHERE action='ia_configurada' ORDER BY id DESC LIMIT 1").get();
    expect(JSON.stringify(logs)).not.toContain(input.api_key);
  });
  it("não troca a conexão durante análises em andamento", async () => {
    mocks.executing = 1;
    expect((await request("/config", "PUT", input)).status).toBe(409);
    expect(db.prepare("SELECT 1 FROM settings WHERE chave='ai_openai_api_key'").get()).toBeUndefined();
  });
  it("permite remover a chave ativa e mantém a fila pausada", async () => {
    await request("/config", "PUT", input);
    expect((await request("/credentials/openai", "DELETE")).status).toBe(200);
    expect(db.prepare("SELECT 1 FROM settings WHERE chave='ai_openai_api_key'").get()).toBeUndefined();
    expect(db.prepare("SELECT ia_pausa FROM djen_config WHERE id=1").get()).toMatchObject({ ia_pausa: expect.stringContaining("removida") });
  });
  it("recusa provedores arbitrários antes de enviar credenciais para fora", async () => {
    expect((await request("/models", "POST", { provider: "https://evil.invalid", api_key: input.api_key })).status).toBe(400);
    expect((await request("/test", "POST", { provider: "unknown", model: "test-model", api_key: input.api_key })).status).toBe(400);
  });
});
