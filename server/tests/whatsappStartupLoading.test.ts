import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Client } from "whatsapp-web.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureWhatsappStartupPage, prepareWhatsappVersion } from "../src/services/whatsappStartup";

let directory: string;
const source = { type: "remote" as const, remotePath: "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.3000.1234567890.html" };
beforeEach(() => { directory = fs.mkdtempSync(path.join(os.tmpdir(), "whatsapp-startup-")); });
afterEach(() => { fs.rmSync(directory, { recursive: true, force: true }); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("carregamento anterior ao QR Code", () => {
  it("limita um arquivo remoto que nunca responde e segue diretamente para o WhatsApp", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetcher);
    const stage = vi.fn();
    const pending = prepareWhatsappVersion(source, directory, stage);
    await vi.advanceTimersByTimeAsync(8001);
    expect(await pending).toEqual({ webVersionCache: { type: "none" } });
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(stage).toHaveBeenLastCalledWith("Versão alternativa indisponível; abrindo WhatsApp Web");
  });
  it("limita também o corpo do download, depois de receber os cabeçalhos", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, text: () => new Promise(() => {}) })));
    const pending = prepareWhatsappVersion(source, directory, vi.fn());
    await vi.advanceTimersByTimeAsync(8001);
    expect(await pending).toEqual({ webVersionCache: { type: "none" } });
  });
  it("entrega uma versão local exata à biblioteca e reaproveita o arquivo validado", async () => {
    const fetcher = vi.fn(async () => new Response("<!doctype html><html>WhatsApp Web</html>"));
    vi.stubGlobal("fetch", fetcher);
    const first = await prepareWhatsappVersion(source, directory, vi.fn());
    expect(first).toEqual({ webVersion: "2.3000.1234567890", webVersionCache: { type: "local", path: directory, strict: true } });
    expect(fs.readFileSync(path.join(directory, "2.3000.1234567890.html"), "utf8")).toContain("WhatsApp");
    expect(await prepareWhatsappVersion(source, directory, vi.fn())).toEqual(first);
    expect(fetcher).toHaveBeenCalledOnce();
  });
  it("não injeta página de erro nem trava se o arquivo foi removido", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Not found", { status: 404 })));
    expect(await prepareWhatsappVersion(source, directory, vi.fn())).toEqual({ webVersionCache: { type: "none" } });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>Gateway error</html>")));
    expect(await prepareWhatsappVersion(source, directory, vi.fn())).toEqual({ webVersionCache: { type: "none" } });
    expect(fs.readdirSync(directory)).toEqual([]);
  });
  it("inicia a injeção após o documento carregar, sem esperar todos os recursos", async () => {
    const goto = vi.fn(async () => null);
    const page = { goto, on: vi.fn() };
    const stage = vi.fn();
    configureWhatsappStartupPage(page as unknown as NonNullable<Client["pupPage"]>, stage);
    await page.goto("https://web.whatsapp.com/", { waitUntil: "load", timeout: 0 });
    expect(goto).toHaveBeenCalledWith("https://web.whatsapp.com/", { waitUntil: "domcontentloaded", timeout: 45000 });
    expect(stage).toHaveBeenCalledWith("Abrindo a página do WhatsApp Web");
    const onDocument = page.on.mock.calls.find(call => call[0] === "domcontentloaded")![1];
    onDocument();
    expect(stage).toHaveBeenLastCalledWith("Preparando o vínculo e o QR Code");
  });
  it("informa a etapa quando a navegação falha e mantém outras URLs inalteradas", async () => {
    const goto = vi.fn().mockRejectedValueOnce(new Error("net::ERR_TIMED_OUT")).mockResolvedValue(null);
    const page = { goto, on: vi.fn() };
    configureWhatsappStartupPage(page as unknown as NonNullable<Client["pupPage"]>, vi.fn());
    await expect(page.goto("https://web.whatsapp.com/")).rejects.toThrow(/abrir a página.*45 segundos.*ERR_TIMED_OUT/);
    await page.goto("https://example.org/", { timeout: 500 });
    expect(goto).toHaveBeenLastCalledWith("https://example.org/", { timeout: 500 });
  });
});
