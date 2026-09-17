import { describe, expect, it, vi } from "vitest";
import { notifyDashboardChanges } from "../src/websocket/dashboardChanges";
import { emitEvent } from "../src/websocket";

vi.mock("../src/websocket", () => ({ emitEvent: vi.fn() }));

describe("invalidação da dashboard", () => {
  function request(method: string, path: string, statusCode: number) {
    const listeners: Record<string, () => void> = {};
    const next = vi.fn();
    notifyDashboardChanges({ method, path } as any, {
      statusCode, on: (evento: string, handler: () => void) => { listeners[evento] = handler; },
    } as any, next);
    listeners.finish?.();
    expect(next).toHaveBeenCalledOnce();
  }
  it("notifica alterações de agenda, contatos, histórico e pendências", () => {
    for (const path of ["/pericias-agendadas/1", "/contacts/1", "/logs/1", "/pending-replies/1/confirmar", "/settings"]) {
      vi.clearAllMocks();
      request("PUT", path, 200);
      expect(emitEvent).toHaveBeenCalledWith("dashboard:changed", {});
    }
  });
  it("não gera loop por leituras, erros ou recursos não relacionados", () => {
    vi.clearAllMocks();
    request("GET", "/logs", 200);
    request("DELETE", "/contacts/1", 404);
    request("POST", "/auth/login", 200);
    expect(emitEvent).not.toHaveBeenCalled();
  });
});
