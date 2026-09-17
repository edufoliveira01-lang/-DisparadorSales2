import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscribeRealtimeRefresh } from "../../client/src/lib/realtimeRefresh";

const state = {
  cleanup: undefined as undefined | (() => void),
  listeners: new Map<string, () => void>(),
};
const source = {
  on: (evento: string, fn: () => void) => state.listeners.set(evento, fn),
  off: (evento: string) => state.listeners.delete(evento),
};
const visibility = { visibilityState: "visible", addEventListener: vi.fn(), removeEventListener: vi.fn() };
function useRealtimeRefresh(refresh: () => Promise<unknown>, events: readonly string[]) {
  state.cleanup = subscribeRealtimeRefresh(refresh, events, source, visibility as any, 30000);
}
beforeEach(() => {
  vi.useFakeTimers();
  visibility.visibilityState = "visible";
});
afterEach(() => {
  state.cleanup?.();
  state.listeners.clear();
  vi.useRealTimers();
});
describe("atualizações em tempo real", () => {
  it("agrupa rajadas de ACKs, respostas e envios em uma consulta", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useRealtimeRefresh(refresh, ["send:update", "send:ack-update", "pendingReply:resolved"]);
    for (const evento of ["send:update", "send:ack-update", "pendingReply:resolved"]) state.listeners.get(evento)?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledOnce();
  });
  it("serializa consultas e reaplica invalidações recebidas enquanto aguarda", async () => {
    let resolve!: () => void;
    const refresh = vi.fn().mockImplementationOnce(() => new Promise<void>((r) => { resolve = r; })).mockResolvedValue(undefined);
    useRealtimeRefresh(refresh, ["send:update"]);
    state.listeners.get("send:update")?.();
    await vi.advanceTimersByTimeAsync(150);
    state.listeners.get("send:update")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledOnce();
    resolve();
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledTimes(2);
  });
  it("atualiza ao reconectar e remove timers/listeners ao sair", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useRealtimeRefresh(refresh, ["send:update"]);
    state.listeners.get("connect")?.();
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledOnce();
    state.cleanup?.();
    await vi.advanceTimersByTimeAsync(60000);
    expect(refresh).toHaveBeenCalledOnce();
    expect(state.listeners.size).toBe(0);
  });
  it("consulta periodicamente apenas quando a aba está visível", async () => {
    const refresh = vi.fn().mockResolvedValue(undefined);
    useRealtimeRefresh(refresh, []);
    visibility.visibilityState = "hidden" as any;
    await vi.advanceTimersByTimeAsync(30150);
    expect(refresh).not.toHaveBeenCalled();
    visibility.visibilityState = "visible" as any;
    await vi.advanceTimersByTimeAsync(30000);
    expect(refresh).toHaveBeenCalledOnce();
  });
});
