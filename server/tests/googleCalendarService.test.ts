import { describe, expect, it } from "vitest";
import {
  buildGoogleEvent,
  DEFAULT_GOOGLE_CALENDAR_CONFIG,
  GoogleCalendarError,
  saveGoogleCalendarConfig,
  transferGoogleCalendarLinks,
  type GoogleCalendarDestinationConfig,
} from "../src/services/googleCalendarService";
import type { PericiaAgendada } from "../src/services/periciasAgendadasService";
import { db } from "../src/db";

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
  it("monta o título completo e um evento em horário fixo sem lembretes", () => {
    const event = buildGoogleEvent(pericia({ whatsapp: "SIM" }), destination({
      timingMode: "fixed_time",
      fixedTime: "23:00",
      durationMinutes: 60,
    })) as Record<string, any>;

    expect(event.summary).toBe("PERÍCIA MÉDICA - 20/12/2026 - 23:30 - CLIENTE TESTE - (11) 99999 - 8888 - 0000000-00.2026.0.00.0000");
    expect(event.start.dateTime).toBe("2026-12-20T23:00:00-03:00");
    expect(event.end.dateTime).toBe("2026-12-21T00:00:00-03:00");
    expect(event.description).toBe([
      "TIPO: PERÍCIA MÉDICA;",
      "DATA: 20/12/2026;",
      "HORÁRIO: 23:30;",
      "LOCAL: Fórum de Teste;",
      "NOME: CLIENTE TESTE;",
      "TELEFONE: (11) 99999 - 8888;",
      "WHATSAPP: SIM;",
      "PROCESSO: 0000000-00.2026.0.00.0000;",
      "PROFISSIONAL/PERITO: PROFISSIONAL TESTE;",
    ].join("\n"));
    expect(event.location).toBe("Fórum de Teste");
    expect(event.extendedProperties.private.disparazapId).toBe("999991");
    expect(event.reminders).toEqual({ useDefault: false, overrides: [] });
  });

  it("cria período de dia inteiro começando cinco dias antes e incluindo o dia da perícia", () => {
    const event = buildGoogleEvent(pericia(), destination({
      timingMode: "all_day",
      startDaysBefore: 5,
      endDaysAfter: 0,
      includePhone: false,
      includeLocation: false,
    })) as Record<string, any>;

    expect(event.start).toEqual({ date: "2026-12-15" });
    expect(event.end).toEqual({ date: "2026-12-21" });
    expect(event.description).toContain("TELEFONE: (11) 99999 - 8888;");
    expect(event.location).toBeUndefined();
  });

  it("usa o horário da perícia e a duração independente do destino", () => {
    const event = buildGoogleEvent(pericia(), destination({ timingMode: "appointment_time", durationMinutes: 90 })) as Record<string, any>;

    expect(event.start.dateTime).toBe("2026-12-20T23:30:00-03:00");
    expect(event.end.dateTime).toBe("2026-12-21T01:00:00-03:00");
  });

  it("bloqueia destinos ativos apontando para a mesma agenda", () => {
    expect(() => saveGoogleCalendarConfig({
      syncEnabled: true,
      destinations: [destination(), destination({ destination: 2 })],
    })).toThrow(GoogleCalendarError);
  });

  it("aceita mais de dois destinos com identificadores independentes", () => {
    const config = saveGoogleCalendarConfig({
      syncEnabled: false,
      destinations: [
        destination(),
        destination({ destination: 2, calendarId: "agenda-2" }),
        destination({ destination: 3, calendarId: "agenda-3" }),
      ],
    });

    expect(config.destinations.map((item) => item.destination)).toEqual([1, 2, 3]);
  });

  it("transfere o vínculo para o novo registro em um reagendamento", () => {
    db.prepare("DELETE FROM google_calendar_event_links WHERE pericia_id IN (?, ?)").run(999_991, 999_992);
    db.prepare(
      `INSERT INTO google_calendar_event_links
         (pericia_id, destination, calendar_id, google_event_id)
       VALUES (?, ?, ?, ?)`
    ).run(999_991, 3, "agenda-3", "evento-reagendado");

    transferGoogleCalendarLinks(999_991, 999_992);

    const link = db.prepare(
      "SELECT pericia_id, google_event_id FROM google_calendar_event_links WHERE destination = 3 AND google_event_id = ?"
    ).get("evento-reagendado") as { pericia_id: number; google_event_id: string };
    expect(link).toEqual({ pericia_id: 999_992, google_event_id: "evento-reagendado" });
    db.prepare("DELETE FROM google_calendar_event_links WHERE pericia_id = ?").run(999_992);
  });
});
