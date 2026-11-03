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

import { listarPrazosEscritorio as listarPrazos, listarProcessosParados as listarParados, atualizarPrazoEscritorio, limparMemoriaAlertas } from "../src/services/djen/prazosEscritorio";
describe("alertas do escritório", () => {
  const chave = "50000010120264030009";
  const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const dias = (n: number) => new Date(Date.parse(`${hojeSP()}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
  let n = 0;
  const pub = (data: string, texto: string, extra = "") =>
    Number(db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto${extra ? ",categorias_json" : ""})
      VALUES (?,?,?,?,?,?,?,?,?${extra ? ",?" : ""})`).run(...[`pe-${++n}`, chave, "TJSP", "Vara", "Proc", "Despacho", "Intimação", data, texto, ...(extra ? [extra] : [])]).lastInsertRowid);
  beforeEach(() => {
    db.exec("DELETE FROM djen_prazos_escritorio_estado; DELETE FROM djen_prazos; DELETE FROM pericias_agendadas; DELETE FROM djen_publicacoes; DELETE FROM djen_processos;");
    db.prepare("INSERT INTO djen_processos(chave,numero) VALUES (?,?)").run(chave, chave);
  });
  it("prazo salvo vencido sem cumprimento aparece; baixa manual e conclusão o retiram", () => {
    const id = pub(dias(30), "Intime-se a parte autora para manifestar-se no prazo de 10 (dez) dias.");
    db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,termino,status) VALUES (?,?,?,'aberto')").run(id, "Manifestação", dias(5));
    const [item] = (limparMemoriaAlertas(), listarPrazos());
    expect(item).toMatchObject({ publicacao_id: id, urgencia: "vencido", origem_data: "salvo" });
    expect(item.dias_para_vencer).toBe(-5);
  });
  it("já cumprido por publicação posterior não gera alerta", () => {
    const id = pub(dias(30), "Intime-se a parte autora para manifestar-se no prazo de 10 (dez) dias.");
    db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,termino,status) VALUES (?,?,?,'aberto')").run(id, "Manifestação", dias(5));
    pub(dias(10), "Juntada de manifestação da parte autora.");
    expect((limparMemoriaAlertas(), listarPrazos())).toHaveLength(0);
  });
  it("processo parado: lista após N dias, ignora encerrado e perícia futura", () => {
    pub(dias(90), "Vistos. Aguarde-se.");
    expect((limparMemoriaAlertas(), listarParados(60))).toHaveLength(1);
    expect((limparMemoriaAlertas(), listarParados(60))[0].dias_parado).toBe(90);
    pub(dias(80), "Certifico o trânsito em julgado.");
    expect((limparMemoriaAlertas(), listarParados(60))).toHaveLength(0);
  });
});

import { runDjenMigrations } from "../src/db/djenMigrations";
describe("migração das obrigações externas", () => {
  it("recria a tabela com o novo tipo preservando as linhas antigas", () => {
    db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES ('50000010120264030077','x')").run();
    const id = Number(db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto)
      VALUES ('mig-1','50000010120264030077','TJSP','V','C','D','I','2026-01-01','x')`).run().lastInsertRowid);
    db.exec(`DROP TABLE djen_acompanhamentos_obrigacoes;
      CREATE TABLE djen_acompanhamentos_obrigacoes (publicacao_id INTEGER NOT NULL REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK(tipo IN ('perito_laudo','perito_esclarecimentos','perito_calculos','inss_implantacao','parte_contraria')),
        status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','cobrado','resolvido')), ultima_cobranca_em TEXT, PRIMARY KEY(publicacao_id,tipo));`);
    db.prepare("INSERT INTO djen_acompanhamentos_obrigacoes(publicacao_id,tipo,status) VALUES (?,?,?)").run(id, "parte_contraria", "cobrado");
    runDjenMigrations(db);
    expect(db.prepare("SELECT tipo,status FROM djen_acompanhamentos_obrigacoes").all()).toEqual([{ tipo: "parte_contraria", status: "cobrado" }]);
    db.prepare("INSERT INTO djen_acompanhamentos_obrigacoes(publicacao_id,tipo,status) VALUES (?,?,?)").run(id, "terceiro_oficio", "pendente");
    expect(db.prepare("SELECT count(*) AS n FROM djen_acompanhamentos_obrigacoes").get()).toEqual({ n: 2 });
    db.prepare("DELETE FROM djen_publicacoes WHERE id=?").run(id);
  });
});
