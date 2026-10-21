import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { setSetting } from "../src/services/settingsService";
import {
  calcularPrazo,
  salvarConfigPrazos,
} from "../src/services/djen/deadlines";
import {
  parseTjsp,
  parseTrf4,
  parseTjdft,
  parseAtoAnualTrf3,
  parseMunicipaisJfsp,
  importarFonte,
  abrangenciaSuspensao,
} from "../src/services/djen/officialCalendars/providers";
import {
  evento,
  diasIntervalo,
  lerFonteOficial,
  limparCacheFontes,
} from "../src/services/djen/officialCalendars/utils";
import {
  sincronizarCalendario,
  calcularComCalendarioOficial,
  pararMonitorCalendarios,
  iniciarMonitorCalendarios,
  enfileirarCalendarios,
  statusCalendarios,
} from "../src/services/djen/officialCalendars/service";
import {
  salvarAjustes,
  eventosEfetivos,
  calendarioParaCalculo,
  salvarConfigImportacao,
  configImportacao,
  lerCalendario,
  criarRegistro,
} from "../src/services/djen/officialCalendars/store";
import { runDjenMigrations } from "../src/db/djenMigrations";
import type { LerFonteOficial } from "../src/services/djen/officialCalendars/types";
const fixture = (name: string) =>
  readFileSync(
    new URL(`./fixtures/calendars/${name}`, import.meta.url),
    "utf8",
  );
const fonte =
  "https://www.tjsp.jus.br/CanaisComunicacao/Feriados/ExpedienteForense";
