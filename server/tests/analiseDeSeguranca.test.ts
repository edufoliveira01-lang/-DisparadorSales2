import { describe, expect, it } from "vitest";

import { analiseDeSeguranca, completarComRegraDeSeguranca, type AnaliseCodex } from "../src/services/djen/classifier";

const TEXTO =
  "PODER JUDICIÁRIO 1ª Vara Federal de Santos Praça Barão do Rio Branco, 30, Centro, Santos - SP - CEP: 11010-040 https://www.trf3.jus.br/balcao-virtual PROCEDIMENTO COMUM CÍVEL (7) Nº 5001448-31.2025.4.03.6141 AUTOR: MAYARA MIRANDA DE SOUZA ADVOGADO do(a) AUTOR: ANTONIO MESSIAS SALES JUNIOR - SP346457 ADVOGADO do(a) AUTOR: BIANCA ALVES DA SILVA FERREIRA - SP442285 REU: INSTITUTO NACIONAL DO SEGURO SOCIAL - INSS ATO ORDINATÓRIO Ficam as partes intimadas da perícia designada para o dia 03 de dezembro de 2026, às 16:00 horas, na Sala de Perícia desta Subseção Judiciária, sito endereço à Praça Barão do Rio Branco nº 30, Centro, Santos/SP (3º andar), consoante determinado na decisão id. 599401127. Ato ordinatório praticado por delegação, nos termos da Portaria Conjunta nº 01/2020 - SANT-DSUJ/SANT-CPE, disponibilizada no Diário Eletrônico de 31/01/2020. Santos, 13 de novembro de 2026.";

describe("rede de segurança de perícia e audiência", () => {
  it("classifica como perícia o ato ordinatório que designa data e horário (caso real da Mayara)", () => {
    const a = analiseDeSeguranca(TEXTO);
    expect(a).not.toBeNull();
    expect(a!.categorias).toEqual(["pericia"]);
    expect(a!.agendamento.data).toBe("03 de dezembro de 2026");
    expect(a!.agendamento.horario).toMatch(/^16:00/);
    expect(a!.alertas.join(" ")).toMatch(/confira/i);
  });

  it("não classifica perícia só determinada, cancelada ou condicional", () => {
    expect(analiseDeSeguranca("Designo perícia médica; o perito informará a data. Intimem-se.")).toBeNull();
    expect(analiseDeSeguranca("Perícia designada para o dia 03/12/2026 às 16:00 foi cancelada.")).toBeNull();
    expect(analiseDeSeguranca("Caso seja designada a perícia, será informado o dia 03/12/2026 às 16:00.")).toBeNull();
  });

  it("reconhece data numérica e audiência", () => {
    const a = analiseDeSeguranca("Audiência de instrução designada para 10/12/2026 às 14h30 na sala 3 do fórum.");
    expect(a?.categorias).toEqual(["audiencia"]);
  });

  it("acrescenta a categoria quando a IA respondeu mas deixou passar", () => {
    const base: AnaliseCodex = {
      categorias: [], resultado: "nao_identificado", resumo: "Sem prazo.", justificativa: "Sem prazo.", evidencias: [],
      agendamento: { data: null, horario: null, local: null },
      providencia: { tipo: "indeterminado", descricao: null, prazo_texto: null, responsavel: "indeterminado" }, alertas: [],
    };
    const r = completarComRegraDeSeguranca(base, TEXTO);
    expect(r.categorias).toContain("pericia");
    expect(r.agendamento.data).toBe("03 de dezembro de 2026");
  });

  it("não mexe no que a IA já classificou", () => {
    const base = { categorias: ["pericia"], resultado: "nao_identificado", resumo: "x", justificativa: "x", evidencias: [], agendamento: { data: null, horario: null, local: null }, providencia: { tipo: "ciencia", descricao: null, prazo_texto: null, responsavel: "indeterminado" }, alertas: [] } as unknown as AnaliseCodex;
    expect(completarComRegraDeSeguranca(base, TEXTO)).toBe(base);
  });
});

import { validarAnaliseCodex, dataNoTexto, horaNoTexto } from "../src/services/djen/classifier";

