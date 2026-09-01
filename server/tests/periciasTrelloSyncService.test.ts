import { describe, expect, it, vi } from "vitest";

vi.mock("../src/services/periciasAgendadasService", () => ({
  registrarPericiaAgendadaComResultado: vi.fn(),
}));
vi.mock("../src/services/trelloService", () => ({
  getCardsFromList: vi.fn(),
}));

import { montarPericiasDoCard } from "../src/services/periciasTrelloSyncService";

describe("montarPericiasDoCard", () => {
  it("usa título e vencimento quando o card não tem descrição", () => {
    const pericias = montarPericiasDoCard({
      id: "card-1",
      name: "P. SOCIAL - MARIA DE SOUZA",
      desc: "",
      due: "2026-09-10T13:30:00.000Z",
      shortUrl: "https://trello.com/c/card-1",
    });

    expect(pericias).toHaveLength(1);
    expect(pericias[0]).toMatchObject({
      tipo: "Perícia Social",
      origem: "social",
      nome: "MARIA DE SOUZA",
      data: "10/09/2026",
      horario: "10:30",
      telefone: "",
    });
  });

  it("completa uma descrição parcial com o vencimento do card", () => {
    const pericias = montarPericiasDoCard({
      id: "card-2",
      name: "P. MÉDICA - JOÃO DA SILVA",
      desc: "TIPO: Ortopédica\nNOME: JOÃO DA SILVA",
      due: "2026-09-11T15:00:00.000Z",
      shortUrl: "https://trello.com/c/card-2",
    });

    expect(pericias[0]).toMatchObject({
      tipo: "Ortopédica",
      nome: "JOÃO DA SILVA",
      data: "11/09/2026",
      horario: "12:00",
    });
  });

  it("usa data e horário do título quando não há vencimento", () => {
    const pericias = montarPericiasDoCard({
      id: "card-3",
      name: "AUDIÊNCIA - 15/09/2026 - 14:45 - ANA PAULA",
      desc: "",
      due: null,
      shortUrl: "https://trello.com/c/card-3",
    });

    expect(pericias[0]).toMatchObject({
      tipo: "Audiência",
      origem: "audiencia",
      nome: "ANA PAULA",
      data: "15/09/2026",
      horario: "14:45",
    });
  });
});
