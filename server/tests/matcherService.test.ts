import { describe, expect, it } from "vitest";
import { matchContact, normalizeName } from "../src/services/matcherService";
import type { Contact } from "../src/services/contactsService";

function contact(id: number, nome: string): Contact {
  return { id, nome, telefone: "5511999999999", observacoes: null, created_at: "" };
}

describe("normalizeName", () => {
  it("remove acentos, normaliza espaços e caixa", () => {
    expect(normalizeName("  João   da SILVA ")).toBe("joao da silva");
  });
});

describe("matchContact", () => {
  const contacts = [contact(1, "Maria da Silva"), contact(2, "João Pereira"), contact(3, "Ana Costa")];

  it("encontra match exato ignorando acento/caixa/espaços", () => {
    const result = matchContact("  MARIA DA SILVA ", contacts);
    expect(result.exact?.id).toBe(1);
    expect(result.score).toBe(1);
  });

  it("sugere o contato mais provável quando não há match exato", () => {
    const result = matchContact("Joao Pereira Junior", contacts);
    expect(result.exact).toBeNull();
    expect(result.sugestao?.id).toBe(2);
  });

  it("não sugere nada quando não há nenhum contato parecido", () => {
    const result = matchContact("Zzzzz Xxxxx Completamente Diferente", contacts);
    expect(result.exact).toBeNull();
    expect(result.sugestao).toBeNull();
  });

  it("retorna tudo nulo quando a lista de contatos está vazia", () => {
    const result = matchContact("Qualquer Nome", []);
    expect(result).toEqual({ exact: null, sugestao: null, score: null });
  });
});
