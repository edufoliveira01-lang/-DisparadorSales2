import { describe, expect, it } from "vitest";
import {
  extractNomeFromCardTitle,
  isPericiaCompleta,
  parseCardDescription,
  parseCardDescriptionComOrigem,
  sortPericiasByDate,
} from "../src/services/parserService";

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

  it("ordena perícias pela data mais próxima, independente da ordem no texto", () => {
    // Mockando a data atual para garantir consistência no teste
    const originalNow = Date.now;
    Date.now = () => new Date("2026-08-01T12:00:00Z").getTime();

    try {
      const desc = `
PERÍCIA MÉDICA:
TIPO DE PERÍCIA: Ortopédica
DATA: 10/09/2026
HORÁRIO: 09:00
LOCAL: Clínica A
NOME: Maria Souza

PERÍCIA SOCIAL:
TIPO DE PERÍCIA: Assistente Social
DATA: 05/08/2026
HORÁRIO: 10:30
LOCAL: Clínica B
NOME: Maria Souza
`;
      // Usamos as funções já importadas no topo do arquivo
      const pericias = parseCardDescriptionComOrigem(desc);
      const result = sortPericiasByDate(pericias);

      expect(result).toHaveLength(2);
      // Social (05/08) é mais próxima de 01/08 que Médica (10/09)
      expect(result[0].origem).toBe("social");
      expect(result[1].origem).toBe("medica");
    } finally {
      Date.now = originalNow;
    }
  });

  it("extrai o nome do cliente de um título de card complexo", () => {
    const title = "P. SOCIAL - 05/08/2026 - 15:36 - FABIOLA CARLA ALBERTINI BORGES E SILVA - 5002573-34.2025.4.03.6141";
    const nome = extractNomeFromCardTitle(title);
    expect(nome).toBe("FABIOLA CARLA ALBERTINI BORGES E SILVA");
  });

  it("extrai o nome do cliente de um título com menos partes", () => {
    const title = "MÉDICA - 10/09/2026 - JOÃO DA SILVA";
    const nome = extractNomeFromCardTitle(title);
    expect(nome).toBe("JOÃO DA SILVA");
  });

  it("mantém o título original se não seguir o padrão de hífens", () => {
    const title = "Card Urgente de Maria";
    const nome = extractNomeFromCardTitle(title);
    expect(nome).toBe("Card Urgente de Maria");
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
