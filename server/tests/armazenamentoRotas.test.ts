import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { authRouter } from "../src/routes/auth";
import { armazenamentoRouter, dropboxRetornoRouter } from "../src/routes/armazenamento";
import { authenticatedApi } from "../src/middleware/access";
import { hashPassword } from "../src/services/authService";

const app = express();
app.use(cookieParser(), express.json());
app.use("/api/auth", authRouter);
app.use("/api", authenticatedApi);
app.use("/api/armazenamento", armazenamentoRouter);
app.use("/api/dropbox", dropboxRetornoRouter);
const server = createServer(app);
const ready = new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const realFetch = globalThis.fetch;
async function req(path: string, method = "GET", body?: unknown, cookie = "") {
  const r = await realFetch(`${await ready}${path}`, { method, redirect: "manual", headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, location: r.headers.get("location") ?? "", json: (await r.json().catch(() => ({}))) as any };
}
async function entrar(role: string) {
  const nome = `arm_${role}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare("INSERT INTO users (username, display_name, role, permissions_json, password_hash) VALUES (?, ?, ?, ?, ?)").run(nome, `Pessoa ${nome}`, role, null, hashPassword("senha-forte-123"));
  const r = await realFetch(`${await ready}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: nome, password: "senha-forte-123" }) });
  return { cookie: (r.headers.get("set-cookie") || "").split(";")[0]!, id: (db.prepare("SELECT id FROM users WHERE username=?").get(nome) as { id: number }).id };
}

beforeEach(() => { db.exec("DELETE FROM armazenamento_estados; DELETE FROM armazenamento_config;"); });
afterEach(() => { vi.unstubAllGlobals(); });

describe("permissões", () => {
  it("sem sessão: 401; quem não gerencia a equipe: 403; administrador entra", async () => {
    expect((await req("/api/armazenamento/dropbox")).status).toBe(401);
    for (const papel of ["atendimento", "consulta", "advogado"]) {
      const { cookie } = await entrar(papel);
      expect((await req("/api/armazenamento/dropbox", "GET", undefined, cookie)).status, papel).toBe(403);
      expect((await req("/api/armazenamento/dropbox/credenciais", "PUT", { appKey: "appkey1234", appSecret: "segredo-1234" }, cookie)).status, papel).toBe(403);
      expect((await req("/api/dropbox/retorno?code=x&state=y", "GET", undefined, cookie)).status, papel).toBe(403);
    }
    const { cookie } = await entrar("administrador");
    expect((await req("/api/armazenamento/dropbox", "GET", undefined, cookie)).status).toBe(200);
  });
});

