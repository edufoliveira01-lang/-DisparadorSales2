import { createHash } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { garantirAdmin } from "../src/painel/auth";
import { abrirBancoPainel } from "../src/painel/banco";
import { criarAppPainel } from "../src/painel/app";
import { lerConfigPainel } from "../src/painel/config";
import { ServicoPainel } from "../src/painel/servico";
import { AsaasProvider } from "../src/painel/asaas";
import { gerarParDeChaves } from "../src/licenca/token";
import { montarExtensaoDeskcomm, TEMA_DISPARAZAP } from "../src/painel/extensaoDeskcomm";

// Mesmas formas que o DeskcommCRM aceita num valor de tema (lib/branding/formas-de-valor.ts).
const FORMAS = [/^#[0-9a-f]{3}$/i, /^#[0-9a-f]{6}$/i, /^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$/, /^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d{1,4})\s*\)$/, /^var\(--[a-z][a-z0-9-]*\)$/];
const ORIGEM = "https://painel.exemplo.com.br";

describe("extensão de tema do Deskcomm", () => {
  it("o catálogo descreve exatamente o pacote (resumo, tamanho, identidade e permissão)", () => {
    const e = montarExtensaoDeskcomm(ORIGEM);
    const catalogo = JSON.parse(e.catalogo.toString("utf8"));
    const pacote = JSON.parse(e.pacote.toString("utf8"));
    expect(e.sha256).toBe(createHash("sha256").update(e.pacote).digest("hex"));
    expect(catalogo).toMatchObject({ format_version: 1, origin: ORIGEM, revision: 1 });
    const [entrada] = catalogo.entries;
    expect(entrada).toMatchObject({ publisher: pacote.publisher, name: pacote.name, version: pacote.version, sha256: e.sha256, byte_length: e.pacote.length, permissions: ["theme.apply"], license: "MIT" });
    expect(entrada.display).toEqual(pacote.display);
    expect(e.pacote.length).toBeLessThan(64 * 1024); // teto do pacote no Deskcomm
    expect(montarExtensaoDeskcomm(ORIGEM).sha256).toBe(e.sha256); // determinístico
  });

  it("o tema só usa valores nas formas aceitas, e o escuro cobre tudo o que o claro muda (menos a rampa do acento)", () => {
    for (const mapa of [TEMA_DISPARAZAP.claro, TEMA_DISPARAZAP.escuro]) for (const [chave, valor] of Object.entries(mapa)) {
      expect(chave).toMatch(/^--color-[a-z0-9-]+$/);
      expect(FORMAS.some((f) => f.test(valor)), `${chave}: ${valor}`).toBe(true);
    }
    const semPar = Object.keys(TEMA_DISPARAZAP.claro).filter((k) => !/^--color-accent-\d+$/.test(k) && !(k in TEMA_DISPARAZAP.escuro));
    expect(semPar).toEqual([]);
    expect(TEMA_DISPARAZAP.claro["--color-bg"]).toBe("#f6f7fb"); // mesma base do DisparaZap
    expect(TEMA_DISPARAZAP.escuro["--color-bg"]).toBe("#101626");
  });
});

describe("painel serve o catálogo e o pacote do tema", () => {
  let server: Server; let db: ReturnType<typeof abrirBancoPainel>;
  afterEach(() => { server?.close(); db?.close(); });
  async function subir(urlPublica: string) {
    const cfg = lerConfigPainel({ PAINEL_BASE_DOMAIN: "disparazap.exemplo.com.br", PAINEL_PUBLIC_URL: urlPublica, PAINEL_ADMIN_PASSWORD: "senha-forte-12345" } as never);
    db = abrirBancoPainel(":memory:"); await garantirAdmin(db, cfg);
    const servico = new ServicoPainel(db, cfg, new AsaasProvider({ apiKey: "", baseUrl: "http://x" }), gerarParDeChaves().privada);
    server = criarAppPainel({ db, cfg, servico, chavePublicaPem: gerarParDeChaves().publica, versao: "test", webDir: __dirname }).listen(0);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  it("entrega o catálogo para baixar e o pacote só no endereço do próprio resumo, sem compressão", async () => {
    const base = await subir(ORIGEM);
    const esperado = montarExtensaoDeskcomm(ORIGEM);
    const cat = await fetch(`${base}/deskcomm/catalogo.json`);
    expect(cat.status).toBe(200);
    expect(cat.headers.get("content-disposition")).toMatch(/attachment; filename=/);
    expect(Buffer.from(await cat.arrayBuffer()).equals(esperado.catalogo)).toBe(true);
    const pac = await fetch(`${base}/packages/${esperado.sha256}.json`, { headers: { Accept: "application/json", "Accept-Encoding": "identity" } });
    expect(pac.status).toBe(200);
    expect(pac.headers.get("content-encoding")).toBeNull();
    const bytes = Buffer.from(await pac.arrayBuffer());
    expect(bytes.equals(esperado.pacote)).toBe(true);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(esperado.sha256);
    expect((await fetch(`${base}/packages/${"0".repeat(64)}.json`)).status).toBe(404);
    expect((await fetch(`${base}/packages/../etc.json`)).status).toBe(404);
  });

  it("sem endereço público https, não publica nada", async () => {
    const base = await subir("");
    expect((await fetch(`${base}/deskcomm/catalogo.json`)).status).toBe(404);
  });
});
