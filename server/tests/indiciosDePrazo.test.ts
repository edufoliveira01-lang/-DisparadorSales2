import { describe, expect, it } from "vitest";
import { indiciosDePrazo } from "../src/services/djen/indiciosDePrazo";

describe("indícios de prazo", () => {
  it("acha «15 dias úteis» no resumo da IA quando o texto não traz a ordem formal", () => {
    const r = indiciosDePrazo({ texto: "Emende a parte autora a petição inicial.", analise: { resumo: "Ordem à autora para emendar a inicial no prazo de 15 dias úteis." } });
    expect(r[0]).toMatchObject({ dias: 15, unidade: "uteis", unidade_citada: true, origem: "ia" });
  });
  it("sem unidade citada, sugere úteis e avisa que não foi citada", () => {
    const r = indiciosDePrazo({ texto: "Intime-se a parte para manifestar-se em 10 dias." });
    expect(r[0]).toMatchObject({ dias: 10, unidade: "uteis", unidade_citada: false });
  });
  it("número solto fora de contexto de prazo não é indício", () => {
    expect(indiciosDePrazo({ texto: "O benefício foi cessado há 30 dias na agência." })).toEqual([]);
  });
  it("não repete o mesmo período", () => {
    const r = indiciosDePrazo({ texto: "Manifeste-se em 15 dias úteis. O prazo de 15 dias úteis corre da intimação.", analise: { resumo: "Prazo de 15 dias úteis para manifestação." } });
    expect(r.filter((x) => x.dias === 15).length).toBe(1);
  });
});
