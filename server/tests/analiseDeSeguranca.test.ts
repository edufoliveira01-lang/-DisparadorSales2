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
