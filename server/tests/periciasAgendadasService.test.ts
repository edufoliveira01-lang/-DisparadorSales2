import { afterEach, describe, expect, it } from "vitest";
import {
  createPericiaAgendadaManual,
  deletePericiaAgendada,
  detectarRemarcacao,
  getPericiaAgendada,
  PericiaAgendadaConflictError,
  PericiaAgendadaInputError,
} from "../src/services/periciasAgendadasService";

const criadas: number[] = [];

function dados(sufixo: string) {
  return {
    tipo: "Perícia Médica",
    nome: `CLIENTE MANUAL ${sufixo}`,
    telefone: "(11) 99999-8888",
    processo: "0000000-00.2026.0.00.0000",
    data: "20/12/2026",
    horario: "14:30",
    local: "Local de teste",
    whatsapp: "SIM",
    profissional_perito: "PROFISSIONAL TESTE",
  };
}

describe("criação manual de eventos do calendário", () => {
  afterEach(() => {
    while (criadas.length > 0) deletePericiaAgendada(criadas.pop()!);
  });

  it("cria um evento ativo com identificação manual e campos normalizados", () => {
    const criada = createPericiaAgendadaManual(dados("CRIACAO"));
    criadas.push(criada.id);

    expect(criada.card_id).toMatch(/^manual:/);
    expect(criada.status).toBe("ativa");
    expect(criada.origem).toBe("medica");
    expect(criada.telefone_digits).toBe("5511999998888");
    expect(criada.data).toBe("20/12/2026");
    expect(criada.horario).toBe("14:30");
  });

  it("rejeita um evento sem os campos obrigatórios", () => {
    expect(() => createPericiaAgendadaManual({ ...dados("INVALIDO"), nome: "" })).toThrow(PericiaAgendadaInputError);
  });

  it("não cria duplicidade ativa para o mesmo cliente, tipo, data e horário", () => {
    const entrada = dados("DUPLICADO");
    const criada = createPericiaAgendadaManual(entrada);
    criadas.push(criada.id);

    expect(() => createPericiaAgendadaManual(entrada)).toThrow(PericiaAgendadaConflictError);
  });

  it("trata como remarcação quando processo e telefone coincidem mesmo com nome abreviado", () => {
    const antiga = createPericiaAgendadaManual({
      ...dados("REMARCACAO"),
      nome: "JULIANA THEREZINHA DE LIBORIO TEBAR AZEVEDO",
      processo: "1025863-88.2025.8.26.0381",
      telefone: "(18) 99710-5161",
      data: "03/10/2026",
      horario: "08:00",
    });
    criadas.push(antiga.id);

    const nova = createPericiaAgendadaManual({
      ...dados("REMARCACAO"),
      nome: "JULIANA THEREZINHA DE LIBORIO TEBAR",
      processo: "1025863-88.2025.8.26.0381",
      telefone: "(18) 99710-5161",
      data: "09/10/2026",
      horario: "12:00",
    });
    criadas.push(nova.id);

    expect(getPericiaAgendada(antiga.id)).toMatchObject({
      status: "substituida",
      substituida_por_id: nova.id,
    });
    expect(getPericiaAgendada(nova.id)).toMatchObject({ status: "ativa", data: "09/10/2026" });
  });

  it("sinaliza a remarcação na Dashboard sem substituir o evento antes do envio", () => {
    const antiga = createPericiaAgendadaManual({
      ...dados("PREVIA"),
      processo: "5000001-22.2026.8.26.0001",
      data: "03/10/2026",
      horario: "08:00",
    });
    criadas.push(antiga.id);

    const remarcacao = detectarRemarcacao("card-trello-previa", {
      ...dados("PREVIA"),
      processo: "5000001-22.2026.8.26.0001",
      data: "09/10/2026",
      horario: "12:00",
      profissionalPerito: "PROFISSIONAL TESTE",
    });

    expect(remarcacao).toEqual({
      agendamento_anterior_id: antiga.id,
      data_anterior: "03/10/2026",
      horario_anterior: "08:00",
    });
    expect(getPericiaAgendada(antiga.id)?.status).toBe("ativa");
  });

  it("também sinaliza remarcação de audiência", () => {
    const antiga = createPericiaAgendadaManual({
      ...dados("AUDIENCIA"),
      tipo: "Audiência",
      processo: "5000002-33.2026.8.26.0001",
      data: "10/10/2026",
      horario: "15:00",
    });
    criadas.push(antiga.id);

    expect(detectarRemarcacao("card-audiencia", {
      ...dados("AUDIENCIA"),
      tipo: "Audiência",
      origem: "audiencia",
      processo: "5000002-33.2026.8.26.0001",
      data: "17/10/2026",
      horario: "16:00",
      profissionalPerito: "PROFISSIONAL TESTE",
    })).toMatchObject({
      agendamento_anterior_id: antiga.id,
      data_anterior: "10/10/2026",
      horario_anterior: "15:00",
    });
    expect(getPericiaAgendada(antiga.id)?.status).toBe("ativa");
  });
});