describe("a IA escreve a data de outro jeito (causa real da falha da perícia da Mayara)", () => {
  it("data e hora equivalentes são reconhecidas pelo valor", () => {
    expect(dataNoTexto(TEXTO, "03/12/2026")).toBe(true);
    expect(dataNoTexto(TEXTO, "3 de dezembro de 2026")).toBe(true);
    expect(dataNoTexto(TEXTO, "04/12/2026")).toBe(false);
    expect(horaNoTexto(TEXTO, "16:00")).toBe(true);
    expect(horaNoTexto(TEXTO, "16h")).toBe(true);
    expect(dataNoTexto(TEXTO, "2026-12-03")).toBe(true);
    expect(dataNoTexto(TEXTO, "2026-12-04")).toBe(false);
    expect(horaNoTexto(TEXTO, "17:00")).toBe(false);
  });

  it("uma análise da IA com data 03/12/2026 e hora 16:00 é aceita como perícia", () => {
    const aceita = validarAnaliseCodex({
      categorias: ["pericia"], resultado: "nao_identificado", resumo: "Perícia designada.", justificativa: "O ato ordinatório intima as partes da perícia designada.",
      evidencias: [{ categoria: "pericia", trecho: "Ficam as partes intimadas da perícia designada para o dia 03 de dezembro de 2026, às 16:00 horas" }],
      agendamento: { data: "03/12/2026", horario: "16:00", local: null },
      providencia: { tipo: "ciencia", descricao: null, prazo_texto: null, responsavel: "indeterminado" }, alertas: [],
    }, TEXTO);
    expect(aceita.categorias).toContain("pericia");
  });

  it("data que NÃO está no texto continua sendo rejeitada", () => {
    expect(() => validarAnaliseCodex({
      categorias: ["pericia"], resultado: "nao_identificado", resumo: "x", justificativa: "y",
      evidencias: [{ categoria: "pericia", trecho: "Ficam as partes intimadas da perícia designada para o dia 03 de dezembro de 2026" }],
      agendamento: { data: "05/12/2026", horario: "16:00", local: null },
      providencia: { tipo: "ciencia", descricao: null, prazo_texto: null, responsavel: "indeterminado" }, alertas: [],
    }, TEXTO)).toThrow(/agendamento\.data/);
  });

  it("o local da regra de segurança para antes de «consoante determinado»", () => {
    const a = analiseDeSeguranca(TEXTO);
    expect(a?.agendamento.local).toMatch(/Praça Barão do Rio Branco nº 30/);
    expect(a?.agendamento.local).not.toMatch(/consoante/);
  });
});

describe("local reescrito pela IA não derruba a análise (causa final da perícia da Mayara)", () => {
  const base = (local: string | null) => ({
    categorias: ["pericia"], resultado: "nao_identificado", resumo: "Perícia designada.", justificativa: "O ato ordinatório intima da perícia designada.",
    evidencias: [{ categoria: "pericia", trecho: "Ficam as partes intimadas da perícia designada para o dia 03 de dezembro de 2026, às 16:00 horas" }],
    agendamento: { data: "2026-12-03", horario: "16:00", local },
    providencia: { tipo: "ciencia", descricao: null, prazo_texto: null, responsavel: "indeterminado" }, alertas: [] as string[],
  });
  it("local parafraseado (o que a IA devolveu) é aceito, com alerta", () => {
    const r = validarAnaliseCodex(base("Sala de Perícia desta Subseção Judiciária, Praça Barão do Rio Branco nº 30, Centro, Santos/SP (3º andar)"), TEXTO);
    expect(r.categorias).toContain("pericia");
    expect(r.agendamento.local).toMatch(/Barão do Rio Branco/);
    expect(r.alertas.join(" ")).toMatch(/resumido pela IA/);
  });
  it("local inventado é descartado (campo vazio) sem perder a perícia", () => {
    const r = validarAnaliseCodex(base("Fórum Central de São Paulo, Avenida Paulista 1000, sala 12"), TEXTO);
    expect(r.categorias).toContain("pericia");
    expect(r.agendamento.local).toBeNull();
    expect(r.alertas.join(" ")).toMatch(/não confere/);
  });
});

import { dataPadrao, dataHoraAgendamento } from "../src/services/djen/periciaIntegration";
describe("data em ISO devolvida pela IA entra no controle de perícias", () => {
  it("dataPadrao reconhece ISO, numérica e por extenso", () => {
    expect(dataPadrao("2026-12-03")).toBe("03/12/2026");
    expect(dataPadrao("03/12/2026")).toBe("03/12/2026");
    expect(dataPadrao("03 de dezembro de 2026")).toBe("03/12/2026");
    expect(dataPadrao("sem data")).toBeNull();
  });
  it("data e hora ISO viram um instante válido", () => {
    expect(Number.isFinite(dataHoraAgendamento("2026-12-03", "16:00"))).toBe(true);
  });
});

import { horarioPadrao } from "../src/services/djen/periciaIntegration";
describe("horário", () => {
  it("lê 16:00, 9:30, 16h e 14h30", () => {
    expect(horarioPadrao("16:00")).toBe("16:00");
    expect(horarioPadrao("9:30")).toBe("09:30");
    expect(horarioPadrao("16h")).toBe("16:00");
    expect(horarioPadrao("14h30")).toBe("14:30");
    expect(horarioPadrao("25:00")).toBeNull();
  });
});
