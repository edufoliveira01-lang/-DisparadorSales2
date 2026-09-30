import { describe, expect, it } from "vitest";
import { isWhatsappBrowserStalledError } from "../src/services/whatsappService";

describe("detecção de travamento do navegador do WhatsApp", () => {
  it("reconhece o timeout Runtime.callFunctionOn informado pelo Puppeteer", () => {
    expect(isWhatsappBrowserStalledError(new Error(
      "Runtime.callFunctionOn timed out. Increase the 'protocolTimeout' setting in launch/connect calls for a higher timeout if needed.",
    ))).toBe(true);
  });

  it("reconhece o watchdog interno antes do timeout longo do Puppeteer", () => {
    expect(isWhatsappBrowserStalledError(new Error(
      "WHATSAPP_BROWSER_OPERATION_TIMEOUT: tempo esgotado ao enviar a mensagem.",
    ))).toBe(true);
  });

  it("não trata uma navegação transitória como browser definitivamente travado", () => {
    expect(isWhatsappBrowserStalledError(new Error(
      "Protocol error (Runtime.callFunctionOn): Execution context was destroyed.",
    ))).toBe(false);
  });

  it("não confunde falhas comuns de envio com travamento do Chromium", () => {
    expect(isWhatsappBrowserStalledError(new Error("WhatsApp não está conectado."))).toBe(false);
  });
});
