import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { authRouter } from "../src/routes/auth";
import { teamRouter } from "../src/routes/team";
import { djenRouter } from "../src/routes/djen";
import { authenticatedApi } from "../src/middleware/access";
import { hashPassword } from "../src/services/authService";

const app = express();
app.use(cookieParser(), express.json());
app.use("/api/auth", authRouter);
app.use("/api", authenticatedApi);
app.use("/api/team", teamRouter);
app.use("/api/djen", djenRouter);
app.get("/api/settings", (_req, res) => res.json({ secret: true }));
app.get("/api/contacts", (_req, res) => res.json([]));
const server = createServer(app);
const ready = new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

async function request(path: string, options: RequestInit = {}, cookie = "") {
  const url = await ready;
  return fetch(`${url}/api${path}`, { ...options, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}), ...options.headers } });
}

describe("equipe e controle de acesso", () => {
  it("cria um perfil limitado, aplica permissão na API e encerra a sessão ao desativar", async () => {
    const adminName = `owner_${Date.now()}`;
    db.prepare("INSERT INTO users (username, display_name, role, password_hash) VALUES (?, ?, 'administrador', ?)")
      .run(adminName, "Administrador de teste", hashPassword("senha-inicial-segura"));
    const adminLogin = await request("/auth/login", { method: "POST", body: JSON.stringify({ username: adminName, password: "senha-inicial-segura" }) });
    expect(adminLogin.status).toBe(200);
    const adminCookie = adminLogin.headers.get("set-cookie")!.split(";")[0];
    const username = `reader_${Date.now()}`;
    const created = await request("/team", { method: "POST", body: JSON.stringify({ username, display_name: "Pessoa consulta", role: "consulta", password: "senha-inicial-segura", permissions: ["contacts.view"] }) }, adminCookie);
    expect(created.status).toBe(201);
    const person = await created.json() as { id: number };
    const login = await request("/auth/login", { method: "POST", body: JSON.stringify({ username, password: "senha-inicial-segura" }) });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie")!.split(";")[0];
    // Senha definida pelo administrador: nada abre até a pessoa criar a própria.
    const bloqueada = await request("/contacts", {}, cookie);
    expect(bloqueada.status).toBe(403);
    expect((await bloqueada.json() as { codigo: string }).codigo).toBe("troca_de_senha_obrigatoria");
    expect(((await (await request("/auth/me", {}, cookie)).json()) as { user: { must_change_password: boolean } }).user.must_change_password).toBe(true);
    expect((await request("/auth/trocar-senha-inicial", { method: "POST", body: JSON.stringify({ currentPassword: "errada-errada-12", newPassword: "minha-senha-pessoal-1" }) }, cookie)).status).toBe(401);
    expect((await request("/auth/trocar-senha-inicial", { method: "POST", body: JSON.stringify({ currentPassword: "senha-inicial-segura", newPassword: "curta" }) }, cookie)).status).toBe(400);
    expect((await request("/auth/trocar-senha-inicial", { method: "POST", body: JSON.stringify({ currentPassword: "senha-inicial-segura", newPassword: "senha-inicial-segura" }) }, cookie)).status).toBe(400);
    expect((await request("/auth/trocar-senha-inicial", { method: "POST", body: JSON.stringify({ currentPassword: "senha-inicial-segura", newPassword: "minha-senha-pessoal-1" }) }, cookie)).status).toBe(200);
    expect((await request("/contacts", {}, cookie)).status).toBe(200);
    // a senha antiga deixa de valer; a nova entra direto, sem nova troca
    expect((await request("/auth/login", { method: "POST", body: JSON.stringify({ username, password: "senha-inicial-segura" }) })).status).toBe(401);
    expect((await request("/auth/login", { method: "POST", body: JSON.stringify({ username, password: "minha-senha-pessoal-1" }) })).status).toBe(200);
    expect((await request("/settings", {}, cookie)).status).toBe(403);
    expect((await request("/team", {}, cookie)).status).toBe(403);
    expect((await request("/djen/codex/exemplos", {}, cookie)).status).toBe(403);
    expect((await request("/djen/codex/exemplos", {}, adminCookie)).status).toBe(200);
    expect((await request("/team", {}, "")).status).toBe(401);
    const disabled = await request(`/team/${person.id}`, { method: "PUT", body: JSON.stringify({ active: false }) }, adminCookie);
    expect(disabled.status).toBe(200);
    expect((await request("/contacts", {}, cookie)).status).toBe(401);
    expect((await request("/auth/login", { method: "POST", body: JSON.stringify({ username, password: "minha-senha-pessoal-1" }) })).status).toBe(401);
  });
});