const escopo = {
  tribunal: "TJSP",
  orgao: "1ª Vara Cível de São Paulo",
  ano: 2026,
};
const reader = vi.fn<LerFonteOficial>(async (url) => {
  if (url.includes("ListarMunicipios")) return fixture("tj-municipios.html");
  if (url.includes("ObterAnos"))
    return '<option value="2026">2026</option><option value="2027">2027</option>';
  if (url.includes("PesquisarFeriados")) return fixture("tjsp-feriados.html");
  if (url.includes("PesquisarSuspensoes"))
    return fixture("tjsp-suspensoes.html");
  if (url.includes("selOrgao=")) {
    const id = new URL(url).searchParams.get("selOrgao");
    return fixture(
      (
        {
          1: "trf4.html",
          2: "trf4-rs.html",
          3: "trf4-sc.html",
          4: "trf4-pr.html",
        } as Record<string, string>
      )[id!],
    );
  }
  if (url.includes("tjdft")) return fixture("tjdft.html");
  if (url.includes("jfsp.jus.br/servicos")) return fixture("jfsp.html");
  if (url.includes("trf3.jus.br/seju")) return fixture("trf3-cal.html");
  const numero = /Portaria0*(\d+)\.htm/.exec(url)?.[1];
  if (numero)
    return fixture(numero === "338" ? "jfsp-338.html" : `trf3-${numero}.html`);
  throw new Error(`Fonte não prevista no teste: ${url}`);
});
const input = {
  dias: 5,
  base: "2026-10-26",
  marco: "ciencia",
  unidade: "uteis",
  regime: "cpc",
  confirmado: true,
};
beforeEach(() => {
  db.exec("DELETE FROM djen_calendarios_oficiais");
  salvarConfigPrazos({ calendarId: "", calendarName: "", calendarios: [] });
  setSetting(
    "djen_calendarios_automaticos",
    JSON.stringify({ ativo: true, localidades: [] }),
  );
  reader.mockClear();
  limparCacheFontes();
});
afterEach(() => {
  pararMonitorCalendarios();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("fontes oficiais reais — contratos e abrangência", () => {
  it("TJSP importa feriado transferido e não aplica suspensões de outras varas à comarca", () => {
    const eventos = parseTjsp(
      JSON.parse(fixture("tjsp-feriados.html")),
      JSON.parse(fixture("tjsp-suspensoes.html")),
      escopo,
      fonte,
    );
    expect(
      eventos.some((e) => e.tipo === "feriado" && e.inicio === "2026-10-30"),
    ).toBe(true);
    expect(
      eventos.some((e) => e.tipo === "feriado" && e.inicio === "2026-10-28"),
    ).toBe(false);
    expect(
      eventos
        .filter((e) => e.tipo === "suspensao")
        .some((e) => /violência|acidentes/i.test(e.descricao)),
    ).toBe(false);
    expect(eventos.some((e) => e.tipo === "pendencia")).toBe(true);
  });
  it("não ignora a primeira vara de uma lista; mantém o ato restrito para conferência", () => {
    expect(
      abrangenciaSuspensao(
        "Suspensão na 1ª, 2ª e 3ª Varas Cíveis",
        "1ª Vara Cível",
      ),
    ).toBe("pendencia");
    expect(
      abrangenciaSuspensao("Suspensão na 3ª Vara Cível", "1ª Vara Cível"),
    ).toBe("ignorar");
  });
  it("recusa listas vazias e ano divergente do TJSP", () => {
    expect(() => parseTjsp({ data: [] }, { data: [] }, escopo, fonte)).toThrow(
      /anual válido/,
    );
    expect(() =>
      parseTjsp(
        JSON.parse(fixture("tjsp-feriados.html")),
        { data: [] },
        { ...escopo, ano: 2027 },
        fonte,
      ),
    ).toThrow(/outro ano/);
  });
  it.each([
    ["trf4-rs.html", "Porto Alegre"],
    ["trf4-sc.html", "Florianópolis"],
    ["trf4-pr.html", "Curitiba"],
  ])("TRF4 combina Todas apenas com a subseção correta: %s", (file, cidade) => {
    const r = parseTrf4(fixture(file), 2026, `1ª Vara Federal de ${cidade}`);
    expect(r.cidade).toBe(cidade);
    expect(r.eventos.length).toBeGreaterThan(20);
    expect(r.eventos.some((e) => e.inicio === "2026-10-30")).toBe(true);
    expect(() => parseTrf4(fixture(file), 2027, cidade)).toThrow(/ano 2027/);
    expect(() => parseTrf4(fixture(file), 2026, "Vara sem cidade")).toThrow(
      /cidade/,
    );
  });
  it("TJDFT importa as datas do ano solicitado e rejeita calendário não publicado", () => {
    expect(
      parseTjdft(fixture("tjdft.html"), 2026, "https://www.tjdft.jus.br/")
        .length,
    ).toBeGreaterThan(20);
    expect(() => parseTjdft(fixture("tjdft.html"), 2025, fonte)).toThrow(
      /não disponível/,
    );
  });
  it("JFSP usa texto consolidado e remove o feriado municipal revogado via CSS", () => {
    const municipios = parseMunicipaisJfsp(fixture("jfsp-338.html"), 2026);
    expect(municipios.find((m) => m.cidade === "Catanduva")?.datas).toEqual([
      "2026-04-14",
      "2026-08-10",
    ]);
    const eventos = parseAtoAnualTrf3(
      fixture("trf3-764.html"),
      2026,
      "SP",
      fonte,
    );
    expect(eventos.some((e) => e.inicio === "2026-04-20")).toBe(true);
    expect(
      eventos.some(
        (e) => e.tipo === "expediente_parcial" && e.inicio === "2026-02-18",
      ),
    ).toBe(true);
    expect(eventos.some((e) => e.inicio === "2026-10-28")).toBe(false);
  });
  it("TRF3 separa a turma de MS dos feriados exclusivos de SP no texto consolidado", () => {
    const sp = parseAtoAnualTrf3(fixture("trf3-48.html"), 2026, "SP", fonte),
      ms = parseAtoAnualTrf3(fixture("trf3-48.html"), 2026, "MS", fonte);
    expect(sp.some((e) => e.inicio === "2026-08-26")).toBe(false);
    expect(ms.some((e) => e.inicio === "2026-07-09")).toBe(false);
    expect(ms.some((e) => e.inicio === "2026-08-26")).toBe(true);
  });
  it("identifica a cidade TJSP pelo nome do órgão e monta a consulta oficial", async () => {
    const r = await importarFonte(escopo, reader);
    expect(r.municipio).toBe("São Paulo");
    expect(
      reader.mock.calls.find(([u]) => u.includes("ListarMunicipios"))?.[1]
        ?.body,
    ).toBe("texto=S%C3%A3o+Paulo");
    expect(
      reader.mock.calls.some(
        ([u]) => u.includes("codigoMunicipio=7066") && u.includes("ano=2026"),
      ),
    ).toBe(true);
  });
  it("importa JFSP por município e TRF3 pelo índice com alterações", async () => {
    const local = await importarFonte(
      { tribunal: "TRF3", orgao: "1ª Vara Federal de Catanduva", ano: 2026 },
      reader,
    );
    expect(local.municipio).toBe("Catanduva");
    expect(local.eventos.some((e) => e.inicio === "2026-08-10")).toBe(true);
    const segundo = await importarFonte(
      { tribunal: "TRF3", orgao: "8ª Turma", ano: 2026 },
      reader,
    );
    expect(
      segundo.eventos.some(
        (e) => e.tipo === "pendencia" && e.inicio === "2026-03-02",
      ),
    ).toBe(true);
    expect(
      segundo.eventos.some(
        (e) => e.inicio === "2026-06-24" && e.tipo === "pendencia",
      ),
    ).toBe(true);
    expect(segundo.eventos.some((e) => e.inicio === "2026-08-29")).toBe(false);
  });
  it("não escolhe uma cidade em outro estado nem transforma ausência de fonte em calendário vazio", async () => {
    await expect(
      importarFonte({ ...escopo, orgao: "Vara sem localidade" }, reader),
    ).rejects.toThrow(/Município/);
    await expect(
      importarFonte({ tribunal: "TJMG", orgao: "Vara", ano: 2026 }, reader),
    ).rejects.toThrow(/fonte automática/);
    await expect(
      importarFonte(
        {
          tribunal: "TRF3",
          orgao: "Vara Federal de Campo Grande",
          uf: "MS",
          ano: 2026,
        },
        reader,
      ),
    ).rejects.toThrow(/fonte automática/);
  });
});

describe("persistência, sincronização e alternativas manuais", () => {
  it("é automática por padrão; compartilha a consulta simultânea e reutiliza o calendário fresco", async () => {
    expect(configImportacao().ativo).toBe(true);
    const [a, b] = await Promise.all([
      sincronizarCalendario(escopo, false, reader),
      sincronizarCalendario(escopo, false, reader),
    ]);
    expect(a?.chave).toBe(b?.chave);
    expect(a?.status).toBe("parcial");
    expect(reader).toHaveBeenCalledTimes(4);
    await sincronizarCalendario(escopo, false, reader);
    expect(reader).toHaveBeenCalledTimes(4);
  });
  it("preserva ajustes e datas importadas quando atualiza ou quando a fonte falha", async () => {
    const a = (await sincronizarCalendario(escopo, false, reader))!;
    salvarAjustes(a.chave, {
      adicionar: [
        {
          tipo: "feriado",
          inicio: "2026-10-27",
          fim: "2026-10-27",
          descricao: "Portaria local",
        },
      ],
      ignorar: [a.eventos[0].id],
    });
    const b = (await sincronizarCalendario(escopo, true, reader))!;
    expect(
      eventosEfetivos(b).some(
        (e) => e.inicio === "2026-10-27" && e.fonte === "manual",
      ),
    ).toBe(true);
    expect(b.ajustes.ignorar).toEqual([a.eventos[0].id]);
    const c = (await sincronizarCalendario(escopo, true, async () => {
      throw new Error("offline");
    }))!;
    expect(c.status).toBe("erro");
    expect(c.eventos).toEqual(b.eventos);
    expect(c.ajustes).toEqual(b.ajustes);
    expect(calendarioParaCalculo(c)).toBeNull();
    expect(
      db
        .prepare(
          "SELECT COUNT(*) n FROM djen_calendario_historico WHERE chave=?",
        )
        .get(c.chave),
    ).toEqual({ n: 3 });
  });
  it("não usa dados vencidos ou de localidade alterada; migração é idempotente", async () => {
    const a = (await sincronizarCalendario(escopo, false, reader))!;
    db.prepare(
      "UPDATE djen_calendarios_oficiais SET atualizado_em=? WHERE chave=?",
    ).run(new Date(Date.now() - 7 * 3600000).toISOString(), a.chave);
    expect(calendarioParaCalculo(lerCalendario(a.chave)!)).toBeNull();
    salvarConfigImportacao({
      ativo: true,
      localidades: [
        { ...escopo, municipio: "Campinas", uf: "SP", instancia: "primeiro" },
      ],
    });
    expect(lerCalendario(a.chave)?.proxima_tentativa).toBe(0);
    expect(calendarioParaCalculo(lerCalendario(a.chave)!)).toBeNull();
    runDjenMigrations(db);
    runDjenMigrations(db);
    expect(lerCalendario(a.chave)?.eventos).toEqual(a.eventos);
  });
  it("usa o cache automático no cálculo e mantém o calendário manual como alternativa sem rede", async () => {
    const a = (await sincronizarCalendario(escopo, false, reader))!;
    const r = await calcularComCalendarioOficial(
      escopo.tribunal,
      escopo.orgao,
      input,
    );
    expect(r.inicio).toBe("2026-10-27");
    expect(r.termino).toBe("2026-11-04");
    expect(r.calendarios[0].origem).toBe("automatico");
    salvarConfigImportacao({ ativo: false, localidades: [] });
    salvarConfigPrazos({
      calendarId: "",
      calendarName: "",
      calendarios: [
        {
          tribunal: escopo.tribunal,
          orgao: escopo.orgao,
          inicio: "2026-01-01",
          fim: "2026-12-31",
          fonte,
          conferido: true,
          feriados: [],
          suspensoes: [],
        },
      ],
    });
    expect(
      (await calcularComCalendarioOficial(escopo.tribunal, escopo.orgao, input))
        .termino,
    ).toBe("2026-11-02");
    expect(reader).toHaveBeenCalledTimes(4);
    expect(lerCalendario(a.chave)?.eventos.length).toBeGreaterThan(10);
  });
  it("bloqueia somente o intervalo afetado por ato pendente, permitindo resolver sem perder importação", async () => {
    const a = (await sincronizarCalendario(escopo, false, reader))!,
      cal = calendarioParaCalculo(a)!;
    const pend = evento(
      "pendencia",
      "2026-10-28",
      "2026-10-28",
      "Ato exclusivo de unidade a conferir",
      fonte,
    );
    expect(() =>
      calcularPrazo(escopo.tribunal, escopo.orgao, input, [
        {
          ...cal,
          pendencias: [
            { inicio: pend.inicio, fim: pend.fim, motivo: pend.descricao },
          ],
        },
      ]),
    ).toThrow(/abrangência pendente/);
    salvarAjustes(a.chave, {
      adicionar: [{ ...pend, tipo: "suspensao" }],
      ignorar: [],
    });
    const atualizado = calendarioParaCalculo(lerCalendario(a.chave)!)!;
    expect(
      calcularPrazo(escopo.tribunal, escopo.orgao, input, [atualizado]).termino,
    ).toBe("2026-11-05");
  });
  it("importa o ano seguinte automaticamente quando a contagem atravessa o recesso", async () => {
    await sincronizarCalendario(escopo, false, reader);
    const fake = vi.fn(async (url: unknown) => {
      const u = String(url),
        ano = new URL(u).searchParams.get("ano");
      const raw = await reader(u);
      return new Response(
        ano === "2027" ? raw.replaceAll("2026", "2027") : raw,
        { headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    });
    vi.stubGlobal("fetch", fake);
    const r = await calcularComCalendarioOficial(
      escopo.tribunal,
      escopo.orgao,
      { ...input, base: "2026-12-18", dias: 2 },
    );
    expect(r.inicio).toBe("2027-01-21");
    expect(r.termino).toBe("2027-01-22");
    expect(r.calendarios.map((c) => c.origem)).toEqual([
      "automatico",
      "automatico",
    ]);
    expect(fake.mock.calls.some(([u]) => String(u).includes("ano=2027"))).toBe(
      true,
    );
  });
  it("atualiza periodicamente os calendários persistidos, mesmo sem nova captura", async () => {
    vi.useFakeTimers();
    criarRegistro(escopo);
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: unknown) =>
          new Response(await reader(String(url)), {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    );
    iniciarMonitorCalendarios();
    await vi.advanceTimersByTimeAsync(30001);
    expect(
      statusCalendarios().calendarios.find((c) => c.orgao === escopo.orgao)
        ?.atualizado_em,
    ).toBeTruthy();
    const quantidade = reader.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6 * 3600000 + 60000);
    expect(reader.mock.calls.length).toBeGreaterThan(quantidade);
  });
  it("permite atualização pontual com o automático desligado, sem reativá-lo", async () => {
    salvarConfigImportacao({ ativo: false, localidades: [] });
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: unknown) =>
          new Response(await reader(String(url)), {
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          }),
      ),
    );
    iniciarMonitorCalendarios();
    expect(enfileirarCalendarios([escopo], true).agendados).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(statusCalendarios().calendarios[0].status).toBe("parcial");
    expect(configImportacao().ativo).toBe(false);
  });
  it("não salva o resultado de uma localidade que foi alterada durante a consulta", async () => {
    let liberar!: () => void;
    const gate = new Promise<void>((resolve) => {
      liberar = resolve;
    });
    const pendente = sincronizarCalendario(escopo, true, async (url, init) => {
      await gate;
      return reader(url, init);
    });
    salvarConfigImportacao({
      ativo: true,
      localidades: [
        {
          tribunal: escopo.tribunal,
          orgao: escopo.orgao,
          municipio: "Campinas",
          uf: "SP",
          instancia: "primeiro",
        },
      ],
    });
    liberar();
    const c = await pendente;
    expect(c?.status).toBe("localidade_pendente");
    expect(c?.eventos).toEqual([]);
    expect(c?.proxima_tentativa).toBe(0);
  });
  it("recusa datas inválidas e permite restaurar todos os ajustes", async () => {
    const a = (await sincronizarCalendario(escopo, false, reader))!;
    expect(() =>
      salvarAjustes(a.chave, {
        adicionar: [
          {
            tipo: "feriado",
            inicio: "2026-02-30",
            fim: "2026-02-30",
            descricao: "X",
          },
        ],
        ignorar: [],
      }),
    ).toThrow(/Datas inválidas/);
    expect(() =>
      salvarAjustes(a.chave, {
        adicionar: [
          {
            tipo: "feriado",
            inicio: "2027-01-01",
            fim: "2027-01-01",
            descricao: "X",
          },
        ],
        ignorar: [],
      }),
    ).toThrow(/ano/);
    salvarAjustes(a.chave, { adicionar: [], ignorar: [a.eventos[0].id] });
    salvarAjustes(a.chave, { adicionar: [], ignorar: [] });
    expect(eventosEfetivos(lerCalendario(a.chave)!)).toEqual(a.eventos);
  });
});

