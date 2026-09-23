import { describe, expect, it } from "vitest";
import { createInFlightGuard } from "../../client/src/lib/inFlightGuard";

describe("trava síncrona de ações da interface", () => {
  it("bloqueia um segundo início para a mesma chave antes da conclusão", () => {
    const guard = createInFlightGuard<number>();

    expect(guard.tryStart(42)).toBe(true);
    expect(guard.tryStart(42)).toBe(false);
    expect(guard.isActive(42)).toBe(true);
  });

  it("libera uma nova tentativa quando a ação anterior termina", () => {
    const guard = createInFlightGuard<number>();

    expect(guard.tryStart(42)).toBe(true);
    guard.finish(42);
    expect(guard.isActive(42)).toBe(false);
    expect(guard.tryStart(42)).toBe(true);
  });
});
