import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import Database from "better-sqlite3";
import { runMigrations } from "../src/db/migrations";
import { runDjenMigrations } from "../src/db/djenMigrations";
import { concluirPublicacao } from "../src/services/djen/deadlines";
import { revisarPublicacao } from "../src/services/djen/store";
import { classificarPublicacaoParaQuadro, classificarPublicacaoComHistorico } from "../src/services/djen/kanbanClassifier";
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
  db.exec("DELETE FROM djen_kanban_listas WHERE codigo IS NULL;UPDATE djen_kanban_listas SET posicao=CASE WHEN codigo='distribuicao' THEN 2 WHEN id<=2 THEN id-1 ELSE id END;");
});

describe("evidência para etapas automáticas", () => {
  it("reaproveita acórdão comprovado na análise anterior sem executar Codex novamente", () => {
    const texto = "Turma Recursal, por unanimidade, deu provimento ao recurso da autora.";
    expect(classificarPublicacaoComHistorico({ texto, categorias_json: '["acordao"]', evidencias_json: JSON.stringify([{ categoria: "acordao", trecho: texto }]) })).toMatchObject({ codigo: "acordao" });
    expect(classificarPublicacaoComHistorico({ texto: "Citado o acórdão anterior.", categorias_json: '["acordao"]', evidencias_json: JSON.stringify([{ categoria: "acordao", trecho: texto }]) })).toBeNull();
    const extincao = "Certificada a extinção definitiva do processo após o pagamento.";
    expect(classificarPublicacaoComHistorico({ texto: extincao, categorias_json: '["extincao_processo"]', evidencias_json: JSON.stringify([{ categoria: "extincao_processo", trecho: extincao }]) })?.codigo).toBe("concluido");
  });
  it.each([
    ["Foi recebida a petição inicial da autora.", "peticao_inicial"],
    ["Processo distribuído à 4ª Vara Federal.", "distribuicao"],
    ["A apelação foi distribuída à 17ª Câmara de Direito Público.", "recurso"],
    ["Intime-se a autora para emendar a petição inicial.", "emenda_inicial"],
    ["Nomeio o perito para realizar o exame.", "perito_designado"],
    ["Juntada de manifestação do perito nos autos.", "perito_designado"],
    ["Juntada de manifestação do perito sobre o laudo complementar.", "laudo_manifestacoes"],
    ["A perícia foi designada para 20/10/2026 às 14:00, local: Rua Central, 10.", "pericia_agendada"],
    ["Designada perícia para 20/10/2026 às 14h, na sala 4 do fórum.", "pericia_agendada"],
    ["A perícia foi realizada em 20/08/2026.", "pericia_realizada"],
    ["O laudo pericial foi juntado aos autos.", "laudo_manifestacoes"],
    ["SENTENÇA. Julgo parcialmente procedente o pedido.", "sentenca"],
    ["Foi interposto recurso de apelação pela parte autora.", "recurso"],
    ["ACÓRDÃO. ACORDAM os magistrados em dar provimento.", "acordao"],
    ["Iniciado o cumprimento de sentença.", "cumprimento_sentenca"],
    ["Intime-se o INSS para implantar o benefício em 30 dias.", "aguarda_implantacao"],
    ["Implantação ou revisão de benefício determinada no cumprimento de sentença.", "aguarda_implantacao"],
    ["Perito de cálculos intimado a apresentar cálculos.", "calculos"],
    ["Determino a expedição de RPV.", "aguarda_expedicao_rpv"],
    ["RPV expedida e enviada ao tribunal.", "rpv_expedida"],
    ["A RPV foi expedida, e o INSS deverá responder depois.", "rpv_expedida"],
    ["Extinção anotada · autos arquivados.", "concluido"],
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
    "Após a extinção, os autos serão arquivados.",
    "A apelação será distribuída oportunamente.",
  ])("não transforma previsão ou referência em fato: %s", (texto) => {
    expect(classificarPublicacaoParaQuadro(texto)).toBeNull();
  });
  it("usa a classe do processo com ato literal para distinguir cálculos e cumprimento", () => {
    expect(classificarPublicacaoComHistorico({
      texto: "Exequente intimada a se manifestar sobre impugnação.", classe: "Cumprimento de sentença",
      categorias_json: "[]", evidencias_json: "[]",
    })?.codigo).toBe("cumprimento_sentenca");
    expect(classificarPublicacaoComHistorico({
      texto: "Executados intimados a se manifestar sobre cálculos.", classe: "Cumprimento de sentença",
      categorias_json: "[]", evidencias_json: "[]",
    })?.codigo).toBe("calculos");
    expect(classificarPublicacaoComHistorico({
      texto: "Aguarde-se o prazo de cálculo, sem nova intimação.", classe: "Cumprimento de sentença",
      categorias_json: "[]", evidencias_json: "[]",
    })).toBeNull();
  });
});

