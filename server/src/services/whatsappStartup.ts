import fs from "node:fs";
import path from "node:path";
import type { Client } from "whatsapp-web.js";

type Page = NonNullable<Client["pupPage"]>;
type VersionSource = { type: "remote"; remotePath: string } | { type: "none" };
type PreparedVersion = {
  webVersion?: string;
  webVersionCache: { type: "local"; path: string; strict: true } | { type: "none" };
};
const HTML_TIMEOUT_MS = 8000;
export const WHATSAPP_NAVIGATION_TIMEOUT_MS = 45000;
const isWhatsappHtml = (html: string) => /<!doctype html|<html/i.test(html) && /whatsapp/i.test(html);

/** RemoteWebCache in the pinned library has no fetch deadline. Fetch once here and give
 * the library a local file, so an unavailable archive cannot hold QR generation forever. */
export async function prepareWhatsappVersion(
  source: VersionSource,
  cacheDirectory: string,
  stage: (description: string) => void,
): Promise<PreparedVersion> {
  if (source.type === "none") return { webVersionCache: { type: "none" } };
  const filename = source.remotePath.split("/").pop() ?? "";
  if (!/^\d+(?:\.\d+)+\.html$/.test(filename)) return { webVersionCache: { type: "none" } };
  const target = path.join(cacheDirectory, filename);
  const prepared: PreparedVersion = {
    webVersion: filename.slice(0, -5),
    webVersionCache: { type: "local", path: cacheDirectory, strict: true },
  };
  try {
    if (fs.existsSync(target) && isWhatsappHtml(fs.readFileSync(target, "utf8"))) return prepared;
  } catch { /* A cache problem must not prevent direct loading from WhatsApp. */ }

  stage("Baixando versão do WhatsApp Web");
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const html = await Promise.race([
      fetch(source.remotePath, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.text();
        if (!isWhatsappHtml(body)) throw new Error("O arquivo recebido não é uma página do WhatsApp.");
        return body;
      }),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(new Error("O download da versão do WhatsApp excedeu 8 segundos."));
        }, HTML_TIMEOUT_MS);
      }),
    ]);
    fs.mkdirSync(cacheDirectory, { recursive: true });
    fs.writeFileSync(target + ".tmp", html, "utf8");
    fs.renameSync(target + ".tmp", target);
    return prepared;
  } catch (error) {
    console.warn("[WhatsApp] Arquivo de versão indisponível; abrindo diretamente o WhatsApp Web:", error);
    stage("Versão alternativa indisponível; abrindo WhatsApp Web");
    return { webVersionCache: { type: "none" } };
  } finally {
    clearTimeout(timer);
  }
}

/** Uses the public auth lifecycle hook after the page exists, before initialize navigates.
 * The library otherwise waits for 'load' with timeout:0 before starting QR injection. */
export function configureWhatsappStartupPage(page: Page, stage: (description: string) => void): void {
  const originalGoto = page.goto.bind(page);
  page.goto = async (url, options) => {
    if (new URL(url).origin !== "https://web.whatsapp.com") return originalGoto(url, options);
    stage("Abrindo a página do WhatsApp Web");
    try {
      return await originalGoto(url, { ...options, waitUntil: "domcontentloaded", timeout: WHATSAPP_NAVIGATION_TIMEOUT_MS });
    } catch (error) {
      throw new Error(`Não foi possível abrir a página do WhatsApp Web em até 45 segundos: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  page.on("domcontentloaded", () => stage("Preparando o vínculo e o QR Code"));
  page.on("error", () => stage("O navegador do WhatsApp foi interrompido"));
}
