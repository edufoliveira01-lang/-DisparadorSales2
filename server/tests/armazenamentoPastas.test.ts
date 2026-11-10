import { describe, expect, it } from "vitest";
import {
  casarPasta, caminhoDoTipo, chaveDeComparacao, dataDoArquivo, dentroDaRaiz, ehTipoDePasta, ErroArmazenamento, nomeDaPastaDoCliente, nomeDoArquivo,
  similaridade, TIPOS_DE_PASTA, type PastaExistente,
} from "../src/armazenamento/pastas";

const pasta = (nome: string, id = `id:${nome}`): PastaExistente => ({ id, nome, caminho: `/CLIENTES/${nome}` });

describe("nome da pasta do cliente", () => {
  it("MAIÚSCULAS, com acento, espaços simples e sem caractere proibido", () => {
    expect(nomeDaPastaDoCliente("  joão   da silva ")).toBe("JOÃO DA SILVA");
    expect(nomeDaPastaDoCliente("Maria: de/Souza*")).toBe("MARIA DE SOUZA");
    expect(nomeDaPastaDoCliente("josé da silva.")).toBe("JOSÉ DA SILVA");
  });
  it("sem nome confirmado, recusa (nunca cria pasta com nome errado)", () => {
    expect(() => nomeDaPastaDoCliente("   ")).toThrow(ErroArmazenamento);
    expect(() => nomeDaPastaDoCliente(null)).toThrow(/nome completo/);
  });
});

describe("comparação de nomes", () => {
  it("ignora caixa, acento, pontuação e espaços", () => {
    expect(chaveDeComparacao("JOÃO  da Silva.")).toBe("joao da silva");
    expect(similaridade("JOÃO DA SILVA", "joao da silva")).toBe(1);
  });
  it("nomes de pessoas diferentes ficam longe", () => {
    expect(similaridade("MARIA DE SOUZA", "PEDRO ALVES LIMA")).toBeLessThan(0.5);
  });
});

describe("casar com as pastas que já existem — nunca adivinha", () => {
  it("nome idêntico (caixa/acento) → usa a pasta existente", () => {
    const r = casarPasta("JOÃO DA SILVA", [pasta("MARIA SOUZA"), pasta("joao da silva")]);
    expect(r.tipo).toBe("exato");
    if (r.tipo === "exato") expect(r.pasta.nome).toBe("joao da silva");
  });
  it("«DA» no lugar de «DE» NÃO é igual: vira candidata para a equipe escolher (não envia)", () => {
    const r = casarPasta("JOÃO DA SILVA", [pasta("JOÃO DE SILVA"), pasta("PEDRO ALVES")]);
    expect(r.tipo).toBe("parecido");
    if (r.tipo === "parecido") {
      expect(r.candidatas).toHaveLength(1);
      expect(r.candidatas[0]!.pasta.nome).toBe("JOÃO DE SILVA");
      expect(r.candidatas[0]!.nota).toBeGreaterThanOrEqual(0.95);
    }
  });
  it("uma letra errada também é parecido, não exato", () => {
    const r = casarPasta("MARCELO DE ESTÁCIO", [pasta("MARCELO DE ESTACIO"), pasta("MARCELA DE ESTÁCIO")]);
    expect(r.tipo).toBe("exato"); // sem acento é o MESMO nome
    const r2 = casarPasta("MARCELO DE ESTÁCIO", [pasta("MARCELO DE ESTACIOO")]);
    expect(r2.tipo).toBe("parecido");
  });
  it("duas pastas com o mesmo nome é ambíguo: pede escolha", () => {
    const r = casarPasta("ANA LIMA", [pasta("ANA LIMA", "id:1"), pasta("ana lima", "id:2")]);
    expect(r.tipo).toBe("parecido");
    if (r.tipo === "parecido") expect(r.candidatas.map((c) => c.pasta.id)).toEqual(["id:1", "id:2"]);
  });
  it("nada parecido → nenhum (o chamador cria a pasta nova)", () => {
    expect(casarPasta("CARLOS EDUARDO PEREIRA", [pasta("MARIA SOUZA"), pasta("PEDRO ALVES")]).tipo).toBe("nenhum");
    expect(casarPasta("CARLOS EDUARDO PEREIRA", []).tipo).toBe("nenhum");
  });
  it("no máximo 5 candidatas, as mais próximas primeiro", () => {
    const muitas = Array.from({ length: 8 }, (_, i) => pasta(`JOAO DA SILVA ${"X".repeat(i + 1)}`));
    const r = casarPasta("JOAO DA SILVA", muitas, 0.5);
    expect(r.tipo).toBe("parecido");
    if (r.tipo === "parecido") {
      expect(r.candidatas).toHaveLength(5);
      for (let i = 1; i < r.candidatas.length; i++) expect(r.candidatas[i - 1]!.nota).toBeGreaterThanOrEqual(r.candidatas[i]!.nota);
    }
  });
});

describe("nome do arquivo e data", () => {
  it("AAAA-MM-DD - Título.ext, com a data de Brasília (23h de 10/11 em Brasília ainda é 10/11)", () => {
    expect(nomeDoArquivo("2026-11-11T02:30:00Z", "CNIS", ".PDF")).toBe("2026-11-10 - CNIS.pdf");
    expect(dataDoArquivo("2026-11-10T15:00:00Z")).toBe("2026-11-10");
  });
  it("título sem caractere proibido e sem extensão estranha", () => {
    expect(nomeDoArquivo("2026-01-05T12:00:00Z", "Laudo: ortopedia/2026?", "pdf")).toBe("2026-01-05 - Laudo ortopedia 2026.pdf");
    expect(nomeDoArquivo("2026-01-05T12:00:00Z", "RG", "")).toBe("2026-01-05 - RG");
  });
  it("sem título, recusa", () => {
    expect(() => nomeDoArquivo("2026-01-05T12:00:00Z", "  ", "pdf")).toThrow(ErroArmazenamento);
  });
});

describe("a TRAVA de /CLIENTES", () => {
  it("aceita /CLIENTES e o que está dentro (sem diferenciar caixa)", () => {
    expect(dentroDaRaiz("/CLIENTES")).toBe("/CLIENTES");
    expect(dentroDaRaiz("/clientes/JOÃO/PARTE MÉDICA/")).toBe("/clientes/JOÃO/PARTE MÉDICA");
  });
  it("recusa fora da raiz, parentes (..) e barras invertidas", () => {
    for (const ruim of ["/", "", "/OUTRA", "/CLIENTESX/a", "/CLIENTES/../OUTRA", "/CLIENTES/./a", "\\CLIENTES\\a", "CLIENTES/a"]) {
      expect(() => dentroDaRaiz(ruim), ruim).toThrow(ErroArmazenamento);
    }
  });
  it("as cinco pastas de tipo existem e o caminho do tipo fica dentro da raiz", () => {
    expect(TIPOS_DE_PASTA).toHaveLength(5);
    expect(ehTipoDePasta("PARTE MÉDICA")).toBe(true);
    expect(ehTipoDePasta("OUTRA")).toBe(false);
    expect(dentroDaRaiz(caminhoDoTipo("ANA LIMA", "DOCUMENTOS PESSOAIS"))).toBe("/CLIENTES/ANA LIMA/DOCUMENTOS PESSOAIS");
  });
});
