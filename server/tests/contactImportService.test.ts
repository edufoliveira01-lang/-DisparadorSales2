import { describe, expect, it } from "vitest";
import { parseImportContent } from "../src/services/contactImportService";

describe("parseImportContent — CSV", () => {
  it("importa um CSV simples com colunas Nome/Telefone", () => {
    const csv = `Nome,Telefone,Observacoes\nMaria da Silva,11999999999,Cliente antiga\nJoão Pereira,5511988887777,`;
    const result = parseImportContent(csv);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      nome: "Maria da Silva",
      telefone: "5511999999999",
      processo: "",
      observacoes: "Cliente antiga",
    });
    expect(result[1].telefone).toBe("5511988887777");
  });

  it("importa o formato Google CSV (Name + várias colunas Phone N - Value)", () => {
    const csv = [
      "Name,Given Name,Family Name,Phone 1 - Type,Phone 1 - Value,Phone 2 - Type,Phone 2 - Value,Notes",
      "Ana Costa,Ana,Costa,Mobile,11987654321,Home,1133334444,Contato do trabalho",
    ].join("\n");
    const result = parseImportContent(csv);
    expect(result).toHaveLength(1);
    expect(result[0].nome).toBe("Ana Costa");
    expect(result[0].telefone).toBe("5511987654321");
    expect(result[0].observacoes).toBe("Contato do trabalho");
  });

  it("monta o nome a partir de Given Name + Family Name quando não há coluna Name", () => {
    const csv = "Given Name,Family Name,Phone 1 - Value\nCarlos,Souza,11912345678";
    const result = parseImportContent(csv);
    expect(result[0].nome).toBe("Carlos Souza");
  });

  it("ignora linhas sem nome ou sem telefone", () => {
    const csv = "Nome,Telefone\nSem Telefone,\n,11999999999\nCompleto,11988887777";
    const result = parseImportContent(csv);
    expect(result).toHaveLength(1);
    expect(result[0].nome).toBe("Completo");
  });

  it("lida com campos entre aspas contendo vírgulas", () => {
    const csv = `Nome,Telefone,Observacoes\n"Silva, Maria",11999999999,"Mora na Rua A, 123"`;
    const result = parseImportContent(csv);
    expect(result[0].nome).toBe("Silva, Maria");
    expect(result[0].observacoes).toBe("Mora na Rua A, 123");
  });

  it("importa o número do processo quando a coluna estiver presente", () => {
    const csv = "Nome,Telefone,Processo\nMaria da Silva,11999999999,5001306-35.2026.4.03.6321";
    const result = parseImportContent(csv);

    expect(result[0].processo).toBe("5001306-35.2026.4.03.6321");
  });
});

describe("parseImportContent — vCard", () => {
  it("importa um vCard simples", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Pedro Alves",
      "TEL;TYPE=CELL:+55 11 91234-5678",
      "NOTE:Indicado por Maria",
      "END:VCARD",
    ].join("\n");
    const result = parseImportContent(vcf);
    expect(result).toHaveLength(1);
    expect(result[0].nome).toBe("Pedro Alves");
    expect(result[0].telefone).toBe("5511912345678");
    expect(result[0].observacoes).toBe("Indicado por Maria");
  });

  it("importa múltiplos vCards do mesmo arquivo", () => {
    const vcf = [
      "BEGIN:VCARD",
      "FN:Contato Um",
      "TEL:11999990000",
      "END:VCARD",
      "BEGIN:VCARD",
      "FN:Contato Dois",
      "TEL:11988880000",
      "END:VCARD",
    ].join("\n");
    const result = parseImportContent(vcf);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.nome)).toEqual(["Contato Um", "Contato Dois"]);
  });

  it("importa processo de um vCard exportado pelo sistema", () => {
    const vcf = [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "FN:Maria da Silva",
      "TEL:11999990000",
      "X-PROCESSO:5001306-35.2026.4.03.6321",
      "END:VCARD",
    ].join("\n");
    const result = parseImportContent(vcf);

    expect(result[0].processo).toBe("5001306-35.2026.4.03.6321");
  });

  it("ignora vCards sem telefone", () => {
    const vcf = ["BEGIN:VCARD", "FN:Sem Telefone", "END:VCARD"].join("\n");
    expect(parseImportContent(vcf)).toHaveLength(0);
  });
});
