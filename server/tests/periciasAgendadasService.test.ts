import { afterEach, describe, expect, it } from "vitest";
import {
  createPericiaAgendadaManual,
  deletePericiaAgendada,
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
});
