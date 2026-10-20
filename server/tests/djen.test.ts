import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const wa = vi.hoisted(() => ({
  isReady: vi.fn(),
  resolveChatId: vi.fn(),
  sendMessageConfirmed: vi.fn(),
}));
vi.mock("../src/services/whatsappService", () => ({ whatsappManager: wa }));
import { db } from "../src/db";
import { runDjenMigrations } from "../src/db/djenMigrations";
import {
  classificarPublicacao,
  textoDaPublicacao,
} from "../src/services/djen/classifier";
import {
  consultarDjen,
  normalizarPublicacao,
  correspondenciaAdvogado,
  parametrosConsulta,
  dataValida,
} from "../src/services/djen/api";
import {
  importarPublicacoes,
  salvarAdvogado,
  listarAdvogados,
  listarPublicacoes,
  publicacaoPorId,
  revisarPublicacao,
  salvarProcessoDaPublicacao,
  configuracaoDjen,
} from "../src/services/djen/store";
import {
  iniciarBusca,
  statusBuscas,
  pararMonitorDjen,
} from "../src/services/djen/sync";
import { enviarMensagemDjen } from "../src/services/djen/messages";
import { createContact, deleteContact } from "../src/services/contactsService";
let contatoId: number | undefined;
const raw = (id = 1, texto = "SENTENÇA\nJulgo procedente o pedido.") => ({
  id,
  numero_processo: "50012341120268260001",
  data_disponibilizacao: "2026-10-20",
  siglaTribunal: "TJSP",
  nomeOrgao: "Vara de teste",
  nomeClasse: "Procedimento Comum",
  tipoDocumento: "Sentença",
  tipoComunicacao: "Intimação",
  texto,
  hash: "hash-de-teste",
  destinatarios: [{ nome: "Parte de teste", polo: "A" }],
  destinatarioadvogados: [
    {
      advogado: { nome: "ADVOGADO TESTE", numero_oab: "123456", uf_oab: "SP" },
    },
  ],
});
function advogado() {
  return salvarAdvogado({
    nome: "ADVOGADO TESTE",
    numero_oab: "123456",
    uf_oab: "SP",
    modo_busca: "ambos",
  });
}
const response = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
const legadas = () =>
  Object.fromEntries(
    [
      "pericias_agendadas",
      "send_logs",
      "pending_replies",
      "google_calendar_event_links",
    ].map((t) => [
      t,
      (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n,
    ]),
  );
beforeEach(() => {
  db.exec(
    "DELETE FROM djen_mensagens;DELETE FROM djen_publicacao_advogados;DELETE FROM djen_publicacoes;DELETE FROM djen_processos;DELETE FROM djen_advogados;DELETE FROM djen_buscas;UPDATE djen_config SET automatico=0;",
  );
  vi.clearAllMocks();
  wa.isReady.mockReturnValue(true);
  wa.resolveChatId.mockResolvedValue("5511999999999@c.us");
  wa.sendMessageConfirmed.mockResolvedValue({ messageId: "DJEN-MSG", ack: 1 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  if (contatoId) {
    deleteContact(contatoId);
    contatoId = undefined;
  }
  pararMonitorDjen();
});
describe("triagem DJEN", () => {
  it.each([
    ["SENTENÇA\nJulgo procedente o pedido.", "sentenca", "procedente"],
    ["Julgo improcedentes os pedidos.", "sentenca", "improcedente"],
    ["Julgo parcialmente procedente a ação.", "sentenca", "parcial"],
    ["Julgo procedentes em parte os pedidos.", "sentenca", "parcial"],
    ["Julgo totalmente procedente o pedido.", "sentenca", "procedente"],
    ["ACÓRDÃO\nAcordam os desembargadores.", "acordao", "nao_identificado"],
    [
      "Fica designada perícia médica para o dia 25/10/2026.",
      "pericia",
      "nao_identificado",
    ],
    [
      "O laudo pericial foi juntado aos autos.",
      "laudo_juntado",
      "nao_identificado",
    ],
    [
      "Laudo da perícia juntado no evento 42.",
      "laudo_juntado",
      "nao_identificado",
    ],
  ])("identifica %s", (texto, tipo, resultado) => {
    const c = classificarPublicacao(texto);
    expect(c.categorias).toContain(tipo);
    expect(c.resultado).toBe(resultado);
    expect(c.evidencias.length).toBeGreaterThan(0);
  });
  it.each([
    "Após a juntada do laudo pericial, dê-se vista.",
    "Aguarde-se a juntada do laudo pericial.",
    "Não houve juntada de laudo pericial.",
    "O perito deverá apresentar laudo pericial em 30 dias.",
  ])("não confunde previsão futura ou negativa: %s", (texto) => {
    expect(classificarPublicacao(texto).categorias).not.toContain(
      "laudo_juntado",
    );
  });
  it("não transforma citação de sentença anterior em novo julgamento", () => {
    expect(
      classificarPublicacao(
        "A parte recorreu da sentença anterior e citou acórdão do STJ.",
      ).categorias,
    ).toEqual([]);
  });
  it("não escolhe resultado favorável entre dispositivos conflitantes", () => {
    expect(
      classificarPublicacao(
        "SENTENÇA\nJulgo procedente o pedido A. Julgo improcedente o pedido B.",
      ).resultado,
    ).toBe("nao_identificado");
  });
  it("extrai apenas texto seguro", () => {
    expect(
      textoDaPublicacao(
        "<p>Olá &amp; bom dia</p><script>alert(1)</script><img src=x onerror=alert(1)>",
      ),
    ).toBe("Olá & bom dia");
  });
});
describe("consulta à API oficial", () => {
  it("usa paginação e filtros do portal oficial", async () => {
    const a = advogado(),
      f = vi
        .fn()
        .mockResolvedValueOnce(response({ count: 2, items: [raw(1)] }))
        .mockResolvedValueOnce(response({ count: 2, items: [raw(2)] }));
    vi.stubGlobal("fetch", f);
    const ids: string[] = [];
    await consultarDjen(
      a,
      "oab",
      "2026-10-20",
      "2026-10-20",
      (items) => ids.push(...items.map((p) => p.comunicacao_id)),
      { requests: 0, pause: async () => {} },
    );
    const u = new URL(f.mock.calls[0][0]);
    expect(u.hostname).toBe("comunicaapi.pje.jus.br");
    expect(u.searchParams.get("pagina")).toBe("1");
    expect(u.searchParams.get("itensPorPagina")).toBe("100");
    expect(u.searchParams.get("numeroOab")).toBe("123456");
    expect(u.searchParams.get("ufOab")).toBe("SP");
    expect(new URL(f.mock.calls[1][0]).searchParams.get("pagina")).toBe("2");
    expect(ids).toEqual(["1", "2"]);
    const n = parametrosConsulta(a, "nome", "2026-10-20", "2026-10-20", 1);
    expect(n.get("nomeAdvogado")).toBe(a.nome);
    expect(n.has("numeroOab")).toBe(false);
  });
  it("403 não vira uma busca vazia com sucesso", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({}, 403)));
    await expect(
      consultarDjen(advogado(), "oab", "2026-10-20", "2026-10-20", () => {}, {
        requests: 0,
        pause: async () => {},
      }),
    ).rejects.toThrow("HTTP 403");
  });
  it("detecta páginas repetidas", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockImplementation(async () => response({ count: 2, items: [raw()] })),
    );
    await expect(
      consultarDjen(advogado(), "oab", "2026-10-20", "2026-10-20", () => {}, {
        requests: 0,
        pause: async () => {},
      }),
    ).rejects.toThrow("repetiu");
  });
  it("divide intervalo ao atingir dez mil resultados", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(response({ count: 10000, items: [] }))
      .mockImplementation(async () => response({ count: 0, items: [] }));
    vi.stubGlobal("fetch", f);
    await consultarDjen(
      advogado(),
      "nome",
      "2026-10-19",
      "2026-10-20",
      () => {},
      { requests: 0, pause: async () => {} },
    );
    expect(f).toHaveBeenCalledTimes(3);
  });
  it("valida ID, datas e links", () => {
    expect(() => normalizarPublicacao({ ...raw(), id: undefined })).toThrow();
    expect(dataValida("2026-02-30")).toBe(false);
    expect(
      normalizarPublicacao({ ...raw(), link: "javascript:alert(1)" }).link,
    ).toBeNull();
  });
  it("diferencia OAB confirmada de correspondência pelo nome", () => {
    const a = advogado(),
      p = normalizarPublicacao(raw());
    expect(correspondenciaAdvogado(p, a, "nome")).toBe("oab");
    p.advogados[0].numero_oab = "987654";
    expect(correspondenciaAdvogado(p, a, "oab")).toBeNull();
    expect(correspondenciaAdvogado(p, a, "nome")).toBe("nome_revisar");
  });
});
describe("respostas incompletas e limitação do DJEN", () => {
  it("repete leitura após 429 respeitando a espera, sem repetir qualquer envio", async () => {
    const f = vi
      .fn()
      .mockResolvedValueOnce(response({}, 429))
      .mockResolvedValueOnce(response({ count: 0, items: [] }));
    vi.stubGlobal("fetch", f);
    const esperas: number[] = [];
    await consultarDjen(
      advogado(),
      "oab",
      "2026-10-20",
      "2026-10-20",
      () => {},
      {
        requests: 0,
        pause: async (ms) => {
          esperas.push(ms);
        },
      },
    );
    expect(f).toHaveBeenCalledTimes(2);
    expect(esperas.some((ms) => ms >= 2000)).toBe(true);
    expect(wa.sendMessageConfirmed).not.toHaveBeenCalled();
  });
  it("página vazia antes do total é incompleta", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ count: 1, items: [] })),
    );
    await expect(
      consultarDjen(advogado(), "oab", "2026-10-20", "2026-10-20", () => {}, {
        requests: 0,
        pause: async () => {},
      }),
    ).rejects.toThrow("antes do total");
  });
  it("total nulo não é tratado como zero resultados", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(response({ count: null, items: [] })),
    );
    await expect(
      consultarDjen(advogado(), "oab", "2026-10-20", "2026-10-20", () => {}, {
        requests: 0,
        pause: async () => {},
      }),
    ).rejects.toThrow("Formato");
  });
});

