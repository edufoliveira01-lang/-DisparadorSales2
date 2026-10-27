import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ backup: vi.fn() }));
vi.mock("../src/services/whatsappProfile", async importOriginal => ({ ...await importOriginal<typeof import("../src/services/whatsappProfile")>(), backupWhatsappProfile: mocks.backup }));
import { whatsappManager } from "../src/services/whatsappService";
const manager = whatsappManager as unknown as { client: unknown; status: string };
afterEach(async () => { await whatsappManager.stop(); vi.restoreAllMocks(); mocks.backup.mockReset(); });
describe("gerar QR Code com nova sessão", () => {
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
