import { describe, expect, it } from "vitest";
import {
  buildGoogleEvent,
  DEFAULT_GOOGLE_CALENDAR_CONFIG,
  GoogleCalendarError,
  saveGoogleCalendarConfig,
  type GoogleCalendarDestinationConfig,
} from "../src/services/googleCalendarService";
import type { PericiaAgendada } from "../src/services/periciasAgendadasService";

function pericia(overrides: Partial<PericiaAgendada> = {}): PericiaAgendada {
  return {
    id: 999_991,
    card_id: "manual:teste-google",
    tipo: "Perícia médica",
    origem: "medica",
    nome: "CLIENTE TESTE",
    telefone: "(11) 99999-8888",
    telefone_digits: "5511999998888",
    processo: "0000000-00.2026.0.00.0000",
    data: "20/12/2026",
    horario: "23:30",
    local: "Fórum de Teste",
    whatsapp: null,
    profissional_perito: "PROFISSIONAL TESTE",
    data_hora_ms: Date.now(),
    status: "ativa",
    substituida_por_id: null,
    fonte: "whatsapp",
    ultimo_lembrete_em: null,
    ultimo_lembrete_log_id: null,
    lembrete_ack: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function destination(overrides: Partial<GoogleCalendarDestinationConfig> = {}): GoogleCalendarDestinationConfig {
  return { ...DEFAULT_GOOGLE_CALENDAR_CONFIG.destinations[0], enabled: true, calendarId: "agenda-1", calendarName: "Agenda 1", ...overrides };
}

describe("integração com o Google Agenda", () => {
  it("monta um evento com horário, término e campos configurados", () => {
    const event = buildGoogleEvent(pericia(), destination(), 90) as Record<string, any>;

    expect(event.summary).toBe("Perícia médica — CLIENTE TESTE");
    expect(event.start.dateTime).toBe("2026-12-20T23:30:00-03:00");
    expect(event.end.dateTime).toBe("2026-12-21T01:00:00-03:00");
    expect(event.description).toContain("Processo: 0000000-00.2026.0.00.0000");
    expect(event.location).toBe("Fórum de Teste");
    expect(event.extendedProperties.private.disparazapId).toBe("999991");
    expect(event.reminders.overrides).toEqual([
      { method: "popup", minutes: 1440 },
      { method: "popup", minutes: 60 },
    ]);
  });

  it("cria evento de dia inteiro quando não há horário", () => {
    const event = buildGoogleEvent(pericia({ horario: null }), destination({ includePhone: false, includeLocation: false }), 60) as Record<string, any>;

    expect(event.start).toEqual({ date: "2026-12-20" });
    expect(event.end).toEqual({ date: "2026-12-21" });
    expect(event.description).not.toContain("Telefone:");
    expect(event.location).toBeUndefined();
  });

  it("bloqueia duas destinações ativas apontando para a mesma agenda", () => {
    expect(() => saveGoogleCalendarConfig({
      syncEnabled: true,
      durationMinutes: 60,
      destinations: [destination(), destination({ destination: 2 })],
    })).toThrow(GoogleCalendarError);
  });
});
