import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import Database from "better-sqlite3";
import { runDjenMigrations } from "../src/db/djenMigrations";
const mocked = vi.hoisted(() => ({
  analisarComCodex: vi.fn(),
  analisarLoteComCodex: vi.fn(),
}));
vi.mock("../src/services/djen/codexRunner", () => ({
  ...mocked,
  ErroPublicacaoCodex: class extends Error {},
  ErroModeloCodex: class extends Error {},
  PERFIS_CODEX: {
    economico: { modo: "economico", modelo: "gpt-6-luna", esforco: "low" },
    equilibrado: { modo: "equilibrado", modelo: "gpt-6.1-sol", esforco: "low" },
    precisao: { modo: "precisao", modelo: "gpt-6.1-sol", esforco: "medium" },
  },
}));
import { db } from "../src/db";
import {
  validarAnaliseCodex,
  ErroAnaliseCodex,
  type AnaliseCodex,
  type CategoriaDjen,
} from "../src/services/djen/classifier";
import {
  importarPublicacoes,
  salvarAdvogado,
  listarPublicacoes,
  revisarPublicacao,
  detalhesPublicacao,
  salvarConfiguracaoDjen,
  configuracaoDjen,
  listarAndamentosDoProcesso,
} from "../src/services/djen/store";
import { normalizarPublicacao } from "../src/services/djen/api";
import {
  salvarPrazo,
  excluirPrazo,
  adicionarDocumento,
  excluirDocumento,
} from "../src/services/djen/workflow";
import {
  iniciarMonitorCodex,
  pararMonitorCodex,
  processarFilaCodex,
  statusAnalisesCodex,
} from "../src/services/djen/codexAnalysis";
const analysis = (
  texto: string,
  categorias: CategoriaDjen[],
  resultado: AnaliseCodex["resultado"] = "nao_identificado",
): AnaliseCodex => ({
  categorias,
  resultado,
  resumo: "Resumo da publicação.",
  situacao: "Situação detalhada",
  justificativa: "Evidência explícita.",
  evidencias: categorias.map((categoria) => ({ categoria, trecho: texto })),
  agendamento: { data: null, horario: null, local: null },
  providencia: {
    tipo: "ciencia",
    descricao: null,
    prazo_texto: null,
    responsavel: "indeterminado",
  },
  alertas: [],
});
function seed(n = 1) {
  const a = salvarAdvogado({
    nome: "ADVOGADO EXPANSAO",
    numero_oab: "123456",
    uf_oab: "SP",
  });
  const pubs = Array.from({ length: n }, (_, i) =>
    normalizarPublicacao({
      id: 5000 + i,
      numero_processo: "50012341120268260001",
      data_disponibilizacao: "2026-10-20",
      siglaTribunal: "TJSP",
      nomeClasse: "Procedimento Comum",
      nomeOrgao: "Vara",
      tipoDocumento: "Intimação",
      tipoComunicacao: "Intimação",
      texto: `Publicação de teste número ${i}.`,
      destinatarios: [],
      destinatarioadvogados: [
        {
          advogado: {
            nome: a.nome,
            numero_oab: a.numero_oab,
            uf_oab: a.uf_oab,
          },
        },
      ],
    }),
  );
  importarPublicacoes(pubs, a, "oab");
  return listarPublicacoes({})
    .items.map((p) => Number(p.id))
    .sort((a, b) => a - b);
}
beforeEach(() => {
  db.exec(
    "DELETE FROM djen_mensagens;DELETE FROM djen_publicacao_advogados;DELETE FROM djen_publicacoes;DELETE FROM djen_processos;DELETE FROM djen_advogados;DELETE FROM djen_analise_cache;DELETE FROM djen_codex_execucoes;UPDATE djen_config SET ia_ativa=0,ia_pausa=NULL,ia_paralelismo=2,ia_modo='economico'",
  );
  mocked.analisarComCodex.mockReset();
  mocked.analisarLoteComCodex.mockReset();
  iniciarMonitorCodex();
});
afterEach(() => pararMonitorCodex());
describe("atualização de banco existente", () => {
  it("refaz análises antigas sem revisão, preserva revisão humana e aplica a migração uma vez", () => {
    const banco = new Database(":memory:");
    try {
      banco.exec("CREATE TABLE contacts(id INTEGER PRIMARY KEY)");
      runDjenMigrations(banco);
      banco.exec(`
        INSERT INTO djen_processos(chave,numero) VALUES ('p','123');
        INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto,categorias_json,revisada,ia_status,ia_json)
          VALUES ('1','p','TJSP','Vara','RPV','Sentença','Intimação','2026-10-20','Texto original','["sentenca"]',0,'concluida','{}'),
                 ('2','p','TJSP','Vara','RPV','Sentença','Intimação','2026-10-20','Texto revisado','["rpv"]',1,'concluida','{}');
        ALTER TABLE djen_publicacoes DROP COLUMN ia_versao;
        ALTER TABLE djen_publicacoes DROP COLUMN ia_duracao_ms;
        ALTER TABLE djen_publicacoes DROP COLUMN ia_iniciada_em;
        ALTER TABLE djen_publicacoes DROP COLUMN situacao;
        ALTER TABLE djen_config DROP COLUMN ia_paralelismo;
        ALTER TABLE djen_config DROP COLUMN ia_modo;
      `);
      runDjenMigrations(banco);
      const rows = () =>
        banco
          .prepare(
            "SELECT comunicacao_id,categorias_json,revisada,ia_status,ia_json,texto FROM djen_publicacoes ORDER BY id",
          )
          .all();
      expect(rows()).toMatchObject([
        {
          comunicacao_id: "1",
          categorias_json: "[]",
          revisada: 0,
          ia_status: "pendente",
          ia_json: null,
          texto: "Texto original",
        },
        {
          comunicacao_id: "2",
          categorias_json: '["rpv"]',
          revisada: 1,
          ia_status: "concluida",
          ia_json: "{}",
          texto: "Texto revisado",
        },
      ]);
      banco.exec(
        "UPDATE djen_publicacoes SET categorias_json='[\"rpv\"]',ia_status='concluida' WHERE comunicacao_id='1'",
      );
      const antes = rows();
      runDjenMigrations(banco);
      expect(rows()).toEqual(antes);
      expect(
        banco.prepare("SELECT ia_paralelismo,ia_modo FROM djen_config").get(),
      ).toEqual({ ia_paralelismo: 2, ia_modo: "economico" });
    } finally {
      banco.close();
    }
  });
});
describe("casos apresentados pelo escritório", () => {
  it("RPV com execução extinta não entra no filtro de sentença de mérito", () => {
    const texto =
      "Requisição de Pequeno Valor. A credora declarou satisfeita a execução. JULGO EXTINTA a presente fase da execução. Expeça-se mandado de levantamento.";
    const r = validarAnaliseCodex(analysis(texto, ["sentenca"]), texto, {
      classe: "Requisição de Pequeno Valor",
    });
    expect(r.categorias).toContain("rpv");
    expect(r.categorias).toContain("extincao_execucao");
    expect(r.categorias).not.toContain("sentenca");
  });
  it("homologação de acordo tem categoria própria mesmo formalizada por sentença", () => {
    const texto = "SENTENÇA. HOMOLOGO o acordo entabulado pelas partes.";
    const r = validarAnaliseCodex(analysis(texto, ["sentenca"]), texto);
    expect(r.categorias).toContain("homologacao_acordo");
    expect(r.categorias).not.toContain("sentenca");
    expect(r.resultado).toBe("nao_identificado");
  });
  it("parcialmente procedente global prevalece sobre improcedência de dano moral", () => {
    const texto =
      "JULGO PARCIALMENTE PROCEDENTES os pedidos deduzidos na petição inicial. JULGO IMPROCEDENTE o pedido de indenização por danos morais.";
    const a = analysis(texto, ["sentenca"]);
    a.evidencias = [
      {
        categoria: "sentenca",
        trecho:
          "JULGO PARCIALMENTE PROCEDENTES os pedidos deduzidos na petição inicial",
      },
      {
        categoria: "sentenca",
        trecho: "JULGO IMPROCEDENTE o pedido de indenização por danos morais.",
      },
    ];
    expect(validarAnaliseCodex(a, texto).resultado).toBe("parcial");
  });
  it("previsão futura de RPV não muda sentença de mérito para fase de RPV", () => {
    const texto =
      "SENTENÇA. Julgo procedente o pedido. Após o trânsito em julgado, haverá requisição de pequeno valor.";
    expect(
      validarAnaliseCodex(
        analysis(texto, ["sentenca", "rpv"], "procedente"),
        texto,
        {
          classe: "Procedimento comum",
        },
      ).categorias,
    ).toEqual(["sentenca"]);
  });
  it("extinção sem mérito não recebe procedência de pedidos", () => {
    const texto = "SENTENÇA. JULGO EXTINTO o processo sem resolução do mérito.";
    const r = validarAnaliseCodex(analysis(texto, ["sentenca"]), texto);
    expect(r.categorias).toContain("extincao_processo");
    expect(r.categorias).not.toContain("sentenca");
  });
});
describe("filtros e acompanhamento independente", () => {
  it("aceita várias categorias e resultados sem duplicar as publicações", () => {
    const ids = seed(3);
    revisarPublicacao(ids[0], {
      categorias: ["rpv", "extincao_execucao"],
      resultado: "nao_identificado",
    });
    revisarPublicacao(ids[1], {
      categorias: ["sentenca"],
      resultado: "parcial",
    });
    expect(listarPublicacoes({ categoria: "rpv,sentenca" }).total).toBe(2);
    expect(listarPublicacoes({ categoria: "rpv,outros" }).total).toBe(2);
    expect(
      listarPublicacoes({
        categoria: "rpv,sentenca",
        resultado: "parcial,procedente",
      }).total,
    ).toBe(1);
    expect(() =>
      listarPublicacoes({ categoria: "sentenca,nao_existe" }),
    ).toThrow();
  });
  it("salva início, término, conclusão e histórico sem alterar o calendário de perícias", () => {
    const [id, outro] = seed(2);
    const tables = [
      "pericias_agendadas",
      "send_logs",
      "pending_replies",
      "google_calendar_event_links",
    ];
    const counts = () =>
      tables.map((t) => db.prepare(`SELECT count(*) AS n FROM ${t}`).get());
    const antes = counts();
    const prazoId = salvarPrazo(id, {
      descricao: "Manifestação",
      inicio: "2026-10-21",
      termino: "2026-11-05",
      status: "aberto",
      observacoes: "Datas conferidas pelo escritório",
    });
    expect(detalhesPublicacao(id).prazos).toMatchObject([
      { inicio: "2026-10-21", termino: "2026-11-05" },
    ]);
    expect(listarPublicacoes({ situacao: "com_prazo" }).total).toBe(1);
    expect(() =>
      salvarPrazo(
        outro,
        {
          descricao: "Outro",
          inicio: "2026-10-21",
          termino: "2026-11-05",
          observacoes: "",
        },
        prazoId,
      ),
    ).toThrow();
    expect(() =>
      salvarPrazo(id, {
        descricao: "Inválido",
        inicio: "2026-11-05",
        termino: "2026-10-21",
        observacoes: "",
      }),
    ).toThrow();
    salvarPrazo(
      id,
      {
        descricao: "Manifestação",
        inicio: "2026-10-21",
        termino: "2026-11-05",
        status: "concluido",
        observacoes: "Protocolado",
      },
      prazoId,
    );
    expect(listarPublicacoes({ situacao: "com_prazo" }).total).toBe(0);
    excluirPrazo(id, prazoId);
    expect(detalhesPublicacao(id).historico.length).toBeGreaterThanOrEqual(3);
    expect(counts()).toEqual(antes);
  });
  it("vincula documentos HTTPS e rejeita links executáveis ou com credenciais", () => {
    const [id, outro] = seed(2);
    const doc = adicionarDocumento(id, {
      nome: "Sentença integral",
      url: "https://tribunal.example/arquivo.pdf",
    });
    expect(detalhesPublicacao(id).documentos).toMatchObject([
      { nome: "Sentença integral" },
    ]);
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "https://usuario:senha@tribunal.example/a",
    ])
      expect(() =>
        adicionarDocumento(id, { nome: "Documento", url }),
      ).toThrow();
    expect(() => excluirDocumento(outro, doc)).toThrow();
    excluirDocumento(id, doc);
    expect(detalhesPublicacao(id).documentos).toEqual([]);
  });
  it("pagina o histórico além das primeiras 25 publicações", () => {
    const [id] = seed(32);
    expect(listarAndamentosDoProcesso(id).items).toHaveLength(25);
    expect(listarAndamentosDoProcesso(id, 2).items).toHaveLength(7);
    expect(detalhesPublicacao(id).relacionadas_total).toBe(32);
  });
  it("valida e preserva configuração de duas análises simultâneas", () => {
    salvarConfiguracaoDjen({
      automatico: false,
      intervalo_minutos: 60,
      janela_inicial_dias: 7,
      ia_paralelismo: 2,
      ia_modo: "equilibrado",
    });
    expect(configuracaoDjen().ia_paralelismo).toBe(2);
    expect(configuracaoDjen().ia_modo).toBe("equilibrado");
    expect(() => salvarConfiguracaoDjen({ ia_paralelismo: 20 })).toThrow();
    expect(() => salvarConfiguracaoDjen({ ia_modo: "inventado" })).toThrow();
  });
});
describe("fila paralela", () => {
  it("agrupa publicações curtas no modo econômico e usa o perfil leve", async () => {
    seed(5);
    mocked.analisarLoteComCodex.mockImplementation(
      async (itens: { id: number }[]) => ({
        resultados: new Map(itens.map((item) => [item.id, analysis("", [])])),
        invalidos: [],
      }),
    );
    db.prepare(
      "UPDATE djen_config SET ia_ativa=1,ia_modo='economico',ia_paralelismo=1",
    ).run();
    await processarFilaCodex();
    expect(mocked.analisarLoteComCodex).toHaveBeenCalledTimes(1);
    expect(mocked.analisarLoteComCodex.mock.calls[0][0]).toHaveLength(5);
    expect(mocked.analisarLoteComCodex.mock.calls[0][2]).toMatchObject({
      modelo: "gpt-6-luna",
      esforco: "low",
    });
    expect(mocked.analisarComCodex).not.toHaveBeenCalled();
    expect(statusAnalisesCodex()).toMatchObject({ pendentes: 0, falhas: 0 });
  });

  it("aprofunda somente o item duvidoso do lote com o modelo forte", async () => {
    seed(3);
    mocked.analisarLoteComCodex.mockImplementation(
      async (itens: { id: number }[]) => ({
        resultados: new Map(
          itens.map((item, index) => {
            const resposta = analysis("", []);
            if (index === 1)
              resposta.alertas = [
                "Classificação duvidosa por falta de contexto.",
              ];
            return [item.id, resposta];
          }),
        ),
        invalidos: [],
      }),
    );
    mocked.analisarComCodex.mockResolvedValue(analysis("", []));
    db.prepare(
      "UPDATE djen_config SET ia_ativa=1,ia_modo='economico',ia_paralelismo=1",
    ).run();
    await processarFilaCodex();
    expect(mocked.analisarLoteComCodex).toHaveBeenCalledTimes(1);
    expect(mocked.analisarComCodex).toHaveBeenCalledTimes(1);
    expect(mocked.analisarComCodex.mock.calls[0][4]).toMatchObject({
      modelo: "gpt-6.1-sol",
      esforco: "low",
    });
  });

  it("repete isoladamente somente o resultado inválido de um lote", async () => {
    seed(3);
    mocked.analisarLoteComCodex.mockImplementation(
      async (itens: { id: number }[]) => ({
        resultados: new Map(
          itens.slice(0, 2).map((item) => [item.id, analysis("", [])]),
        ),
        invalidos: [itens[2].id],
      }),
    );
    mocked.analisarComCodex.mockResolvedValue(analysis("", []));
    db.prepare(
      "UPDATE djen_config SET ia_ativa=1,ia_modo='economico',ia_paralelismo=1",
    ).run();
    await processarFilaCodex();
    expect(mocked.analisarLoteComCodex).toHaveBeenCalledTimes(1);
    expect(mocked.analisarComCodex).toHaveBeenCalledTimes(1);
    expect(mocked.analisarComCodex.mock.calls[0][4]).toMatchObject({
      modelo: "gpt-6.1-sol",
      esforco: "low",
    });
    expect(statusAnalisesCodex()).toMatchObject({ pendentes: 0, falhas: 0 });
  });

  it("reaproveita análise idêntica sem nova chamada ao Codex", async () => {
    seed(1);
    mocked.analisarComCodex.mockResolvedValue(analysis("", []));
    db.prepare(
      "UPDATE djen_config SET ia_ativa=1,ia_modo='economico',ia_paralelismo=1",
    ).run();
    await processarFilaCodex();
    expect(mocked.analisarComCodex).toHaveBeenCalledTimes(1);
    const advogado = db
      .prepare("SELECT * FROM djen_advogados LIMIT 1")
      .get() as ReturnType<typeof salvarAdvogado>;
    const repetida = normalizarPublicacao({
      id: 987654,
      numero_processo: "50012341120268260001",
      data_disponibilizacao: "2026-10-21",
      siglaTribunal: "TJSP",
      nomeClasse: "Procedimento Comum",
      nomeOrgao: "Outra Vara",
      tipoDocumento: "Intimação",
      tipoComunicacao: "Intimação",
      texto: "Publicação de teste número 0.",
      destinatarios: [],
      destinatarioadvogados: [{ advogado }],
    });
    importarPublicacoes([repetida], advogado, "oab");
    await processarFilaCodex();
    expect(mocked.analisarComCodex).toHaveBeenCalledTimes(1);
    expect(statusAnalisesCodex().uso_30_dias.cache_hits).toBe(1);
    expect(
      listarPublicacoes({}).items.every((p) => p.ia_status === "concluida"),
    ).toBe(true);
  });

  it("inicia exatamente duas tarefas, sem duplicar nem antecipar a terceira", async () => {
    seed(3);
    const finish: ((a: AnaliseCodex) => void)[] = [];
    mocked.analisarComCodex.mockImplementation(
      () => new Promise<AnaliseCodex>((r) => finish.push(r)),
    );
    db.prepare("UPDATE djen_config SET ia_ativa=1,ia_modo='precisao'").run();
    const job = processarFilaCodex();
    await processarFilaCodex();
    expect(mocked.analisarComCodex).toHaveBeenCalledTimes(2);
    expect(statusAnalisesCodex().executando_ids).toHaveLength(2);
    expect(statusAnalisesCodex().pendentes).toBe(1);
    finish[0](analysis("", []));
    await vi.waitFor(() =>
      expect(mocked.analisarComCodex).toHaveBeenCalledTimes(3),
    );
    finish[1](analysis("", []));
    finish[2](analysis("", []));
    await job;
    await vi.waitFor(() =>
      expect(statusAnalisesCodex().executando_ids).toHaveLength(0),
    );
    expect(statusAnalisesCodex().pendentes).toBe(0);
    expect(statusAnalisesCodex().media_segundos).not.toBeNull();
  });
  it("erro de validação de uma publicação não interrompe as demais", async () => {
    seed(2);
    mocked.analisarComCodex
      .mockRejectedValueOnce(new ErroAnaliseCodex("Evidência inválida"))
      .mockResolvedValueOnce(analysis("", []));
    db.prepare("UPDATE djen_config SET ia_ativa=1,ia_modo='precisao'").run();
    await processarFilaCodex();
    expect(statusAnalisesCodex().pausa).toBeNull();
    expect(statusAnalisesCodex().falhas).toBe(1);
  });
});