describe("dados independentes", () => {
  it("deduplica entre advogados sem gravar no controle de perícias", () => {
    const before = legadas(),
      a = advogado(),
      b = salvarAdvogado({
        nome: "OUTRO ADVOGADO",
        numero_oab: "123457",
        uf_oab: "SP",
      }),
      p = normalizarPublicacao(raw());
    expect(importarPublicacoes([p], a, "oab")).toBe(1);
    expect(importarPublicacoes([p], a, "nome")).toBe(0);
    p.advogados.push({
      nome: b.nome,
      numero_oab: b.numero_oab,
      uf_oab: b.uf_oab,
    });
    expect(importarPublicacoes([p], b, "nome")).toBe(0);
    const list = listarPublicacoes({});
    expect(list.total).toBe(1);
    expect(list.items[0].advogados).toHaveLength(2);
    expect(legadas()).toEqual(before);
  });
  it("preserva revisão humana e pede nova revisão se o teor mudar", () => {
    const a = advogado(),
      p = normalizarPublicacao(raw());
    importarPublicacoes([p], a, "oab");
    const id = listarPublicacoes({}).items[0].id;
    revisarPublicacao(id, {
      categorias: ["acordao"],
      resultado: "nao_identificado",
    });
    importarPublicacoes([p], a, "nome");
    expect(publicacaoPorId(id)?.revisada).toBe(1);
    expect(JSON.parse(publicacaoPorId(id)!.categorias_json)).toEqual([
      "acordao",
    ]);
    importarPublicacoes(
      [{ ...p, texto: "Sentença\nJulgo improcedente o pedido." }],
      a,
      "oab",
    );
    expect(publicacaoPorId(id)?.revisada).toBe(0);
    expect(publicacaoPorId(id)?.resultado).toBe("improcedente");
  });
  it("perícia e laudo no DJEN não criam compromissos ou avisos", () => {
    const before = legadas();
    importarPublicacoes(
      [
        normalizarPublicacao({
          ...raw(),
          tipoDocumento: "Intimação",
          texto:
            "Perícia médica designada para 25/10. O laudo pericial foi juntado aos autos.",
        }),
      ],
      advogado(),
      "oab",
    );
    expect(legadas()).toEqual(before);
    expect(listarPublicacoes({ categoria: "pericia" }).total).toBe(1);
    expect(listarPublicacoes({ categoria: "laudo_juntado" }).total).toBe(1);
  });
  it("migrações são repetíveis e não ativam captura", () => {
    const a = advogado();
    runDjenMigrations(db);
    expect(listarAdvogados()[0].id).toBe(a.id);
    expect(configuracaoDjen().automatico).toBe(0);
  });
  it("exclusão de contato não apaga publicações", () => {
    importarPublicacoes([normalizarPublicacao(raw())], advogado(), "oab");
    const id = listarPublicacoes({}).items[0].id,
      c = createContact("DJEN TESTE CLIENTE", "11999999999");
    salvarProcessoDaPublicacao(id, {
      cliente_id: c.id,
      observacoes: "Anotação exclusiva",
    });
    deleteContact(c.id);
    expect(publicacaoPorId(id)?.cliente_id).toBeNull();
    expect(listarPublicacoes({}).total).toBe(1);
  });
});
describe("captura em segundo plano", () => {
  it("não avança cursor se uma das duas buscas falhar", async () => {
    const a = advogado();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(response({ count: 1, items: [raw()] }))
        .mockResolvedValue(response({}, 403)),
    );
    const id = iniciarBusca("2026-10-20", "2026-10-20", [a.id], "automatico");
    await vi.waitFor(() => expect(statusBuscas().executando).toBeNull(), {
      timeout: 6000,
    });
    expect(listarAdvogados()[0].cursor_data).toBeNull();
    expect(
      db.prepare("SELECT status FROM djen_buscas WHERE id=?").get(id),
    ).toMatchObject({ status: "parcial" });
    expect(listarPublicacoes({}).total).toBe(1);
  });
});
describe("mensagens processuais", () => {
  function preparar() {
    importarPublicacoes([normalizarPublicacao(raw())], advogado(), "oab");
    const id = listarPublicacoes({}).items[0].id;
    contatoId = createContact("DJEN TESTE CLIENTE", "11999999999").id;
    salvarProcessoDaPublicacao(id, { cliente_id: contatoId, observacoes: "" });
    return {
      id,
      data: {
        texto: "Mensagem revisada",
        request_id: "djen-request-00000001",
        cliente_id: contatoId,
        telefone_confirmado: "11999999999",
        confirmado: true,
      },
    };
  }
  it("exige revisão e destinatário confirmado", async () => {
    const { id, data } = preparar();
    await expect(enviarMensagemDjen(id, data)).rejects.toThrow("Revise");
    revisarPublicacao(id, {
      categorias: ["sentenca"],
      resultado: "procedente",
    });
    await expect(
      enviarMensagemDjen(id, { ...data, telefone_confirmado: "11911111111" }),
    ).rejects.toThrow("contato mudou");
    await expect(
      enviarMensagemDjen(id, { ...data, confirmado: false }),
    ).rejects.toThrow("confirme");
    expect(wa.sendMessageConfirmed).not.toHaveBeenCalled();
  });
  it("envia uma vez, com histórico separado e sem espera de resposta no módulo antigo", async () => {
    const { id, data } = preparar(),
      before = legadas();
    revisarPublicacao(id, {
      categorias: ["sentenca"],
      resultado: "procedente",
    });
    await enviarMensagemDjen(id, data);
    await enviarMensagemDjen(id, data);
    expect(wa.sendMessageConfirmed).toHaveBeenCalledOnce();
    expect(db.prepare("SELECT status FROM djen_mensagens").get()).toMatchObject(
      { status: "sucesso" },
    );
    expect(legadas()).toEqual(before);
  });
  it("envio incerto não vira sucesso e não é repetido", async () => {
    const { id, data } = preparar();
    revisarPublicacao(id, {
      categorias: ["sentenca"],
      resultado: "procedente",
    });
    wa.sendMessageConfirmed.mockRejectedValue(
      new Error("Confira a conversa antes de reenviar."),
    );
    await expect(enviarMensagemDjen(id, data)).rejects.toThrow("Confira");
    expect(await enviarMensagemDjen(id, data)).toMatchObject({
      status: "incerto",
    });
    expect(wa.sendMessageConfirmed).toHaveBeenCalledOnce();
  });
});