describe("quadro processual", () => {
  it("corrigir uma classificação humana tira o card da triagem sem depender de evidência antiga da IA", () => {
    const id = publicar("revisao-sem-prova", "2026-10-01", "Decisão com redação atípica disponível para revisão.");
    const primeiro = listarKanban();
    expect(primeiro.cartoes[0].lista_id).toBe(primeiro.listas.find((l) => l.codigo === "triagem")!.id);
    revisarPublicacao(id, { categorias: ["acordao"], resultado: "nao_identificado" });
    const depois = listarKanban();
    expect(depois.cartoes[0]).toMatchObject({ lista_id: depois.listas.find((l) => l.codigo === "acordao")!.id, etapa_publicacao_id: id });
    revisarPublicacao(id, { categorias: ["sentenca"], resultado: "procedente" });
    expect(listarKanban().cartoes[0].lista_id).toBe(depois.listas.find((l) => l.codigo === "sentenca")!.id);
  });
  it("usa revisão humana em listas personalizadas e respeita a remoção de uma categoria", () => {
    const texto = "Sentença proferida. O INSS apresentou proposta de acordo nos autos.";
    const id = publicar("revisao-custom", "2026-10-01", texto);
    const lista = criarListaKanban({ nome: "Negociar acordo", regra_categoria: "proposta_acordo" }) as { id: number };
    revisarPublicacao(id, { categorias: ["proposta_acordo"], resultado: "nao_identificado" });
    expect(listarKanban().cartoes[0].lista_id).toBe(lista.id);
    revisarPublicacao(id, { categorias: [], resultado: "nao_identificado" });
    const quadro = listarKanban();
    expect(quadro.cartoes[0].lista_id).toBe(quadro.listas.find((l) => l.codigo === "triagem")!.id);
  });
  it("reaproveita a categoria de perícia validada pelo Codex mesmo com local em outra publicação", () => {
    const texto = "A perícia médica foi remarcada para 22/10/2026, às 10h, mantidas as demais orientações.";
    const id = publicar("pericia-codex", "2026-10-01", texto);
    db.prepare("UPDATE djen_publicacoes SET categorias_json=?,evidencias_json=? WHERE id=?")
      .run('["pericia"]', JSON.stringify([{ categoria: "pericia", trecho: texto }]), id);
    const quadro = listarKanban();
    expect(quadro.cartoes[0].lista_id).toBe(quadro.listas.find((l) => l.codigo === "pericia_agendada")!.id);
    db.prepare("UPDATE djen_publicacoes SET evidencias_json='[]' WHERE id=?").run(id);
    expect(listarKanban().cartoes[0].lista_id).toBe(quadro.listas.find((l) => l.codigo === "triagem")!.id);
  });
  it("valida destinos e reposiciona cartões sem afetar prazos ou publicações", () => {
    publicar("mover-a", "2026-10-01", "Ciência.");
    publicar("mover-b", "2026-10-01", "Ciência.");
    const quadro = listarKanban();
    const sentenca = quadro.listas.find((l) => l.codigo === "sentenca")!;
    moverCartaoKanban("mover-a", sentenca.id);
    moverCartaoKanban("mover-b", sentenca.id, "mover-a");
    expect(listarKanban().cartoes.filter((c) => c.lista_id === sentenca.id).map((c) => c.processo_chave)).toEqual(["mover-b", "mover-a"]);
    expect(() => moverCartaoKanban("mover-a", -1)).toThrow();
    expect(() => moverCartaoKanban("mover-a", quadro.listas[0].id, "mover-b")).toThrow();
    expect(() => moverCartaoKanban("ausente", sentenca.id)).toThrow();
  });
  it("classifica lista personalizada pela categoria já verificada do DJEN e avança com publicação posterior", () => {
    const texto = "O INSS apresentou proposta de acordo nos autos.";
    const id = publicar("acordo-custom", "2026-07-01", texto);
    db.prepare("UPDATE djen_publicacoes SET categorias_json=?,evidencias_json=? WHERE id=?")
      .run('["proposta_acordo"]', JSON.stringify([{ categoria: "proposta_acordo", trecho: texto }]), id);
    const lista = criarListaKanban({ nome: "Proposta de acordo", regra_categoria: "proposta_acordo" }) as { id: number };
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "acordo-custom")!.lista_id).toBe(lista.id);
    publicar("acordo-custom", "2026-08-01", "SENTENÇA. Julgo procedente o pedido da autora.");
    const quadro = listarKanban();
    expect(quadro.cartoes.find((c) => c.processo_chave === "acordo-custom")!.lista_id)
      .toBe(quadro.listas.find((l) => l.codigo === "sentenca")!.id);
  });
  it("migra e reavalia o quadro anterior sem apagar escolhas manuais", () => {
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
      expect((antigo.prepare("SELECT modo,revisar_etapa FROM djen_kanban_cartoes WHERE processo_chave='manual-antigo'").get() as { modo: string; revisar_etapa: number })).toMatchObject({ modo: "manual", revisar_etapa: 1 });
      expect((antigo.prepare("SELECT modo FROM djen_kanban_cartoes WHERE processo_chave='voltou-triagem'").get() as { modo: string }).modo).toBe("manual");
      expect((antigo.prepare("SELECT codigo FROM djen_kanban_listas WHERE id=2").get() as { codigo: string }).codigo).toBe("peticao_inicial");
      expect((antigo.prepare("SELECT nome FROM djen_kanban_listas WHERE codigo='distribuicao'").get() as { nome: string }).nome).toBe("Distribuição");
      antigo.exec("UPDATE djen_kanban_meta SET valor='2.48.0' WHERE chave='classificador';UPDATE djen_kanban_cartoes SET modo='manual',revisar_etapa=0");
      runDjenMigrations(antigo);
      expect((antigo.prepare("SELECT modo,revisar_etapa FROM djen_kanban_cartoes WHERE processo_chave='manual-antigo'").get() as { modo: string; revisar_etapa: number }))
        .toMatchObject({ modo: "manual", revisar_etapa: 1 });
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
  it("reclassifica publicações antigas quando se acrescenta a etapa Distribuição", () => {
    publicar("fase-distribuicao", "2026-09-01", "Petição inicial protocolada.");
    publicar("fase-distribuicao", "2026-09-03", "Processo distribuído à 4ª Vara Federal.");
    const quadro = listarKanban();
    expect(quadro.cartoes.find((c) => c.processo_chave === "fase-distribuicao")!.lista_id)
      .toBe(quadro.listas.find((l) => l.codigo === "distribuicao")!.id);
    expect(quadro.listas.findIndex((l) => l.codigo === "distribuicao"))
      .toBe(quadro.listas.findIndex((l) => l.codigo === "peticao_inicial") + 1);
  });

  it("mantém a etapa manual, mostra a sugestão e volta ao automático somente quando solicitado", () => {
    publicar("auto-2", "2026-06-01", "SENTENÇA. Julgo procedente o pedido.");
    const quadro = listarKanban();
    const recurso = quadro.listas.find((l) => l.codigo === "recurso")!;
    moverCartaoKanban("auto-2", recurso.id);
    publicar("auto-2", "2026-08-01", "Foi expedida a RPV para pagamento.");
    const manual = listarKanban().cartoes.find((c) => c.processo_chave === "auto-2")!;
    expect(manual).toMatchObject({ lista_id: recurso.id, modo: "manual", sugestao: { codigo: "rpv_expedida" } });
    expect(fixarEtapaManual("auto-2")).toEqual({ ok: true });
    expect(ativarClassificacaoAutomatica("auto-2")).toEqual({ ok: true });
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "auto-2")!).toMatchObject({
      lista_id: quadro.listas.find((l) => l.codigo === "rpv_expedida")!.id, modo: "automatico",
    });
    expect(historicoCartaoKanban("auto-2")).toEqual(expect.arrayContaining([expect.objectContaining({ origem_movimento: "manual", destino: recurso.nome })]));
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
    expect(quadro.listas[0].nome).toBe("Sem etapa identificada");
    expect(quadro.listas.some((l) => l.nome === "Aguardando expedição de RPV" && l.contar_dias === 1)).toBe(true);
    expect(quadro.cartoes).toHaveLength(2);
    const sentenca = quadro.listas.find((l) => l.nome === "Sentença")!;
    db.prepare("UPDATE djen_kanban_cartoes SET lista_id=?,modo='manual',etapa_publicacao_id=NULL,revisar_etapa=1 WHERE processo_chave=?").run(sentenca.id, "500001");
    publicar("500001", "2026-10-04", "Nova publicação do mesmo processo.");
    const atualizado = listarKanban().cartoes.find((c) => c.processo_chave === "500001")!;
    expect(atualizado.lista_id).toBe(sentenca.id);
    expect(atualizado.publicacoes_total).toBe(3);
    expect(atualizado.data_disponibilizacao).toBe("2026-10-04");
  });

  it("registra movimentos, reordena e conta dias da espera sem concluir prazo ou publicação", () => {
    const id = publicar("500003", "2026-10-01", "Determino a expedição de RPV.");
    publicar("500004", "2026-10-02", "Determino a expedição de RPV.");
    db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,inicio,termino,status) VALUES (?,?,?,?,?)")
      .run(id, "Manifestação", "2026-10-02", "2026-10-30", "aberto");
    const rpv = listarKanban().listas.find((l) => l.nome === "Aguardando expedição de RPV")!;
    expect(listarKanban().cartoes.filter((c) => c.lista_id === rpv.id)).toHaveLength(2);
    alterarInicioEsperaKanban("500003", "2026-08-01");
    expect(() => alterarInicioEsperaKanban("500003", "2999-01-01")).toThrow();
    expect(listarKanban().cartoes.filter((c) => c.lista_id === rpv.id)).toHaveLength(2);
    concluirPublicacao(id, true);
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "500003")).toMatchObject({ inicio_espera_em: "2026-08-01", prazos_abertos: 1 });
    expect(historicoCartaoKanban("500003")).toMatchObject([{ origem: "Sem etapa identificada", destino: "Aguardando expedição de RPV" }]);
    expect((db.prepare("SELECT concluida FROM djen_publicacoes WHERE id=?").get(id) as { concluida: number }).concluida).toBe(1);
  });

  it("permite criar, editar, ordenar e excluir somente listas vazias", () => {
    publicar("500005", "2026-10-01", "Proposta de acordo.");
    const quadro = listarKanban();
    const criada = criarListaKanban({ nome: "Proposta de acordo", contar_dias: true, regra_categoria: "proposta_acordo" }) as { id: number; contar_dias: number };
    expect(criada.contar_dias).toBe(1);
    alterarListaKanban(criada.id, { nome: "Acordo em negociação", contar_dias: false, regra_categoria: "proposta_acordo" });
    const ids = listarKanban().listas.map((l) => l.id);
    ordenarListasKanban([criada.id, ...ids.filter((id) => id !== criada.id)]);
    expect(listarKanban().listas[0].id).toBe(criada.id);
    publicar("500006", "2026-10-02", "Nova publicação.");
    expect(listarKanban().cartoes.find((c) => c.processo_chave === "500006")!.lista_id).toBe(quadro.listas[0].id);
    db.prepare("UPDATE djen_kanban_cartoes SET lista_id=? WHERE processo_chave=?").run(criada.id, "500005");
    expect(() => excluirListaKanban(criada.id)).toThrow(/Mova/);
    db.prepare("UPDATE djen_kanban_cartoes SET lista_id=? WHERE processo_chave=?").run(quadro.listas[0].id, "500005");
    expect(excluirListaKanban(criada.id)).toEqual({ ok: true });
    expect(() => excluirListaKanban(quadro.listas[0].id)).toThrow(/triagem/);
    expect(() => criarListaKanban({ nome: quadro.listas[0].nome, regra_categoria: "proposta_acordo" })).toThrow(/Já existe/);
  });
});

