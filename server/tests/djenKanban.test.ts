import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations";
import { runDjenMigrations } from "../src/db/djenMigrations";
import { concluirPublicacao } from "../src/services/djen/deadlines";
import { classificarPublicacaoParaQuadro } from "../src/services/djen/kanbanClassifier";
import {
  listarKanban, criarListaKanban, alterarListaKanban, ordenarListasKanban,
  excluirListaKanban, moverCartaoKanban, alterarInicioEsperaKanban, historicoCartaoKanban,
  ativarClassificacaoAutomatica, fixarEtapaManual,
} from "../src/services/djen/kanban";

let serial = 0;
function publicar(processo: string, data: string, texto: string) {
  db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(processo, processo);
  return Number(db.prepare(
    `INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  ).run(`kanban-${++serial}`, processo, "TRF3", "Vara", "Procedimento", "Despacho", "Intimação", data, texto).lastInsertRowid);
}
beforeEach(() => {
  db.exec("DELETE FROM djen_kanban_movimentos;DELETE FROM djen_kanban_cartoes;DELETE FROM djen_publicacao_advogados;DELETE FROM djen_prazos;DELETE FROM djen_publicacoes;DELETE FROM djen_processos;");
});

describe("evidência para etapas automáticas", () => {
  it.each([
    ["Foi recebida a petição inicial da autora.", "peticao_inicial"],
    ["Intime-se a autora para emendar a petição inicial.", "emenda_inicial"],
    ["Nomeio o perito para realizar o exame.", "perito_designado"],
    ["A perícia foi designada para 20/10/2026 às 14:00, local: Rua Central, 10.", "pericia_agendada"],
    ["Designada perícia para 20/10/2026 às 14h, na sala 4 do fórum.", "pericia_agendada"],
    ["A perícia foi realizada em 20/08/2026.", "pericia_realizada"],
    ["O laudo pericial foi juntado aos autos.", "laudo_manifestacoes"],
    ["SENTENÇA. Julgo parcialmente procedente o pedido.", "sentenca"],
    ["Foi interposto recurso de apelação pela parte autora.", "recurso"],
    ["ACÓRDÃO. ACORDAM os magistrados em dar provimento.", "acordao"],
    ["Iniciado o cumprimento de sentença.", "cumprimento_sentenca"],
    ["Intime-se o INSS para implantar o benefício em 30 dias.", "aguarda_implantacao"],
    ["Perito de cálculos intimado a apresentar cálculos.", "calculos"],
    ["Determino a expedição de RPV.", "aguarda_expedicao_rpv"],
    ["RPV expedida e enviada ao tribunal.", "rpv_expedida"],
    ["A RPV foi expedida, e o INSS deverá responder depois.", "rpv_expedida"],
  ])("identifica %s", (texto, esperado) => {
    expect(classificarPublicacaoParaQuadro(texto)?.codigo).toBe(esperado);
  });
  it.each([
    "Defiro a realização de perícia. A data e o horário serão designados oportunamente.",
    "A perícia foi designada, mas ainda não há data, horário nem local.",
    "Aguarde-se a juntada do laudo pericial.",
    "Quando o laudo for juntado, intimem-se as partes.",
    "Intime-se o perito para apresentar laudo em 15 dias.",
    "A RPV será expedida após o trânsito em julgado.",
    "Citado o acórdão anterior como precedente jurisprudencial.",
    "A sentença anterior foi mencionada pelo recorrente.",
    "O INSS ainda não implantou o benefício.",
  ])("não transforma previsão ou referência em fato: %s", (texto) => {
    expect(classificarPublicacaoParaQuadro(texto)).toBeNull();
  });
});

describe("quadro processual", () => {
  it("migra o quadro anterior preservando cartões movimentados manualmente", () => {
    const antigo = new Database(":memory:");
    try {
      runMigrations(antigo);
      antigo.exec(`
        CREATE TABLE djen_processos(chave TEXT PRIMARY KEY,numero TEXT NOT NULL,cliente_id INTEGER,observacoes TEXT NOT NULL DEFAULT '');
        CREATE TABLE djen_kanban_listas(id INTEGER PRIMARY KEY AUTOINCREMENT,nome TEXT NOT NULL COLLATE NOCASE UNIQUE,posicao INTEGER NOT NULL,contar_dias INTEGER NOT NULL DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE djen_kanban_cartoes(processo_chave TEXT PRIMARY KEY,lista_id INTEGER NOT NULL,posicao INTEGER NOT NULL DEFAULT 0,entrou_em TEXT DEFAULT CURRENT_TIMESTAMP,inicio_espera_em TEXT,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
        CREATE TABLE djen_kanban_movimentos(id INTEGER PRIMARY KEY AUTOINCREMENT,processo_chave TEXT NOT NULL,origem TEXT,destino TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
        INSERT INTO djen_kanban_listas(nome,posicao) VALUES ('A classificar',0),('Sentença',1);
        INSERT INTO djen_processos(chave,numero) VALUES ('manual-antigo','500009'),('voltou-triagem','500010');
        INSERT INTO djen_kanban_cartoes(processo_chave,lista_id) VALUES ('manual-antigo',2),('voltou-triagem',1);
        INSERT INTO djen_kanban_movimentos(processo_chave,origem,destino) VALUES ('voltou-triagem','Sentença','A classificar');
      `);
      runDjenMigrations(antigo);
      expect((antigo.prepare("SELECT modo FROM djen_kanban_cartoes WHERE processo_chave='manual-antigo'").get() as { modo: string }).modo).toBe("manual");
      expect((antigo.prepare("SELECT modo FROM djen_kanban_cartoes WHERE processo_chave='voltou-triagem'").get() as { modo: string }).modo).toBe("manual");
      expect((antigo.prepare("SELECT codigo FROM djen_kanban_listas WHERE id=2").get() as { codigo: string }).codigo).toBe("peticao_inicial");
    } finally { antigo.close(); }
  });
  it("classifica histórico, avança com novo fato e não regride por publicação genérica ou antiga", () => {
    publicar("auto-1", "2026-07-01", "Nomeio o perito para realizar o exame.");
    publicar("auto-1", "2026-08-01", "A perícia foi designada para 20/08/2026 às 14:00, local: Rua Central, 10.");
    const quadro = listarKanban();
    const agendada = quadro.listas.find((l) => l.codigo === "pericia_agendada")!;
    expect(quadro.cartoes.find((c) => c.processo_chave === "auto-1")).toMatchObject({ lista_id: agendada.id, modo: "automatico" });
    expect((db.prepare("SELECT revisar_etapa FROM djen_kanban_cartoes WHERE processo_chave='auto-1'").get() as { revisar_etapa: number }).revisar_etapa).toBe(0);
    publicar("auto-1", "2026-09-01", "Intime-se a autora para manifestação.");
    expect((db.prepare("SELECT revisar_etapa FROM djen_kanban_cartoes WHERE processo_chave='auto-1'").get() as { revisar_etapa: number }).revisar_etapa).toBe(1);
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "auto-1")!.lista_id).toBe(agendada.id);
    publicar("auto-1", "2026-09-02", "O laudo pericial foi juntado aos autos.");
    const depois = listarKanban();
    expect(depois.cartoes.find((c) => c.processo_chave === "auto-1")!.lista_id)
      .toBe(depois.listas.find((l) => l.codigo === "laudo_manifestacoes")!.id);
    publicar("auto-1", "2026-09-03", "Nomeio o perito para uma providência adicional.");
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "auto-1")!.lista_id)
      .toBe(depois.listas.find((l) => l.codigo === "laudo_manifestacoes")!.id);
    expect((historicoCartaoKanban("auto-1") as { origem_movimento: string }[]).every((item) => item.origem_movimento === "automatico")).toBe(true);
  });

  it("mantém escolha manual, mostra sugestão e permite retomar a classificação automática", () => {
    publicar("auto-2", "2026-06-01", "SENTENÇA. Julgo procedente o pedido.");
    const quadro = listarKanban();
    const recurso = quadro.listas.find((l) => l.codigo === "recurso")!;
    moverCartaoKanban("auto-2", recurso.id);
    publicar("auto-2", "2026-08-01", "Foi expedida a RPV para pagamento.");
    const manual = listarKanban().cartoes.find((c) => c.processo_chave === "auto-2")!;
    expect(manual).toMatchObject({ lista_id: recurso.id, modo: "manual", sugestao: { codigo: "rpv_expedida" } });
    ativarClassificacaoAutomatica("auto-2");
    const automatico = listarKanban().cartoes.find((c) => c.processo_chave === "auto-2")!;
    expect(automatico).toMatchObject({ lista_id: quadro.listas.find((l) => l.codigo === "rpv_expedida")!.id, modo: "automatico" });
    fixarEtapaManual("auto-2");
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "auto-2")!.modo).toBe("manual");
  });

  it("começa a espera de RPV na publicação e revê o sinal cancelado", () => {
    const id = publicar("auto-3", "2026-08-01", "Determino a expedição de RPV.");
    const rpv = listarKanban().cartoes.find((c) => c.processo_chave === "auto-3")!;
    expect(rpv).toMatchObject({ modo: "automatico", inicio_espera_em: "2026-08-01" });
    db.prepare("UPDATE djen_publicacoes SET cancelada=1 WHERE id=?").run(id);
    publicar("auto-3", "2026-09-01", "Notificação de ciência, sem nova providência.");
    const atualizado = listarKanban();
    expect(atualizado.cartoes.find((c) => c.processo_chave === "auto-3")!.lista_id)
      .toBe(atualizado.listas.find((l) => l.codigo === "triagem")!.id);
  });

  it("mantém um cartão por processo e não desloca etapas quando chega publicação nova", () => {
    publicar("500001", "2026-10-01", "Petição inicial.");
    publicar("500001", "2026-10-02", "Despacho.");
    publicar("500002", "2026-10-03", "Perícia.");
    const quadro = listarKanban();
    expect(quadro.listas[0].nome).toBe("A classificar");
    expect(quadro.listas.some((l) => l.nome === "Aguardando expedição de RPV" && l.contar_dias === 1)).toBe(true);
    expect(quadro.cartoes).toHaveLength(2);
    const sentenca = quadro.listas.find((l) => l.nome === "Sentença")!;
    moverCartaoKanban("500001", sentenca.id);
    publicar("500001", "2026-10-04", "Nova publicação do mesmo processo.");
    const atualizado = listarKanban().cartoes.find((c) => c.processo_chave === "500001")!;
    expect(atualizado.lista_id).toBe(sentenca.id);
    expect(atualizado.publicacoes_total).toBe(3);
    expect(atualizado.data_disponibilizacao).toBe("2026-10-04");
  });

  it("registra movimentos, reordena e conta dias da espera sem concluir prazo ou publicação", () => {
    const id = publicar("500003", "2026-10-01", "Aguardando expedição.");
    publicar("500004", "2026-10-02", "Outro caso.");
    db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,inicio,termino,status) VALUES (?,?,?,?,?)")
      .run(id, "Manifestação", "2026-10-02", "2026-10-30", "aberto");
    const rpv = listarKanban().listas.find((l) => l.nome === "Aguardando expedição de RPV")!;
    moverCartaoKanban("500003", rpv.id);
    moverCartaoKanban("500004", rpv.id, "500003");
    alterarInicioEsperaKanban("500003", "2026-08-01");
    expect(() => alterarInicioEsperaKanban("500003", "2999-01-01")).toThrow();
    expect(listarKanban().cartoes.filter((c) => c.lista_id === rpv.id).map((c) => c.processo_chave)).toEqual(["500004", "500003"]);
    concluirPublicacao(id, true);
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "500003")).toMatchObject({ inicio_espera_em: "2026-08-01", prazos_abertos: 1 });
    expect(historicoCartaoKanban("500003")).toMatchObject([{ origem: "A classificar", destino: "Aguardando expedição de RPV" }]);
    expect((db.prepare("SELECT concluida FROM djen_publicacoes WHERE id=?").get(id) as { concluida: number }).concluida).toBe(1);
  });

  it("permite criar, editar, ordenar e excluir somente listas vazias", () => {
    publicar("500005", "2026-10-01", "Proposta de acordo.");
    const quadro = listarKanban();
    const criada = criarListaKanban({ nome: "Proposta de acordo", contar_dias: true }) as { id: number; contar_dias: number };
    expect(criada.contar_dias).toBe(1);
    alterarListaKanban(criada.id, { nome: "Acordo em negociação", contar_dias: false });
    const ids = listarKanban().listas.map((l) => l.id);
    ordenarListasKanban([criada.id, ...ids.filter((id) => id !== criada.id)]);
    expect(listarKanban().listas[0].id).toBe(criada.id);
    publicar("500006", "2026-10-02", "Nova publicação.");
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "500006")!.lista_id).toBe(quadro.listas[0].id);
    moverCartaoKanban("500005", criada.id);
    expect(() => excluirListaKanban(criada.id)).toThrow(/Mova/);
    moverCartaoKanban("500005", quadro.listas[0].id);
    expect(excluirListaKanban(criada.id)).toEqual({ ok: true });
    expect(() => excluirListaKanban(quadro.listas[0].id)).toThrow(/triagem/);
    expect(() => criarListaKanban({ nome: quadro.listas[0].nome })).toThrow(/Já existe/);
  });
});
