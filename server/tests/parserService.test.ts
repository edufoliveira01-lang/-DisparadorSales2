import { describe, expect, it } from "vitest";
import { isPericiaCompleta, parseCardDescription, parseCardDescriptionComOrigem } from "../src/services/parserService";

describe("parseCardDescription", () => {
  it("extrai 1 perícia com cabeçalho PERÍCIA MÉDICA", () => {
    const desc = `
PERÍCIA MÉDICA:
TIPO DE PERÍCIA: Psiquiátrica
DATA: 10/08/2026
HORÁRIO: 14:00
LOCAL: Rua das Flores, 100
NOME: João da Silva
`;
    const result = parseCardDescription(desc);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tipo: "Psiquiátrica",
      data: "10/08/2026",
      horario: "14:00",
      local: "Rua das Flores, 100",
      nome: "João da Silva",
    });
  });

  it("extrai 2 perícias quando há os dois cabeçalhos, na ordem em que aparecem", () => {
    const desc = `
PERÍCIA MÉDICA:
TIPO DE PERÍCIA: Ortopédica
DATA: 01/09/2026
HORÁRIO: 09:00
LOCAL: Clínica A
NOME: Maria Souza

PERÍCIA SOCIAL:
TIPO DE PERÍCIA: Assistente Social
DATA: 02/09/2026
HORÁRIO: 10:30
LOCAL: Clínica B
NOME: Maria Souza
`;
    const result = parseCardDescription(desc);
    expect(result).toHaveLength(2);
    expect(result[0].tipo).toBe("Ortopédica");
    expect(result[0].data).toBe("01/09/2026");
    expect(result[1].tipo).toBe("Assistente Social");
    expect(result[1].local).toBe("Clínica B");
  });

  it("respeita a ordem inversa quando SOCIAL aparece antes de MÉDICA no texto", () => {
    const desc = `
PERICIA SOCIAL:
TIPO DE PERICIA: Social
DATA: 05/05/2026
HORARIO: 08:00
LOCAL: Local Social
NOME: Carlos

PERICIA MEDICA:
TIPO DE PERICIA: Medica
DATA: 06/05/2026
HORARIO: 09:00
LOCAL: Local Medico
NOME: Carlos
`;
    const result = parseCardDescription(desc);
    expect(result).toHaveLength(2);
    expect(result[0].tipo).toBe("Social");
    expect(result[1].tipo).toBe("Medica");
  });

  it("trata como 1 perícia genérica quando não há cabeçalho de bloco", () => {
    const desc = `
TIPO DE PERÍCIA: Avaliação Geral
DATA: 20/10/2026
HORÁRIO: 15:00
LOCAL: Fórum Central
NOME: Ana Paula
`;
    const result = parseCardDescription(desc);
    expect(result).toHaveLength(1);
    expect(result[0].tipo).toBe("Avaliação Geral");
    expect(result[0].nome).toBe("Ana Paula");
  });

  it("é tolerante a campos fora de ordem", () => {
    const desc = `
PERÍCIA MÉDICA:
NOME: Pedro Alves
LOCAL: Hospital Central
DATA: 12/12/2026
TIPO DE PERÍCIA: Neurológica
HORÁRIO: 11:15
`;
    const result = parseCardDescription(desc);
    expect(result[0]).toEqual({
      tipo: "Neurológica",
      data: "12/12/2026",
      horario: "11:15",
      local: "Hospital Central",
      nome: "Pedro Alves",
    });
  });

  it("é tolerante a HORARIO sem acento, minúsculas e sem dois pontos", () => {
    const desc = `
pericia medica
tipo de pericia Clínica Geral
data 01/01/2027
horario 08:30
local Posto de Saúde
nome Fulano de Tal
`;
    const result = parseCardDescription(desc);
    expect(result[0]).toEqual({
      tipo: "Clínica Geral",
      data: "01/01/2027",
      horario: "08:30",
      local: "Posto de Saúde",
      nome: "Fulano de Tal",
    });
  });

  it("marca perícia como incompleta quando falta um campo obrigatório, sem quebrar", () => {
    const desc = `
PERÍCIA MÉDICA:
TIPO DE PERÍCIA: Psiquiátrica
DATA: 10/08/2026
LOCAL: Rua das Flores, 100
NOME: João da Silva
`;
    const result = parseCardDescription(desc);
    expect(result).toHaveLength(1);
    expect(result[0].horario).toBe("");
    expect(isPericiaCompleta(result[0])).toBe(false);
  });

  it("marca perícia completa como completa", () => {
    const pericia = {
      tipo: "X",
      data: "X",
      horario: "X",
      local: "X",
      nome: "X",
    };
    expect(isPericiaCompleta(pericia)).toBe(true);
  });

  it("retorna array vazio para descrição vazia ou em branco", () => {
    expect(parseCardDescription("")).toEqual([]);
    expect(parseCardDescription("   \n  ")).toEqual([]);
  });

  it("não confunde o campo LOCAL com palavras que começam com 'local' (ex: Localização)", () => {
    const desc = `
TIPO DE PERÍCIA: Geral
DATA: 01/01/2026
HORÁRIO: 10:00
LOCALIZAÇÃO: não deveria ser capturado
LOCAL: Endereço Correto
NOME: Teste
`;
    const result = parseCardDescription(desc);
    expect(result[0].local).toBe("Endereço Correto");
  });

  it("captura o segundo bloco corretamente até o fim da descrição quando é o último", () => {
    const desc = `
PERÍCIA MÉDICA:
TIPO DE PERÍCIA: A
DATA: 01/01/2026
HORÁRIO: 10:00
LOCAL: Local A
NOME: Nome A

PERÍCIA SOCIAL:
TIPO DE PERÍCIA: B
DATA: 02/02/2026
HORÁRIO: 11:00
LOCAL: Local B
NOME: Nome B
`;
    const result = parseCardDescription(desc);
    expect(result[1]).toEqual({
      tipo: "B",
      data: "02/02/2026",
      horario: "11:00",
      local: "Local B",
      nome: "Nome B",
    });
  });

  it("card real: campo 'TIPO:' com valor 'PERÍCIA MÉDICA' não deve ser confundido com cabeçalho de bloco (1 perícia só)", () => {
    const desc = `TIPO: PERÍCIA MÉDICA;
DATA: 14/07/2026;
HORÁRIO: 15:00;
LOCAL: sede deste Juizado Especial Federal, AVENIDA ANTONIO EMMERICH, 1238 - VILA CASCATINHA - SÃO VICENTE;
NOME: GENI DE FATIMA FURTADO;
PROCESSO: 5001306-35.2026.4.03.6321;
PROFISSIONAL/PERITO: DIEGO ABAD DOS SANTOS

EMAIL ORIGINAL:
Processo: 50013063520264036321 1ª Vara Gabinete JEF de São Vicente
PROCEDIMENTO DO JUIZADO ESPECIAL CÍVEL Despacho Processo: 50013063520264036321 PARTE: GENI DE FATIMA FURTADO - POLO ATIVO
ADVOGADO: ANTONIO MESSIAS SALES JUNIOR - OAB 346457/SP`;

    const result = parseCardDescription(desc);
    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      tipo: "PERÍCIA MÉDICA",
      data: "14/07/2026",
      horario: "15:00",
      local: "sede deste Juizado Especial Federal, AVENIDA ANTONIO EMMERICH, 1238 - VILA CASCATINHA - SÃO VICENTE",
      nome: "GENI DE FATIMA FURTADO",
    });
    expect(isPericiaCompleta(result[0])).toBe(true);
  });

  it("card real com 2 perícias sem cabeçalho: cada 'TIPO:' começa um bloco novo, e a origem é detectada pelo próprio valor do TIPO", () => {
    const desc = `TIPO: PERÍCIA MÉDICA;
DATA: 14/07/2026;
HORÁRIO: 15:00;
LOCAL: sede deste Juizado Especial Federal, AVENIDA ANTONIO EMMERICH, 1238 - VILA CASCATINHA - SÃO VICENTE;
NOME: GENI DE FATIMA FURTADO;
PROCESSO: 5001306-35.2026.4.03.6321;
PROFISSIONAL/PERITO: DIEGO ABAD DOS SANTOS

TIPO: PERÍCIA SOCIAL;
DATA: 04/08/2026;
HORÁRIO: 14:00;
LOCAL: residência do autor;
NOME: GENI DE FATIMA FURTADO;
PROCESSO: 5001306-35.2026.4.03.6321;
PROFISSIONAL/PERITO: ANA LUCIA VALERIO

EMAIL ORIGINAL:
texto da intimação original que deve ser ignorado...`;

    const result = parseCardDescriptionComOrigem(desc);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({
      tipo: "PERÍCIA MÉDICA",
      data: "14/07/2026",
      horario: "15:00",
      local: "sede deste Juizado Especial Federal, AVENIDA ANTONIO EMMERICH, 1238 - VILA CASCATINHA - SÃO VICENTE",
      nome: "GENI DE FATIMA FURTADO",
      origem: "medica",
    });
    expect(result[1]).toEqual({
      tipo: "PERÍCIA SOCIAL",
      data: "04/08/2026",
      horario: "14:00",
      local: "residência do autor",
      nome: "GENI DE FATIMA FURTADO",
      origem: "social",
    });
    expect(result.every(isPericiaCompleta)).toBe(true);
  });

  it("remove ';' e ',' finais dos campos capturados", () => {
    const desc = `
TIPO: Social;
DATA: 01/01/2026,
HORARIO: 10:00;
LOCAL: Rua A, 123;
NOME: Fulano de Tal;
`;
    const result = parseCardDescription(desc);
    expect(result[0]).toEqual({
      tipo: "Social",
      data: "01/01/2026",
      horario: "10:00",
      local: "Rua A, 123",
      nome: "Fulano de Tal",
    });
  });
});
