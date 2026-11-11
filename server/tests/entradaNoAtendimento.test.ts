import { describe, expect, it } from "vitest";
import { enderecoDeEntrada } from "../src/atendimento/instancia";

const a = { slug: "alfa", url: "https://atendimento.exemplo.com.br", ponteUrl: "https://ponte.exemplo.com.br", chaveSso: "chave-de-teste-chave-de-teste-123456" };

describe("entrada no atendimento", () => {
  it("sem telefone, entra na caixa de entrada", () => {
    const u = new URL(enderecoDeEntrada(a, "dono@alfa.com.br"));
    expect(u.pathname).toBe("/sso");
    expect(u.searchParams.get("next")).toBeNull();
  });
  it("com telefone, pede para abrir a conversa daquele número (só dígitos)", () => {
    const u = new URL(enderecoDeEntrada(a, "dono@alfa.com.br", "+55 (13) 99999-1111"));
    expect(u.searchParams.get("next")).toBe("/app/abrir-conversa?telefone=5513999991111");
  });
  it("telefone curto demais ou lixo é ignorado", () => {
    expect(new URL(enderecoDeEntrada(a, "dono@alfa.com.br", "123")).searchParams.get("next")).toBeNull();
    expect(new URL(enderecoDeEntrada(a, "dono@alfa.com.br", "abc")).searchParams.get("next")).toBeNull();
  });
});
