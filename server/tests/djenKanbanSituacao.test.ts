import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations";
import { runDjenMigrations } from "../src/db/djenMigrations";
import { classificarPublicacaoParaQuadro } from "../src/services/djen/kanbanClassifier";
import { listarKanban, reclassificarKanban, moverCartoesLoteKanban, moverCartaoKanban } from "../src/services/djen/kanban";

const hojeSP = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const dias = (n: number) => new Date(Date.parse(`${hojeSP()}T12:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
let serial = 0;
function publicar(processo: string, data: string, texto: string) {
  db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(processo, processo);
  return Number(db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(`ks-${++serial}`, processo, "TJZZ", "Vara", "Procedimento", "Despacho", "Intimação", data, texto).lastInsertRowid);
}
const lista = (codigo: string) => listarKanban().listas.find((l) => l.codigo === codigo)!;
const codigoDe = (processo: string) => {
  const q = listarKanban();
  const c = q.cartoes.find((x) => x.processo_chave === processo)!;
  return q.listas.find((l) => l.id === c.lista_id)!.codigo;
};
beforeEach(() => {
  db.exec("DELETE FROM djen_kanban_movimentos;DELETE FROM djen_kanban_cartoes;DELETE FROM djen_prazos_escritorio_estado;DELETE FROM djen_prazos;DELETE FROM djen_publicacao_advogados;DELETE FROM djen_publicacoes;DELETE FROM djen_processos;");
});

describe("etapas literais novas", () => {
  it.each([
    ["Recebo a inicial. Cite-se o INSS para contestar a ação.", "citacao_contestacao"],
    ["Designo audiência de instrução para 10/12/2026, às 14h.", "audiencia"],
    ["Certifico o trânsito em julgado da sentença.", "transito_julgado"],
    ["Os autos estão conclusos para sentença.", "conclusos_sentenca"],
    ["Homologo o acordo celebrado entre as partes.", "acordo"],
    ["O INSS apresentou proposta de acordo nos autos.", "acordo"],
  ])("%s → %s", (texto, esperado) => {
    expect(classificarPublicacaoParaQuadro(texto)?.codigo).toBe(esperado);
  });
  it("hipótese e pedido não criam etapa", () => {
    expect(classificarPublicacaoParaQuadro("Caso necessário, designarei audiência.")).toBeNull();
    expect(classificarPublicacaoParaQuadro("Após o trânsito em julgado, arquivem-se.")).toBeNull();
    expect(classificarPublicacaoParaQuadro("Aguarde-se. Quando conclusos para sentença, voltem.")).toBeNull();
  });
});

describe("situação quando não há etapa processual provada", () => {
  it("ordem vigente do escritório → Providência do escritório", () => {
    publicar("p-escritorio", dias(10), "Intime-se a parte autora para manifestar-se no prazo de 10 (dez) dias.");
    expect(codigoDe("p-escritorio")).toBe("prov_escritorio");
  });
  it("ordem cumprida deixa de ser providência do escritório", () => {
    publicar("p-cumprida", dias(20), "Intime-se a parte autora para manifestar-se no prazo de 10 (dez) dias.");
    publicar("p-cumprida", dias(5), "Juntada de manifestação da parte autora.");
    expect(codigoDe("p-cumprida")).toBe("aguarda_juizo");
  });
  it("ordem ao INSS sem resposta → Aguardando outra parte / terceiros; resposta posterior libera", () => {
    publicar("p-inss", dias(10), "Intime-se o INSS para apresentar contestação no prazo de 30 dias.");
    expect(codigoDe("p-inss")).toBe("aguarda_terceiros");
    publicar("p-inss", dias(2), "Contestação apresentada pelo INSS.");
    expect(codigoDe("p-inss")).toBe("citacao_contestacao");
  });
  it("ofício a terceiro sem resposta → Aguardando outra parte / terceiros", () => {
    publicar("p-oficio", dias(10), "Oficie-se à empresa Alfa Ltda., para apresentar o PPP no prazo de 15 dias.");
    expect(codigoDe("p-oficio")).toBe("aguarda_terceiros");
  });
  it("processo suspenso → Sobrestado", () => {
    publicar("p-susp", dias(10), "Suspendo o processo pelo prazo de 90 dias, aguardando o julgamento do tema repetitivo.");
    expect(codigoDe("p-susp")).toBe("sobrestado");
  });
  it("sem ordem alguma → Aguardando juízo, com evidência explicativa", () => {
    publicar("p-livre", dias(3), "Vistos. Aguarde-se.");
    const q = listarKanban();
    const c = q.cartoes.find((x) => x.processo_chave === "p-livre")!;
    expect(q.listas.find((l) => l.id === c.lista_id)!.codigo).toBe("aguarda_juizo");
    expect(c.etapa_evidencia).toMatch(/sem ordem pendente/);
  });
  it("etapa real prevalece sobre a situação e a situação é superada por etapa nova", () => {
    publicar("p-real", dias(30), "Vistos. Aguarde-se.");
    expect(codigoDe("p-real")).toBe("aguarda_juizo");
    publicar("p-real", dias(1), "Designo audiência de instrução para 10/12/2026, às 14h.");
    expect(codigoDe("p-real")).toBe("audiencia");
  });
});

describe("reclassificação e movimentação em lote", () => {
  it("reclassificar não move cartões manuais e informa a triagem", () => {
    publicar("m-1", dias(3), "Vistos. Aguarde-se.");
    publicar("m-2", dias(3), "Vistos. Aguarde-se.");
    listarKanban();
    moverCartaoKanban("m-1", lista("sentenca").id);
    const r = reclassificarKanban();
    expect(r).toMatchObject({ triagem_depois: 0 });
    expect(codigoDe("m-1")).toBe("sentenca");
  });
  it("move vários processos para a mesma lista como escolha manual", () => {
    publicar("l-1", dias(3), "Vistos."); publicar("l-2", dias(3), "Vistos."); publicar("l-3", dias(3), "Vistos.");
    listarKanban();
    expect(moverCartoesLoteKanban(["l-1", "l-2"], lista("recurso").id)).toEqual({ ok: true, movidos: 2 });
    const q = listarKanban();
    expect(q.cartoes.filter((c) => c.lista_id === lista("recurso").id && c.modo === "manual").map((c) => c.processo_chave).sort()).toEqual(["l-1", "l-2"]);
    expect(() => moverCartoesLoteKanban([], lista("recurso").id)).toThrow();
    expect(() => moverCartoesLoteKanban(["l-1"], "x")).toThrow();
  });
  it("as listas novas existem na ordem esperada em um banco novo", () => {
    const novo = new Database(":memory:");
    try {
      runMigrations(novo);
      runDjenMigrations(novo);
      const codigos = (novo.prepare("SELECT codigo FROM djen_kanban_listas ORDER BY posicao,id").all() as { codigo: string }[]).map((l) => l.codigo);
      expect(codigos.slice(0, 5)).toEqual(["triagem", "aguarda_juizo", "sobrestado", "aguarda_terceiros", "prov_escritorio"]);
      expect(codigos.indexOf("citacao_contestacao")).toBe(codigos.indexOf("emenda_inicial") + 1);
      expect(codigos.indexOf("transito_julgado")).toBe(codigos.indexOf("acordao") + 1);
      expect(codigos.indexOf("conclusos_sentenca")).toBe(codigos.indexOf("laudo_manifestacoes") + 1);
      // Idempotente: reexecutar não duplica listas.
      const total = codigos.length;
      runDjenMigrations(novo);
      expect((novo.prepare("SELECT COUNT(*) AS n FROM djen_kanban_listas").get() as { n: number }).n).toBe(total);
    } finally { novo.close(); }
  });
});