describe("conexão pela tela", () => {
  it("salvar as credenciais não devolve a secret; o endereço de retorno que o dono cadastra aparece na tela", async () => {
    const { cookie } = await entrar("administrador");
    const r = await req("/api/armazenamento/dropbox/credenciais", "PUT", { appKey: "appkey1234", appSecret: "segredo-do-app-9" }, cookie);
    expect(r.status).toBe(200);
    expect(JSON.stringify(r.json)).not.toContain("segredo-do-app-9");
    const s = await req("/api/armazenamento/dropbox", "GET", undefined, cookie);
    expect(s.json).toMatchObject({ credenciais_salvas: true, conectado: false, pasta_raiz: "/CLIENTES" });
    expect(s.json.redirect_uri).toMatch(/^https?:\/\/.+\/api\/dropbox\/retorno$/);
    expect(JSON.stringify(s.json)).not.toContain("segredo-do-app-9");
  });

  it("conectar sem credenciais volta para Configurações com o motivo; com credenciais vai ao Dropbox com acesso offline e state", async () => {
    const { cookie } = await entrar("administrador");
    const sem = await req("/api/armazenamento/dropbox/conectar", "GET", undefined, cookie);
    expect(sem.status).toBe(302);
    expect(sem.location).toMatch(/^\/configuracoes\?secao=dropbox&dropbox=error&message=/);
    await req("/api/armazenamento/dropbox/credenciais", "PUT", { appKey: "appkey1234", appSecret: "segredo-do-app-9" }, cookie);
    const ok = await req("/api/armazenamento/dropbox/conectar", "GET", undefined, cookie);
    expect(ok.status).toBe(302);
    const u = new URL(ok.location);
    expect(u.origin + u.pathname).toBe("https://www.dropbox.com/oauth2/authorize");
    expect(u.searchParams.get("client_id")).toBe("appkey1234");
    expect(u.searchParams.get("token_access_type")).toBe("offline");
    expect(u.searchParams.get("redirect_uri")).toMatch(/\/api\/dropbox\/retorno$/);
    expect(u.searchParams.get("state")).toMatch(/^[0-9a-f]{48}$/);
  });

  it("o retorno do Dropbox: troca o código, confere a conta e guarda a conexão; o state só vale uma vez", async () => {
    const { cookie } = await entrar("administrador");
    await req("/api/armazenamento/dropbox/credenciais", "PUT", { appKey: "appkey1234", appSecret: "segredo-do-app-9" }, cookie);
    const state = new URL((await req("/api/armazenamento/dropbox/conectar", "GET", undefined, cookie)).location).searchParams.get("state")!;

    vi.stubGlobal("fetch", vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.startsWith("http://127.0.0.1")) return realFetch(url, init);
      if (/oauth2\/token/.test(u)) return new Response(JSON.stringify({ access_token: "a", refresh_token: "R-TOKEN", expires_in: 14400, account_id: "dbid:1" }));
      if (/get_current_account/.test(u)) return new Response(JSON.stringify({ account_id: "dbid:1", name: { display_name: "Sales e Associados" }, email: "e@x.com", account_type: { ".tag": "pro" }, root_info: { root_namespace_id: "1", home_namespace_id: "1" } }));
      throw new Error(`rede inesperada: ${u}`);
    }));

    const r = await req(`/api/dropbox/retorno?code=abc&state=${state}`, "GET", undefined, cookie);
    expect(r.status).toBe(302);
    expect(r.location).toBe("/configuracoes?secao=dropbox&dropbox=connected");
    const s = await req("/api/armazenamento/dropbox", "GET", undefined, cookie);
    expect(s.json).toMatchObject({ conectado: true, conta: { nome: "Sales e Associados", tipo: "pro", equipe: false } });
    expect(JSON.stringify(s.json)).not.toContain("R-TOKEN");

    const reuso = await req(`/api/dropbox/retorno?code=abc&state=${state}`, "GET", undefined, cookie);
    expect(reuso.location).toMatch(/dropbox=error&message=.*expirou/);
  });

  it("retorno com state de OUTRA pessoa, state inventado ou autorização cancelada: volta com erro e não conecta", async () => {
    const a = await entrar("administrador"); const b = await entrar("administrador");
    await req("/api/armazenamento/dropbox/credenciais", "PUT", { appKey: "appkey1234", appSecret: "segredo-do-app-9" }, a.cookie);
    const state = new URL((await req("/api/armazenamento/dropbox/conectar", "GET", undefined, a.cookie)).location).searchParams.get("state")!;
    expect((await req(`/api/dropbox/retorno?code=abc&state=${state}`, "GET", undefined, b.cookie)).location).toMatch(/dropbox=error/);
    expect((await req("/api/dropbox/retorno?code=abc&state=inventado", "GET", undefined, a.cookie)).location).toMatch(/dropbox=error/);
    expect((await req("/api/dropbox/retorno?error=access_denied", "GET", undefined, a.cookie)).location).toMatch(/dropbox=error&message=.*cancelada/);
    expect((await req("/api/armazenamento/dropbox", "GET", undefined, a.cookie)).json.conectado).toBe(false);
  });

  it("desconectar apaga o acesso", async () => {
    const { cookie } = await entrar("administrador");
    await req("/api/armazenamento/dropbox/credenciais", "PUT", { appKey: "appkey1234", appSecret: "segredo-do-app-9" }, cookie);
    const r = await req("/api/armazenamento/dropbox", "DELETE", undefined, cookie);
    expect(r.json).toMatchObject({ conectado: false, credenciais_salvas: true });
  });

  it("sem conexão, as ações que falam com o Dropbox explicam em vez de quebrar", async () => {
    const { cookie } = await entrar("administrador");
    for (const [metodo, caminho, corpo] of [["POST", "/api/armazenamento/dropbox/testar", undefined], ["GET", "/api/armazenamento/pastas", undefined], ["GET", "/api/armazenamento/sugestoes", undefined], ["POST", "/api/armazenamento/vincular", { pessoa_id: 1, pasta_id: "id:1" }]] as const) {
      const r = await req(caminho, metodo, corpo, cookie);
      expect(r.status, caminho).toBe(409);
      expect(r.json.error, caminho).toMatch(/ainda não está conectado/);
    }
    // entrada inválida é 400 (antes mesmo de olhar a conexão)
    expect((await req("/api/armazenamento/vincular", "POST", { pessoa_id: "x" }, cookie)).status).toBe(400);
  });
});