describe("contagem com expediente parcial e leitura protegida", () => {
  const cal = {
    tribunal: "TRF3",
    orgao: "1ª Vara Federal de São Paulo",
    inicio: "2026-01-01",
    fim: "2026-12-31",
    fonte,
    conferido: true,
    feriados: [],
    suspensoes: [],
    expediente_parcial: [
      { data: "2026-02-18", motivo: "Cinzas, início às 14h" },
    ],
  };
  it("conta expediente parcial intermediário e prorroga início/vencimento", () => {
    const i = { ...input, base: "2026-02-17", dias: 1 };
    expect(calcularPrazo(cal.tribunal, cal.orgao, i, [cal]).inicio).toBe(
      "2026-02-19",
    );
    expect(
      calcularPrazo(
        cal.tribunal,
        cal.orgao,
        { ...input, base: "2026-02-16", dias: 2 },
        [cal],
      ).termino,
    ).toBe("2026-02-19");
    expect(
      calcularPrazo(
        cal.tribunal,
        cal.orgao,
        { ...input, base: "2026-02-16", dias: 3 },
        [cal],
      ).termino,
    ).toBe("2026-02-19");
  });
  it("não acessa hosts arbitrários, mesmo via redirecionamento oficial", async () => {
    const fake = vi.fn(
      async () =>
        new Response("", {
          status: 302,
          headers: { location: "https://example.com/calendario" },
        }),
    );
    vi.stubGlobal("fetch", fake);
    await expect(lerFonteOficial("https://example.com/")).rejects.toThrow(
      /autorizado/,
    );
    expect(fake).not.toHaveBeenCalled();
    await expect(lerFonteOficial(fonte)).rejects.toThrow(/autorizado/);
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("preserva acentos das fontes ISO-8859-1 e compartilha a leitura concorrente", async () => {
    const body = Buffer.from("Feriados de S\xe3o Paulo", "latin1");
    const fake = vi.fn(
      async () =>
        new Response(body, {
          headers: { "Content-Type": "text/html; charset=iso-8859-1" },
        }),
    );
    vi.stubGlobal("fetch", fake);
    const r = await Promise.all([
      lerFonteOficial(fonte),
      lerFonteOficial(fonte),
    ]);
    expect(r).toEqual(["Feriados de São Paulo", "Feriados de São Paulo"]);
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("não aceita conteúdo excessivo como calendário", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("x".repeat(2_000_001))),
    );
    await expect(lerFonteOficial(fonte)).rejects.toThrow(/limite/);
  });
});
