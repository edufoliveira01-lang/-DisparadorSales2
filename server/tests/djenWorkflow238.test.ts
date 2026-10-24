import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("../src/services/googleCalendarService", () => ({
  googleRequest: vi.fn(),
  getGoogleCalendarConfig: () => ({ destinations: [] }),
  GoogleCalendarError: class extends Error {
    constructor(
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
}));
import { db } from "../src/db";
import {
  configPrazos,
  salvarConfigPrazos,
  calcularPrazo,
  identificarPrazos,
  concluirPublicacao,
} from "../src/services/djen/deadlines";
import { enviarPrazoAgenda } from "../src/services/djen/calendar";
import {
  googleRequest,
  GoogleCalendarError,
} from "../src/services/googleCalendarService";
import {
  validarAnaliseCodex,
  type AnaliseCodex,
} from "../src/services/djen/classifier";
import {
  listarPublicacoes,
  salvarAdvogado,
  importarPublicacoes,
  detalhesPublicacao,
} from "../src/services/djen/store";
import { normalizarPublicacao } from "../src/services/djen/api";
import { salvarPrazo } from "../src/services/djen/workflow";
import { excluirConsulta, statusBuscas } from "../src/services/djen/sync";
const calendario = {
  tribunal: "TJSP",
  orgao: "",
  inicio: "2026-01-01",
  fim: "2027-12-31",
  fonte: "https://www.tjsp.jus.br/calendario",
  conferido: true,
  feriados: ["2026-10-22"],
  suspensoes: [],
};
const input = {
  dias: 5,
  base: "2026-10-19",
  marco: "disponibilizacao",
  unidade: "uteis",
  regime: "cpc",
  confirmado: true,
};
function seed() {
  const a = salvarAdvogado({
    nome: "ADVOGADO PRAZOS TESTE",
    numero_oab: "444555",
    uf_oab: "SP",
  });
  importarPublicacoes(
    [
      normalizarPublicacao({
        id: "prazo-test-1",
        numero_processo: "50012341120268260001",
        siglaTribunal: "TJSP",
        nomeOrgao: "Vara",
        nomeClasse: "Procedimento comum",
        tipoDocumento: "Despacho",
        data_disponibilizacao: "2026-10-19",
        texto:
          "Intime-se a autora para manifestar-se sobre proposta de acordo do INSS em 15 dias.",
        destinatarios: [],
      }),
    ],
    a,
    "oab",
  );
  return Number(listarPublicacoes({}).items[0].id);
}
beforeEach(() => {
  db.exec(
    "DELETE FROM djen_mensagens;DELETE FROM djen_publicacao_advogados;DELETE FROM djen_publicacoes;DELETE FROM djen_processos;DELETE FROM djen_advogados;DELETE FROM djen_buscas;UPDATE djen_config SET ia_ativa=0",
  );
  salvarConfigPrazos({
    calendarId: "agenda-prazos",
    calendarName: "Prazos",
    calendarios: [calendario],
  });
  vi.mocked(googleRequest).mockReset();
});
describe("classificação e estado das publicações", () => {
  it("proposta de acordo pendente não é homologação nem sentença", () => {
    const texto =
      "Intime-se a parte autora para manifestar-se, em 15 dias, sobre a proposta de acordo apresentada pelo INSS.";
    const a: AnaliseCodex = {
      situacao: "INSS propôs acordo · manifestação pendente",
      categorias: ["proposta_acordo", "intimacao", "homologacao_acordo"],
      resultado: "procedente",
      resumo: "Manifestação sobre proposta.",
      justificativa: "Proposta pendente de aceitação.",
      evidencias: [
        { categoria: "proposta_acordo", trecho: texto },
        { categoria: "intimacao", trecho: texto },
        { categoria: "homologacao_acordo", trecho: texto },
      ],
      agendamento: { data: null, horario: null, local: null },
      providencia: {
        tipo: "ciencia",
        descricao: null,
        prazo_texto: null,
        responsavel: "indeterminado",
      },
      alertas: [],
    };
    const r = validarAnaliseCodex(a, texto);
    expect(r.categorias).toEqual(["proposta_acordo"]);
    expect(r.resultado).toBe("nao_identificado");
  });
  it("homologação atual é preservada mesmo com extinção condicionada ao pagamento futuro", () => {
    const texto =
      "SENTENÇA. HOMOLOGO o acordo apresentado pelas partes. Após o pagamento das parcelas, o processo será extinto.";
    const a: AnaliseCodex = {
      categorias: ["homologacao_acordo", "extincao_processo"],
      resultado: "nao_identificado",
      resumo: "Acordo homologado.",
      justificativa: "Homologação efetiva.",
      evidencias: [
        { categoria: "homologacao_acordo", trecho: texto },
        { categoria: "extincao_processo", trecho: texto },
      ],
      agendamento: { data: null, horario: null, local: null },
      providencia: {
        tipo: "ciencia",
        descricao: null,
        prazo_texto: null,
        responsavel: "indeterminado",
      },
      alertas: [],
    };
    expect(validarAnaliseCodex(a, texto).categorias).toEqual([
      "homologacao_acordo",
    ]);
  });
  it.each([
    "Intime-se o INSS para apresentar proposta de acordo.",
    "O INSS não apresentou proposta de acordo neste processo.",
  ])("não marca como proposta apresentada: %s", (texto) => {
    const a: AnaliseCodex = {
      categorias: ["proposta_acordo"],
      resultado: "nao_identificado",
      resumo: "Providência pendente.",
      justificativa: "Verificar proposta.",
      evidencias: [{ categoria: "proposta_acordo", trecho: texto }],
      agendamento: { data: null, horario: null, local: null },
      providencia: {
        tipo: "ciencia",
        descricao: null,
        prazo_texto: null,
        responsavel: "indeterminado",
      },
      alertas: [],
    };
    expect(validarAnaliseCodex(a, texto).categorias).toEqual([]);
  });
  it("conclui e reabre sem apagar o andamento, prazos ou histórico", () => {
    const id = seed();
    salvarPrazo(id, {
      descricao: "Manifestação",
      inicio: "2026-10-21",
      termino: "2026-11-12",
      status: "aberto",
      observacoes: "",
    });
    concluirPublicacao(id, true);
    expect(listarPublicacoes({}).total).toBe(0);
    expect(listarPublicacoes({ arquivo: "concluidos" }).total).toBe(1);
    expect(listarPublicacoes({ arquivo: "todos" }).total).toBe(1);
    expect(detalhesPublicacao(id).prazos).toHaveLength(1);
    concluirPublicacao(id, false);
    expect(listarPublicacoes({}).total).toBe(1);
  });
  it("mostra somente 5 consultas e exclui apenas o registro finalizado", () => {
    const id = seed();
    for (let i = 0; i < 8; i++)
      db.prepare(
        "INSERT INTO djen_buscas(origem,inicio,fim,status) VALUES ('manual','2026-10-19','2026-10-20','concluida')",
      ).run();
    const consultas = statusBuscas().ultimas as { id: number }[];
    expect(consultas).toHaveLength(5);
    excluirConsulta(consultas[0].id);
    expect(detalhesPublicacao(id)).toBeTruthy();
    const n = Number(
      db
        .prepare(
          "INSERT INTO djen_buscas(origem,inicio,fim) VALUES ('manual','2026-10-19','2026-10-20')",
        )
        .run().lastInsertRowid,
    );
    expect(() => excluirConsulta(n)).toThrow(/Aguarde/);
  });
});
describe("sugestão de prazo CPC com calendário configurado", () => {
  it("distingue disponibilização, publicação e início e exclui feriado local", () => {
    const r = calcularPrazo("TJSP", "Vara", input);
    expect(r).toMatchObject({
      publicacao: "2026-10-20",
      inicio: "2026-10-21",
      termino: "2026-10-28",
    });
    expect(r.exclusoes).toContainEqual({
      data: "2026-10-22",
      motivo: "Feriado / sem expediente",
    });
  });
  it("inclui suspensões específicas do órgão e a suspensão anual do CPC", () => {
    salvarConfigPrazos({
      ...configPrazos(),
      calendarios: [
        {
          ...calendario,
          suspensoes: [
            { inicio: "2026-10-23", fim: "2026-10-23", motivo: "Ato local" },
          ],
        },
      ],
    });
    expect(calcularPrazo("TJSP", "Vara", input).termino).toBe("2026-10-29");
    const r = calcularPrazo("TJSP", "Vara", {
      ...input,
      base: "2026-12-18",
      dias: 2,
    });
    expect(r.inicio).toBe("2027-01-21");
    expect(r.termino).toBe("2027-01-22");
  });
  it("não inventa cobertura de outro tribunal, ano ou calendário não conferido", () => {
    expect(() => calcularPrazo("TRF4", "Vara", input)).toThrow(/cobertura/);
    expect(() =>
      calcularPrazo("TJSP", "Vara", { ...input, base: "2027-12-31" }),
    ).toThrow(/cobertura/);
    salvarConfigPrazos({
      ...configPrazos(),
      calendarios: [{ ...calendario, conferido: false }],
    });
    expect(() => calcularPrazo("TJSP", "Vara", input)).toThrow(/cobertura/);
  });
  it("combina o calendário geral com feriados da unidade", () => {
    salvarConfigPrazos({
      ...configPrazos(),
      calendarios: [
        calendario,
        { ...calendario, orgao: "Vara local", feriados: ["2026-10-23"] },
      ],
    });
    const r = calcularPrazo("TJSP", "Vara local", input);
    expect(r.termino).toBe("2026-10-29");
    expect(r.exclusoes).toContainEqual({
      data: "2026-10-22",
      motivo: "Feriado / sem expediente",
    });
    expect(r.exclusoes).toContainEqual({
      data: "2026-10-23",
      motivo: "Feriado / sem expediente",
    });
  });
  it("exige confirmação do regime e não deduz ciência pessoal", () => {
    expect(() =>
      calcularPrazo("TJSP", "Vara", { ...input, confirmado: false }),
    ).toThrow(/Confirme/);
    expect(() =>
      calcularPrazo("TJSP", "Vara", { ...input, regime: "penal" }),
    ).toThrow(/Confirme/);
    expect(() =>
      calcularPrazo("TJSP", "Vara", {
        ...input,
        marco: "domicilio_sem_ciencia",
      }),
    ).toThrow(/Confirme/);
  });
  it("identifica prazo explícito de manifestação sem criar prazo para pagamento de proposta", () => {
    const proposta = "A parte autora foi intimada a se manifestar, em cinco dias, sobre proposta de acordo apresentada pelo INSS.";
    expect(identificarPrazos(proposta)).toMatchObject([{ dias: 5, descricao: "Manifestação sobre proposta de acordo" }]);
    const id = seed();
    db.prepare("UPDATE djen_publicacoes SET texto=?,ia_json=NULL WHERE id=?").run(proposta, id);
    expect(detalhesPublicacao(id).acao).toMatchObject({ tipo: "prazo_explicito", prazo_texto: proposta.slice(0, -1) });
    expect(listarPublicacoes({}).items[0].acao).toMatchObject({ tipo: "prazo_explicito", prazo_texto: proposta.slice(0, -1) });
    expect(identificarPrazos("Considerando proposta do INSS, intime-se a autora para se manifestar em cinco dias.")[0].dias).toBe(5);
    expect(identificarPrazos("Intime-se o INSS para se manifestar sobre a proposta da autora em cinco dias.")).toEqual([]);
    expect(
      identificarPrazos(
        "Intime-se a autora para manifestar-se sobre a proposta de acordo em 15 (quinze) dias.",
      )[0].dias,
    ).toBe(15);
    expect(
      identificarPrazos("O pagamento será feito em 30 dias após o acordo."),
    ).toEqual([]);
    expect(
      identificarPrazos(
        "A autora deverá apresentar réplica no prazo de quinze dias.",
      )[0].dias,
    ).toBe(15);
    expect(
      identificarPrazos(
        "A autora deverá se manifestar em vinte e cinco dias.",
      )[0].dias,
    ).toBe(25);
    expect(
      identificarPrazos("Intime-se a autora para impugnar em onze dias.")[0]
        .dias,
    ).toBe(11);
    expect(
      identificarPrazos(
        "Intime-se a autora para manifestar-se em quarenta e cinco dias.",
      )[0].dias,
    ).toBe(45);
    expect(identificarPrazos("A autora cumpra a determinação em 10 dias.")[0].dias).toBe(10);
    expect(identificarPrazos("Aguarde-se por 30 dias. Após, intime-se o perito para apresentar laudo em 15 dias.")).toEqual([]);
    expect(identificarPrazos("O perito apresentará laudo em 20 dias. Dê-se ciência à autora.")).toEqual([]);
  });
  it("rejeita configurações inválidas e fontes não oficiais", () => {
    expect(() =>
      salvarConfigPrazos({
        ...configPrazos(),
        calendarios: [{ ...calendario, feriados: ["2026-02-30"] }],
      }),
    ).toThrow();
    expect(() =>
      salvarConfigPrazos({
        ...configPrazos(),
        calendarios: [{ ...calendario, fonte: "https://exemplo.com" }],
      }),
    ).toThrow();
  });
});
describe("agenda processual isolada", () => {
  it("usa ID determinístico e atualiza repetição sem criar duas entradas nem alterar perícias", async () => {
    const id = seed(),
      prazo = salvarPrazo(id, {
        descricao: "Manifestação",
        inicio: "2026-10-21",
        termino: "2026-10-28",
        status: "aberto",
        observacoes: "Conferido",
      });
    const antes = db
      .prepare("SELECT count(*) AS n FROM google_calendar_event_links")
      .get();
    vi.mocked(googleRequest).mockResolvedValueOnce({
      id: "evento",
      htmlLink: "https://calendar.google.com/evento",
    });
    await enviarPrazoAgenda(id, prazo);
    const primeira = vi.mocked(googleRequest).mock.calls[0],
      evento = JSON.parse(String(primeira[1]?.body));
    expect(evento.start).toEqual({ date: "2026-10-28" });
    expect(evento.description).toContain("2026-10-21");
    vi.mocked(googleRequest)
      .mockRejectedValueOnce(new GoogleCalendarError("Existe", 409))
      .mockResolvedValueOnce({ id: evento.id });
    await enviarPrazoAgenda(id, prazo);
    expect(vi.mocked(googleRequest).mock.calls[2][1]?.method).toBe("PATCH");
    expect(
      (
        db.prepare("SELECT count(*) AS n FROM djen_agenda_links").get() as {
          n: number;
        }
      ).n,
    ).toBe(1);
    expect(
      db.prepare("SELECT count(*) AS n FROM google_calendar_event_links").get(),
    ).toEqual(antes);
  });
});

