import fs from "node:fs";
import { afterAll, describe, expect, it, vi } from "vitest";

// O teste não pode depender de a máquina que o roda ter a conta ChatGPT conectada (o servidor de deploy tem): sem caminho de visão, é «sem_ia».
vi.mock("../src/services/ai/visao", async (original) => ({ ...(await original<typeof import("../src/services/ai/visao")>()), caminhoDeVisaoPronto: async () => null }));
import { db } from "../src/db";
import { salvarArquivo, obterArquivo } from "../src/services/gestao/arquivos";
import { identificarArquivo, lerConteudo, leituraConfiavel, dataPlausivel } from "../src/services/gestao/leituraDoDocumento";
import { listarEssenciais } from "../src/services/gestao/documentosEssenciais";
import { fotoSugeridaDaPessoa, descartarSugestao } from "../src/services/gestao/fotoSugerida";

const user = { id: null, nome: "Teste" };
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(64, 1)]);
const pessoa = Number(db.prepare("INSERT INTO gestao_pessoas(tipo,nome) VALUES ('cliente','Zz Leitura Doc')").run().lastInsertRowid);
afterAll(() => { descartarSugestao(pessoa); db.prepare("DELETE FROM gestao_arquivos WHERE pessoa_id=?").run(pessoa); db.prepare("DELETE FROM gestao_pessoas WHERE id=?").run(pessoa); });

describe("identificação do documento pelo CONTEÚDO", () => {
  it("datas: só vale data real, passada e razoável", () => {
    expect(dataPlausivel("2026-10-05")).toBe("2026-10-05");
    expect(dataPlausivel("2099-01-01")).toBeNull();
    expect(dataPlausivel("1950-01-01")).toBeNull();
    expect(dataPlausivel("ontem")).toBeNull();
  });

  it("confiança: precisa de tipo conhecido e certeza suficiente", () => {
    expect(leituraConfiavel({ tipo: "cnis", data_documento: null, confianca: 0.9, retrato: null })).toBe(true);
    expect(leituraConfiavel({ tipo: "cnis", data_documento: null, confianca: 0.4, retrato: null })).toBe(false);
    expect(leituraConfiavel({ tipo: "outro", data_documento: null, confianca: 0.99, retrato: null })).toBe(false);
  });

  it("arquivo com nome estranho: a IA lê, classifica, renomeia pela data do documento e sugere a foto do RG", async () => {
    const a = salvarArquivo({ pessoaId: pessoa }, "imagem (2).png", PNG, {}, user);
    const r = await identificarArquivo(a.id, async () => ({ tipo: "rg", data_documento: null, confianca: 0.95, retrato: { x: 0.1, y: 0.2, largura: 0.25, altura: 0.35 } }));
    expect(r).toMatchObject({ situacao: "classificado", slot: "rg" });
    expect(obterArquivo(a.id).nome).toMatch(/^\d{4}-\d{2}-\d{2} - RG\.png$/);
    expect(listarEssenciais(pessoa).find((s) => s.slot === "rg")!.situacao).toBe("ok");
    expect(fotoSugeridaDaPessoa(pessoa)?.documento).toBe("RG");
  });

  it("CNIS em PDF com nome qualquer: usa a data do extrato; o que não for reconhecido fica como está", async () => {
    const pdf = Buffer.from("%PDF-1.4 teste");
    const a = salvarArquivo({ pessoaId: pessoa }, "scan123.pdf", pdf, {}, user);
    const r = await identificarArquivo(a.id, async () => ({ tipo: "cnis", data_documento: "2026-11-01", confianca: 0.9, retrato: null }));
    expect(r).toMatchObject({ situacao: "classificado", slot: "cnis", data: "2026-11-01" });
    expect(obterArquivo(a.id).nome).toBe("2026-11-01 - CNIS.pdf");
    const b = salvarArquivo({ pessoaId: pessoa }, "contrato.pdf", pdf, {}, user);
    expect(await identificarArquivo(b.id, async () => ({ tipo: "outro", data_documento: null, confianca: 0.9, retrato: null }))).toEqual({ situacao: "nao_identificado" });
    expect(obterArquivo(b.id).nome).toBe("contrato.pdf");
  });

  it("sem IA configurada nada é enviado e o arquivo fica como comum", async () => {
    const r = await lerConteudo(Buffer.from("x"), "a.pdf");
    expect(r.situacao).toBe("sem_ia");
    expect((await lerConteudo(Buffer.from("x"), "a.exe")).situacao).toBe("tipo_nao_suportado");
    void fs;
  });
});
