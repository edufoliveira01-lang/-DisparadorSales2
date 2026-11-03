import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { ClienteLicenca, lerConfigLicenca, definirLicencaParaTestes, mensagemSeExcederLimite, licencaPermiteOperar, recursoLiberadoNaLicenca } from "../src/licenca/cliente";
import { assinarLicenca, gerarParDeChaves, type CargaLicenca } from "../src/licenca/token";
import { licencaSomenteLeitura } from "../src/middleware/licenca";
import { licenseRouter } from "../src/routes/license";

const par = gerarParDeChaves();
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dz-licenca-"));
const arquivo = (n: string) => path.join(dir, `${n}.json`);
const carga = (o: Partial<CargaLicenca> = {}, agora = new Date("2026-12-01T12:00:00Z")): CargaLicenca => ({
  v: 1, escritorio_id: "off_1", slug: "sales", nome: "Sales", plano: "escritorio", status: "ativa", entitlements: {},
  vence_em: "2026-12-31T23:59:59-03:00", carencia_ate: "2027-01-07T23:59:59-03:00", emitida_em: agora.toISOString(),
  valido_ate: new Date(agora.getTime() + 72 * 3_600_000).toISOString(), tolerancia_offline_dias: 14, ...o,
});
const cfg = (n: string, extra = {}) => ({ urlServidor: "https://painel.exemplo", chave: "dz_chave_de_teste_1234567890", chavePublicaPem: par.publica, escritorioId: "sales", arquivo: arquivo(n), versao: "2.61.0", intervaloMs: 1000, intervaloRestritoMs: 500, carenciaInicialDias: 3, ...extra });
const resposta = (c: CargaLicenca) => (async () => new Response(JSON.stringify({ token: assinarLicenca(c, par.privada) }), { status: 200 })) as unknown as typeof fetch;

afterEach(() => definirLicencaParaTestes(null));

describe("configuração da licença", () => {
  it("sem variáveis = modo próprio (sem verificação, limites ou bloqueios)", () => {
    expect(lerConfigLicenca({}, dir)).toBeNull();
    const c = new ClienteLicenca(null);
    expect(c.estado()).toMatchObject({ modo: "proprio", status: "ativa", restrito: false, aviso: null });
    expect(c.estado().entitlements.max_usuarios).toBeNull();
  });
  it("configuração parcial é recusada; completa aceita chave em base64", () => {
    expect(() => lerConfigLicenca({ LICENSE_KEY: "x" }, dir)).toThrow(/incompleta/);
    const ok = lerConfigLicenca({ LICENSE_SERVER_URL: "https://p.exemplo/", LICENSE_KEY: "dz_abc", LICENSE_PUBLIC_KEY_B64: Buffer.from(par.publica).toString("base64"), OFFICE_ID: "sales" }, dir, "1");
    expect(ok).toMatchObject({ urlServidor: "https://p.exemplo", escritorioId: "sales" });
  });
});

describe("cliente de licença", () => {
  it("busca a licença, guarda em disco e a reutiliza sem rede", async () => {
    const c = new ClienteLicenca(cfg("a"), resposta(carga()), () => new Date("2026-12-01T12:00:00Z"));
    expect(await c.verificar()).toBe(true);
    expect(c.estado()).toMatchObject({ modo: "licenciado", status: "ativa", restrito: false, plano: "escritorio" });
    const offline = new ClienteLicenca(cfg("a"), (async () => { throw new Error("sem rede"); }) as unknown as typeof fetch, () => new Date("2026-12-02T12:00:00Z"));
    expect(offline.estado()).toMatchObject({ status: "ativa", restrito: false }); // lida do disco
    expect(await offline.verificar()).toBe(false);
    expect(offline.estado().restrito).toBe(false);
  });
  it("recusa licença de outro escritório, assinatura inválida e chave revogada", async () => {
    const outro = new ClienteLicenca(cfg("b"), resposta(carga({ slug: "outro" })));
    expect(await outro.verificar()).toBe(false);
    const falsa = new ClienteLicenca(cfg("c"), (async () => new Response(JSON.stringify({ token: assinarLicenca(carga(), gerarParDeChaves().privada) }), { status: 200 })) as unknown as typeof fetch);
    expect(await falsa.verificar()).toBe(false);
    const revogada = new ClienteLicenca(cfg("d"), (async () => new Response("{}", { status: 401 })) as unknown as typeof fetch);
    expect(await revogada.verificar()).toBe(false);
    expect(revogada.estado().aviso).toMatch(/revogada|inválida/);
  });
  it("primeira instalação sem painel: carência inicial e depois restrição", () => {
    let agora = new Date("2026-12-01T12:00:00Z");
    const c = new ClienteLicenca(cfg("e"), (async () => { throw new Error("x"); }) as unknown as typeof fetch, () => agora);
    expect(c.estado()).toMatchObject({ status: "sem_contato", restrito: false });
    agora = new Date("2026-12-05T12:00:00Z");
    expect(c.estado().restrito).toBe(true);
  });
  it("vencimento: carência sem bloqueio e depois somente leitura, mesmo sem contato", async () => {
    let agora = new Date("2026-12-01T12:00:00Z");
    const c = new ClienteLicenca(cfg("f"), resposta(carga({ valido_ate: "2027-06-01T00:00:00Z" })), () => agora);
    await c.verificar();
    agora = new Date("2027-01-03T12:00:00Z"); expect(c.estado()).toMatchObject({ status: "carencia", restrito: false });
    agora = new Date("2027-01-10T12:00:00Z"); expect(c.estado()).toMatchObject({ status: "suspensa", restrito: true });
  });
  it("configuração inválida restringe com explicação (não libera nem derruba)", () => {
    const c = new ClienteLicenca(null, fetch, () => new Date(), "Licença incompleta: defina LICENSE_KEY.");
    expect(c.estado()).toMatchObject({ restrito: true, aviso: expect.stringContaining("incompleta") });
  });
});

