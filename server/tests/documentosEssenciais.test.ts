import { afterAll, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { classificarArquivo, guardarEssencial, identificarSlot, listarEssenciais, renomearArquivo } from "../src/services/gestao/documentosEssenciais";
import { salvarArquivo } from "../src/services/gestao/arquivos";

const user = { id: null, nome: "Teste" };
const pessoa = Number(db.prepare("INSERT INTO gestao_pessoas(tipo,nome) VALUES ('cliente','Zz Docs Essenciais')").run().lastInsertRowid);
const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const diasAtras = (n: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
afterAll(() => { db.prepare("DELETE FROM gestao_arquivos WHERE pessoa_id=?").run(pessoa); db.prepare("DELETE FROM gestao_pessoas WHERE id=?").run(pessoa); });

describe("documentos essenciais do cliente", () => {
  it("reconhece o documento pelo nome ou pelo título", () => {
    expect(identificarSlot("CNIS 2026.pdf")).toBe("cnis");
    expect(identificarSlot("Extrato previdenciário.pdf")).toBe("cnis");
    expect(identificarSlot("IMG-2231.jpg", "Comprovante de residência")).toBe("comprovante");
    expect(identificarSlot("conta de luz agosto.pdf")).toBe("comprovante");
    expect(identificarSlot("minha CNH.jpg")).toBe("cnh");
    expect(identificarSlot("rg frente.jpg")).toBe("rg");
    expect(identificarSlot("CPF.pdf")).toBe("cpf");
    expect(identificarSlot("laudo.pdf")).toBeNull();
  });

  it("faltando → ok → desatualizado; o mais recente é o atual e os outros viram histórico", () => {
    expect(listarEssenciais(pessoa).every((s) => s.situacao === "faltando")).toBe(true);
    guardarEssencial(pessoa, "cnis", "cnis velho.pdf", Buffer.from("a"), { data: diasAtras(200), user });
    guardarEssencial(pessoa, "cnis", "cnis novo.pdf", Buffer.from("b"), { data: diasAtras(5), user });
    guardarEssencial(pessoa, "comprovante", "luz.pdf", Buffer.from("c"), { data: diasAtras(100), user });
    const l = Object.fromEntries(listarEssenciais(pessoa).map((s) => [s.slot, s]));
    expect(l.cnis!.situacao).toBe("ok");
    expect(l.cnis!.atual!.nome).toBe(`${diasAtras(5)} - CNIS.pdf`);
    expect(l.cnis!.historico).toHaveLength(1);
    expect(l.comprovante!.situacao).toBe("desatualizado"); // 100 dias > 90
    expect(l.rg!.situacao).toBe("faltando");
  });

  it("o documento do atendimento não entra duas vezes", () => {
    expect(guardarEssencial(pessoa, "rg", "rg.jpg", Buffer.from("x"), { user, origemRef: "chat-1" })).not.toBeNull();
    expect(guardarEssencial(pessoa, "rg", "rg.jpg", Buffer.from("x"), { user, origemRef: "chat-1" })).toBeNull();
  });

  it("classificar um arquivo comum renomeia para o padrão; renomear mantém a extensão", () => {
    const a = salvarArquivo({ pessoaId: pessoa }, "scan123.pdf", Buffer.from("z"), {}, user);
    const r = classificarArquivo(a.id, "cnh", { data: diasAtras(3) });
    expect(r).toMatchObject({ slot: "cnh", nome: `${diasAtras(3)} - CNH.pdf` });
    expect(renomearArquivo(a.id, "CNH do João").nome).toBe("CNH do João.pdf");
    expect(() => renomearArquivo(a.id, "x.exe")).toThrow();
    expect(() => renomearArquivo(a.id, "x.docx")).toThrow(/extensão/);
    expect(classificarArquivo(a.id, "", {})).toMatchObject({ slot: "" });
  });
});
