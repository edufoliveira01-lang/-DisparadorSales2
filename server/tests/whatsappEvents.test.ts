import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ unsubscribe: vi.fn(), state: { status: "autenticado", syncProgress: 42 } }));
vi.mock("../src/services/whatsappService", () => ({ whatsappManager: {
  getState: () => mocks.state,
  onChange: () => mocks.unsubscribe,
} }));
import { whatsappRouter } from "../src/routes/whatsapp";
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); });
describe("fluxo persistente de estado do WhatsApp", () => {
  it("envia o estado inicial e mantém o SSE ativo até o navegador fechar", async () => {
    vi.useFakeTimers();
    const req = new EventEmitter();
    const res = { set: vi.fn(), flushHeaders: vi.fn(), write: vi.fn(), end: vi.fn() };
    const route = whatsappRouter.stack.find(layer => layer.route?.path === "/events");
    route!.route.stack[0].handle(req, res);
    expect(res.write).toHaveBeenCalledWith(`data: ${JSON.stringify(mocks.state)}\n\n`);
    await vi.advanceTimersByTimeAsync(45000);
    expect(res.write).toHaveBeenCalledTimes(4);
    expect(res.write).toHaveBeenLastCalledWith(": keep-alive\n\n");
    req.emit("close");
    await vi.advanceTimersByTimeAsync(30000);
    expect(res.write).toHaveBeenCalledTimes(4);
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    expect(res.end).toHaveBeenCalledOnce();
  });
});
