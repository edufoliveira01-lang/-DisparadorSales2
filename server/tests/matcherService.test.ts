import { describe, expect, it } from "vitest";
import { matchContact, normalizeName } from "../src/services/matcherService";
import type { Contact } from "../src/services/contactsService";

function contact(id: number, nome: string): Contact {
  return {
    id,
    nome,
    telefone: "5511999999999",
    processo: null,
    processo_chave: "",
    observacoes: null,
    created_at: "",
  };
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
    expect(result).toEqual({ exact: null, sugestao: null, score: null, criterio: null });
  });

  it("confirma o contato pelo nome completo e número do processo", () => {
    const maria = {
      ...contact(4, "Maria Aparecida da Silva"),
      processo: "5001306-35.2026.4.03.6321",
      processo_chave: "50013063520264036321",
    };
    const result = matchContact("MARIA APARECIDA DA SILVA", [maria], "50013063520264036321");

    expect(result.exact?.id).toBe(4);
    expect(result.criterio).toBe("nome_processo");
  });

  it("não preenche automaticamente quando o mesmo nome tem processo diferente", () => {
    const maria = {
      ...contact(5, "Maria Aparecida da Silva"),
      processo: "1111111-11.2026.1.11.1111",
      processo_chave: "11111111120261111111",
    };
    const result = matchContact("Maria Aparecida da Silva", [maria], "2222222-22.2026.2.22.2222");

    expect(result.exact).toBeNull();
    expect(result.sugestao?.id).toBe(5);
    expect(result.criterio).toBe("processo_divergente");
  });

  it("mantém contato antigo sem processo apenas como sugestão", () => {
    const result = matchContact("Maria da Silva", contacts, "5001306-35.2026.4.03.6321");

    expect(result.exact).toBeNull();
    expect(result.sugestao?.id).toBe(1);
    expect(result.criterio).toBe("somente_nome");
  });
});
