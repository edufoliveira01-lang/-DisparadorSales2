import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { aliasDoTribunal, atualizarDoDataJud, buscarNoDataJud, datajudEmDia, diaDoDataJud, normalizarDataJud, salvarChaveDoDataJud } from "../src/services/djen/datajud";

const CHAVE = "50226768820254036100";
const RESPOSTA = { hits: { hits: [
  { _source: { numeroProcesso: CHAVE, classe: { nome: "Procedimento do Juizado Especial Cível" }, orgaoJulgador: { nome: "1ª Vara Gabinete JEF" }, dataAjuizamento: "20250901000000", grau: "JE",
    assuntos: [{ nome: "Auxílio-Doença Previdenciário" }, { nome: "Auxílio-Doença Previdenciário" }, { nome: "Benefício Assistencial" }],
    movimentos: [{ nome: "Distribuição", dataHora: "2025-09-01T10:00:00.000Z" }, { nome: "Juntada de Petição", dataHora: "2025-11-10T15:30:00.000Z" }] } },
  { _source: { numeroProcesso: CHAVE, classe: { nome: "Outra" }, movimentos: [] } },
] } };
const http = (corpo: unknown, status = 200) => (async () => new Response(JSON.stringify(corpo), { status })) as unknown as typeof fetch;
let seq = 0;
const ficha = (extra: Record<string, string> = {}) => Number(db.prepare("INSERT INTO gestao_processos(numero,chave,pasta,status,classe,assunto,orgao,data_distribuicao) VALUES (?,?,?,'ativo',?,?,?,?)")
  .run(CHAVE, CHAVE, `D-${++seq}`, extra.classe ?? "", extra.assunto ?? "", extra.orgao ?? "", extra.dist ?? "").lastInsertRowid);

beforeEach(() => { db.exec("DELETE FROM gestao_datajud; DELETE FROM gestao_processos;"); db.prepare("DELETE FROM settings WHERE chave='datajud_chave'").run(); });

describe("DataJud", () => {
  it("descobre o alias do tribunal pelo número CNJ", () => {
    expect(aliasDoTribunal(CHAVE)).toBe("trf3");
    expect(aliasDoTribunal("00012340120258260100")).toBe("tjsp");
    expect(aliasDoTribunal("00012340120255020100")).toBe("trt2");
    expect(aliasDoTribunal("123")).toBeNull();
  });
  it("lê as duas formas de data", () => {
    expect(diaDoDataJud("20250901000000")).toBe("2025-09-01");
    expect(diaDoDataJud("2025-09-01T00:00:00.000Z")).toBe("2025-09-01");
    expect(diaDoDataJud(null)).toBe("");
  });
  it("normaliza: usa o registro mais completo, junta assuntos sem repetir e acha o último movimento", () => {
    expect(normalizarDataJud(RESPOSTA)).toMatchObject({ classe: "Procedimento do Juizado Especial Cível", assunto: "Auxílio-Doença Previdenciário; Benefício Assistencial", orgao: "1ª Vara Gabinete JEF", ajuizamento: "2025-09-01", movimentos: 2, ultimo_movimento: "Juntada de Petição", ultimo_movimento_em: "2025-11-10" });
    expect(normalizarDataJud({ hits: { hits: [] } })).toBeNull();
  });
  it("chave recusada vira mensagem clara", async () => {
    await expect(buscarNoDataJud(CHAVE, "k", http({}, 401))).rejects.toThrow(/recusou a chave/);
  });
  it("sem chave não consulta; com chave completa só o que está em branco e marca a consulta como em dia", async () => {
    ficha({ classe: "Classe digitada" });
    expect(await atualizarDoDataJud(CHAVE, http(RESPOSTA))).toBe("sem_chave");
    salvarChaveDoDataJud("abcdefghijklmnopqrstuvwxyz0123456789==");
    expect(await atualizarDoDataJud(CHAVE, http(RESPOSTA))).toBe("ok");
    const f = db.prepare("SELECT classe,assunto,orgao,data_distribuicao FROM gestao_processos").get() as Record<string, string>;
    expect(f).toEqual({ classe: "Classe digitada", assunto: "Auxílio-Doença Previdenciário; Benefício Assistencial", orgao: "1ª Vara Gabinete JEF", data_distribuicao: "2025-09-01" });
    expect(datajudEmDia(CHAVE)).toBe(true);
  });
  it("falha de rede é registrada sem quebrar", async () => {
    ficha(); salvarChaveDoDataJud("abcdefghijklmnopqrstuvwxyz0123456789==");
    expect(await atualizarDoDataJud(CHAVE, (async () => { throw new Error("x"); }) as unknown as typeof fetch)).toBe("falha");
    expect((db.prepare("SELECT status FROM gestao_datajud").get() as { status: string }).status).toBe("falha");
    expect(datajudEmDia(CHAVE)).toBe(false);
  });
  it("aceita a chave colada com o cabeçalho inteiro da documentação", async () => {
    ficha();
    salvarChaveDoDataJud('Authorization: APIKey abcdefghijklmnopqrstuvwxyz0123456789==');
    expect((db.prepare("SELECT valor FROM settings WHERE chave='datajud_chave'").get() as { valor: string } | undefined)).toBeDefined();
    expect(await atualizarDoDataJud(CHAVE, http(RESPOSTA))).toBe("ok");
  });
  it("chave com formato estranho é recusada", () => {
    expect(() => salvarChaveDoDataJud("curta")).toThrow();
  });
});
