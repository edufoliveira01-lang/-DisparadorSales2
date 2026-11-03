import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { definirCacheDjenAtivo, limparCachesDjen, memoDjen, memoDjenAsync, memoTexto, hojeSaoPaulo } from "../src/services/djen/cache";

beforeEach(() => definirCacheDjenAtivo(true));
afterEach(() => definirCacheDjenAtivo(false));

describe("cache dos cálculos do DJEN", () => {
  it("reaproveita o resultado até a invalidação", () => {
    let chamadas = 0;
    const calcular = () => ++chamadas;
    expect(memoDjen("a", 60_000, calcular)).toBe(1);
    expect(memoDjen("a", 60_000, calcular)).toBe(1);
    limparCachesDjen();
    expect(memoDjen("a", 60_000, calcular)).toBe(2);
  });
  it("expira pelo tempo e separa chaves", () => {
    let n = 0;
    expect(memoDjen("t", 0, () => ++n)).toBe(1);
    expect(memoDjen("t", 0, () => ++n)).toBe(2);
    expect(memoDjen("x", 60_000, () => "x")).toBe("x");
    expect(memoDjen("y", 60_000, () => "y")).toBe("y");
  });
  it("não grava um resultado calculado enquanto os dados mudaram", () => {
    let n = 0;
    const r = memoDjen("m", 60_000, () => { limparCachesDjen(); return ++n; });
    expect(r).toBe(1);
    expect(memoDjen("m", 60_000, () => ++n)).toBe(2);
  });
  it("compartilha o cálculo assíncrono simultâneo", async () => {
    let n = 0;
    const lento = async () => { await new Promise((r) => setTimeout(r, 20)); return ++n; };
    const [a, b] = await Promise.all([memoDjenAsync("s", 60_000, lento), memoDjenAsync("s", 60_000, lento)]);
    expect([a, b, n]).toEqual([1, 1, 1]);
    expect(await memoDjenAsync("s", 60_000, lento)).toBe(1);
  });
  it("desligado, sempre recalcula", () => {
    definirCacheDjenAtivo(false);
    let n = 0;
    expect(memoDjen("z", 60_000, () => ++n)).toBe(1);
    expect(memoDjen("z", 60_000, () => ++n)).toBe(2);
  });
  it("cache por texto e data de hoje", () => {
    let n = 0;
    expect(memoTexto("t", "abc", () => ++n)).toBe(1);
    expect(memoTexto("t", "abc", () => ++n)).toBe(1);
    expect(memoTexto("t", "abd", () => ++n)).toBe(2);
    expect(hojeSaoPaulo()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
