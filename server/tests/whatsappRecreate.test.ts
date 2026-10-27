import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
const mocks = vi.hoisted(() => ({ backup: vi.fn() }));
vi.mock("../src/services/whatsappProfile", async importOriginal => ({ ...await importOriginal<typeof import("../src/services/whatsappProfile")>(), backupWhatsappProfile: mocks.backup }));
import { whatsappManager } from "../src/services/whatsappService";
const manager = whatsappManager as unknown as { client: unknown; status: string };
afterEach(async () => { await whatsappManager.stop(); vi.restoreAllMocks(); mocks.backup.mockReset(); });
describe("gerar QR Code com nova sessão", () => {
  it("o botão único reaproveita uma sessão salva sem recriá-la", async () => {
    const exists = fs.existsSync.bind(fs);
    vi.spyOn(fs, "existsSync").mockImplementation(p => String(p).endsWith("whatsapp-session-ready.json") || exists(p));
    const connect = vi.spyOn(whatsappManager, "connect").mockReturnValue(true);
    const recreate = vi.spyOn(whatsappManager, "recreateSession").mockResolvedValue();
    manager.status = "desconectado";
    await whatsappManager.connectWithRecovery();
    expect(connect).toHaveBeenCalledOnce();
    expect(recreate).not.toHaveBeenCalled();
  });
  it("o mesmo botão renova um perfil sem sessão válida", async () => {
    const exists = fs.existsSync.bind(fs);
    vi.spyOn(fs, "existsSync").mockImplementation(p => String(p).endsWith("whatsapp-session-ready.json") ? false : String(p).endsWith("wwebjs_auth/session") || exists(p));
    const recreate = vi.spyOn(whatsappManager, "recreateSession").mockResolvedValue();
    manager.status = "desconectado";
    await whatsappManager.connectWithRecovery();
    expect(recreate).toHaveBeenCalledOnce();
  });
  it("preserva uma sessão salva mesmo após uma falha transitória", async () => {
    const exists = fs.existsSync.bind(fs);
    vi.spyOn(fs, "existsSync").mockImplementation(p => String(p).endsWith("whatsapp-session-ready.json") || exists(p));
    const recreate = vi.spyOn(whatsappManager, "recreateSession").mockResolvedValue();
    const connect = vi.spyOn(whatsappManager, "connect").mockReturnValue(true);
    manager.status = "falha";
    await whatsappManager.connectWithRecovery();
    expect(connect).toHaveBeenCalledOnce();
    expect(recreate).not.toHaveBeenCalled();
  });
  it("não interrompe uma conexão que já está ativa", async () => {
    manager.client = { destroy: vi.fn(async () => {}) };
    manager.status = "conectado";
    const recreate = vi.spyOn(whatsappManager, "recreateSession").mockResolvedValue();
    const connect = vi.spyOn(whatsappManager, "connect").mockReturnValue(true);
    await whatsappManager.connectWithRecovery();
    expect(connect).not.toHaveBeenCalled();
    expect(recreate).not.toHaveBeenCalled();
  });
  it("encerra o cliente, guarda o perfil e inicia uma única conexão", async () => {
    const destroy = vi.fn(async () => {}), logout = vi.fn();
    manager.client = { destroy, logout };
    manager.status = "inicializando";
    const connect = vi.spyOn(whatsappManager, "connect").mockReturnValue(true);
    const first = whatsappManager.recreateSession();
    const second = whatsappManager.recreateSession();
    expect(second).toBe(first);
    await first;
    expect(destroy).toHaveBeenCalledOnce();
    expect(logout).not.toHaveBeenCalled();
    expect(mocks.backup).toHaveBeenCalledOnce();
    expect(connect).toHaveBeenCalledOnce();
  });
  it("não abre outra sessão se o backup não for concluído", async () => {
    mocks.backup.mockImplementation(() => { throw new Error("profile still open"); });
    const connect = vi.spyOn(whatsappManager, "connect").mockReturnValue(true);
    await expect(whatsappManager.recreateSession()).rejects.toThrow("profile still open");
    expect(connect).not.toHaveBeenCalled();
  });
});
