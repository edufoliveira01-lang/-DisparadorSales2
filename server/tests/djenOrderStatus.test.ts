import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { situacaoDaOrdem } from "../src/services/djen/orderStatus";
import { listarPublicacoes, detalhesPublicacao } from "../src/services/djen/store";

const ordemEmenda = { acao: "emenda_inicial", trecho: "intime-se a autora para emendar a inicial em 15 dias" };
const ordemManifest = { acao: "manifestacao", trecho: "intime-se a autora para manifestar-se em 10 dias" };
const pub = (data: string, texto: string, extra: object = {}) => ({ data, texto, ...extra });

describe("situação das ordens do escritório", () => {
  it("fica vigente sem fato posterior", () => {
    expect(situacaoDaOrdem(ordemManifest, [pub("2026-05-02", "Vistos. Aguarde-se.")]).situacao).toBe("vigente");
  });
  it("reconhece cumprimento pela parte autora", () => {
    expect(situacaoDaOrdem(ordemManifest, [pub("2026-05-02", "Juntada de manifestação da parte autora.")]).situacao).toBe("cumprida");
    expect(situacaoDaOrdem(ordemEmenda, [pub("2026-05-02", "Recebo a emenda à inicial. Cite-se o INSS.")]).situacao).toBe("cumprida");
    expect(situacaoDaOrdem(ordemEmenda, [pub("2026-05-02", "Cite-se o INSS.")]).situacao).toBe("cumprida");
  });
  it("não confunde nova intimação ou negação com cumprimento", () => {
    expect(situacaoDaOrdem(ordemManifest, [pub("2026-05-02", "Intime-se a parte autora para apresentar a manifestação.")]).situacao).toBe("vigente");
    expect(situacaoDaOrdem(ordemManifest, [pub("2026-05-02", "A parte autora não apresentou manifestação.")]).situacao).toBe("vigente");
  });
  it("sentença posterior supera ordem de instrução, mas não de contrarrazões", () => {
    const sentenca = pub("2026-06-01", "JULGO PROCEDENTE o pedido, devendo o INSS pagar as parcelas.");
    expect(situacaoDaOrdem(ordemManifest, [sentenca]).situacao).toBe("superada");
    expect(situacaoDaOrdem({ acao: "recurso", trecho: "contrarrazoes" }, [sentenca]).situacao).toBe("vigente");
    expect(situacaoDaOrdem({ acao: "recurso", trecho: "contrarrazoes" }, [pub("2026-07-01", "Certifico o trânsito em julgado.")]).situacao).toBe("superada");
  });
  it("revogação expressa e decurso de prazo", () => {
    expect(situacaoDaOrdem(ordemManifest, [pub("2026-05-02", "Torno sem efeito a intimação anterior.")]).situacao).toBe("revogada");
    expect(situacaoDaOrdem(ordemManifest, [pub("2026-05-30", "Certifico o decurso de prazo sem manifestação.")]).situacao).toBe("decorrido");
  });
  it("prazos concluídos pelo usuário encerram a ordem", () => {
    expect(situacaoDaOrdem(ordemManifest, [], { prazosDoUsuario: { total: 1, abertos: 0, concluidos: 1 } }).situacao).toBe("cumprida");
    expect(situacaoDaOrdem(ordemManifest, [], { prazosDoUsuario: { total: 2, abertos: 1, concluidos: 1 } }).situacao).toBe("vigente");
  });
});

describe("providência vigente do processo", () => {
  const chave = "50000010120264030000";
  let serial = 0;
  const publicar = (data: string, texto: string, tipo = "Despacho") =>
    Number(db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(`os-${++serial}`, chave, "TJSP", "Vara", "Procedimento", tipo, "Intimação", data, texto).lastInsertRowid);
  beforeEach(() => {
    db.exec("DELETE FROM djen_prazos; DELETE FROM djen_publicacoes; DELETE FROM djen_processos;");
    db.prepare("INSERT INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, chave);
  });
  it("prazo antigo cumprido não aparece como providência atual; fica registrado como encerrado", () => {
    publicar("2026-01-10", "Intime-se a parte autora para promover a emenda à inicial, no prazo de 15 (quinze) dias.");
    const ultima = publicar("2026-02-10", "Recebo a emenda à inicial. Cite-se o INSS.");
    const lista = listarPublicacoes({ arquivo: "todos" }) as { items: { id: number; acao: { tipo: string; encerradas: unknown[] } }[] };
    const item = lista.items[0];
    expect(item.acao.tipo).toBe("ciencia");
    expect(item.acao.encerradas).toHaveLength(1);
    const detalhe = detalhesPublicacao(ultima) as { acao: { tipo: string } };
    expect(detalhe.acao.tipo).toBe("ciencia");
  });
  it("prazo ainda em aberto continua sendo a providência do processo", () => {
    const id = publicar("2026-01-10", "Intime-se a parte autora para promover a emenda à inicial, no prazo de 15 (quinze) dias.");
    publicar("2026-02-10", "Vistos. Aguarde-se.");
    const lista = listarPublicacoes({ arquivo: "todos" }) as { items: { acao: { tipo: string; publicacao_id: number; situacao: string } }[] };
    expect(lista.items[0].acao).toMatchObject({ tipo: "prazo_explicito", publicacao_id: id, situacao: "vigente" });
  });
  it("sentença posterior encerra a ordem de manifestação anterior", () => {
    publicar("2026-01-10", "Intime-se a parte autora para manifestar-se sobre o laudo, no prazo de 10 (dez) dias.");
    publicar("2026-03-10", "JULGO PROCEDENTE o pedido para condenar o INSS.", "Sentença");
    const lista = listarPublicacoes({ arquivo: "todos" }) as { items: { acao: { tipo: string; encerradas: { situacao: string }[] } }[] };
    expect(lista.items[0].acao.tipo).toBe("ciencia");
    expect(lista.items[0].acao.encerradas[0].situacao).toBe("superada");
  });
});