describe("limites do plano e rotinas", () => {
  it("limites vêm da licença; ilimitado por padrão; IA pode ser desligada", async () => {
    expect(mensagemSeExcederLimite("max_usuarios", 500)).toBeNull(); // modo próprio
    const c = new ClienteLicenca(cfg("g"), resposta(carga({ entitlements: { max_usuarios: 3, max_advogados: null, ia_habilitada: false } })));
    await c.verificar(); definirLicencaParaTestes(c);
    expect(mensagemSeExcederLimite("max_usuarios", 2)).toBeNull();
    expect(mensagemSeExcederLimite("max_usuarios", 3)).toMatch(/até 3/);
    expect(mensagemSeExcederLimite("max_advogados", 999)).toBeNull();
    expect(recursoLiberadoNaLicenca("ia_habilitada")).toBe(false);
    expect(licencaPermiteOperar()).toBe(true);
  });
  it("licença suspensa impede rotinas automáticas", async () => {
    const c = new ClienteLicenca(cfg("h"), resposta(carga({ status: "suspensa" })));
    await c.verificar(); definirLicencaParaTestes(c);
    expect(licencaPermiteOperar()).toBe(false);
  });
});

describe("middleware somente leitura e rota de status", () => {
  const subir = async (c: ClienteLicenca) => {
    definirLicencaParaTestes(c);
    const app = express(); app.use(express.json());
    app.post("/api/auth/login", (_q, r) => { r.json({ ok: true }); });
    app.use("/api", licencaSomenteLeitura);
    app.use("/api/license", licenseRouter);
    app.get("/api/dados", (_q, r) => { r.json({ ok: true }); });
    app.post("/api/dados", (_q, r) => { r.json({ ok: true }); });
    app.get("/api/backup/exportar", (_q, r) => { r.json({ ok: true }); });
    const srv = app.listen(0);
    return { srv, base: `http://127.0.0.1:${(srv.address() as AddressInfo).port}` };
  };
  it("restrito: leitura, exportação, login e status passam; escrita recebe 402", async () => {
    const c = new ClienteLicenca(cfg("i"), resposta(carga({ status: "suspensa" })));
    await c.verificar();
    const { srv, base } = await subir(c);
    try {
      expect((await fetch(`${base}/api/dados`)).status).toBe(200);
      expect((await fetch(`${base}/api/backup/exportar`)).status).toBe(200);
      expect((await fetch(`${base}/api/auth/login`, { method: "POST" })).status).toBe(200);
      const bloqueada = await fetch(`${base}/api/dados`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      expect(bloqueada.status).toBe(402);
      expect(await bloqueada.json()).toMatchObject({ codigo: "licenca_restrita" });
      const st = await (await fetch(`${base}/api/license/status`)).json() as Record<string, unknown>;
      expect(st).toMatchObject({ modo: "licenciado", status: "suspensa", restrito: true });
      expect(JSON.stringify(st)).not.toContain("dz_chave");
    } finally { srv.close(); }
  });
  it("em dia ou em modo próprio nada é bloqueado", async () => {
    for (const c of [new ClienteLicenca(null), (() => { const x = new ClienteLicenca(cfg("j"), resposta(carga())); return x; })()]) {
      if (c.estado().modo === "licenciado") await c.verificar();
      const { srv, base } = await subir(c);
      try { expect((await fetch(`${base}/api/dados`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status).toBe(200); }
      finally { srv.close(); }
    }
  });
});
