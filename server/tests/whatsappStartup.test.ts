import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "whatsapp-web.js";
import {
  encerrarWhatsappClient,
  whatsappManager,
} from "../src/services/whatsappService";
const manager = whatsappManager as unknown as {
  client: Client | null;
  status: string;
  geracao: number;
  setState: (s: { status: string }) => void;
  iniciarTentativaSegura: (g: number) => void;
  encerramento: Promise<void> | null;
};
beforeEach(() => {
  vi.useFakeTimers();
  manager.client = null;
  manager.status = "desconectado";
});
afterEach(async () => {
  const p = whatsappManager.stop();
  await vi.advanceTimersByTimeAsync(6000);
  await p;
  vi.restoreAllMocks();
  vi.clearAllTimers();
  vi.useRealTimers();
});
describe("WhatsApp travado na inicialização", () => {
  it("Parar termina mesmo quando destroy não responde e preserva o login", async () => {
    const kill = vi.fn(),
      logout = vi.fn(),
      client = {
        destroy: vi.fn(() => new Promise(() => {})),
        logout,
        pupBrowser: { process: () => ({ kill }) },
      };
    manager.client = client as unknown as Client;
    manager.setState({ status: "inicializando" });
    const g = manager.geracao;
    const p = whatsappManager.stop();
    expect(whatsappManager.getState().status).toBe("desconectado");
    expect(manager.geracao).toBe(g + 1);
    await vi.advanceTimersByTimeAsync(5001);
    await p;
    expect(kill).toHaveBeenCalledWith("SIGKILL");
    expect(logout).not.toHaveBeenCalled();
  });
  it("o watchdog encerra inicialização sem QR e permite nova tentativa", async () => {
    manager.setState({ status: "inicializando" });
    expect(whatsappManager.getState().status).toBe("inicializando");
    await vi.advanceTimersByTimeAsync(120001);
    expect(whatsappManager.getState().status).toBe("falha");
    expect(whatsappManager.getState().lastError).toMatch(/2 minutos/);
    const iniciar = vi
      .spyOn(manager, "iniciarTentativaSegura")
      .mockImplementation(() => {});
    expect(whatsappManager.connect()).toBe(true);
    expect(iniciar).toHaveBeenCalledOnce();
  });
  it("limita também logout travado sem bloquear o encerramento", async () => {
    const kill = vi.fn(),
      client = {
        logout: vi.fn(() => new Promise(() => {})),
        destroy: vi.fn(),
        pupBrowser: { process: () => ({ kill }) },
      };
    const p = encerrarWhatsappClient(client as unknown as Client, true);
    await vi.advanceTimersByTimeAsync(5001);
    await p;
    expect(kill).toHaveBeenCalledOnce();
  });
});
