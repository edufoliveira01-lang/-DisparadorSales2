import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { getSetting, setSetting } from "../src/services/settingsService";
import { GROUPS, initializeMessageTemplates, listMessageTemplates, saveMessageTemplate, deleteMessageTemplate, defaultRescheduleTemplate, type MessageTemplate } from "../src/services/messageTemplateService";
import { composeMessages, composeDispatch } from "../src/services/messageComposer";
import { createPericiaAgendadaManual, deletePericiaAgendada, getPericiaAgendada } from "../src/services/periciasAgendadasService";
import { listTemplates } from "../src/services/templateService";
import type { Pericia } from "../src/services/parserService";

initializeMessageTemplates();
let original: MessageTemplate[];
let settings: Record<string, string | null>;
const appointments: number[] = [];
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-01T12:00:00Z"));
  original = db.prepare("SELECT * FROM message_templates").all() as MessageTemplate[];
  const keys = Object.values(GROUPS).flatMap(scopes => Object.values(scopes).flatMap(c => c.key ? [c.key] : []));
  settings = Object.fromEntries([...keys, "message_templates_migrated"].map(key => [key, getSetting(key)]));
});
afterEach(() => {
  vi.useRealTimers();
  while (appointments.length) deletePericiaAgendada(appointments.pop()!);
  db.prepare("DELETE FROM message_templates").run();
  const insert = db.prepare("INSERT INTO message_templates (id, categoria, escopo, nome, mensagem, padrao) VALUES (?, ?, ?, ?, ?, ?)");
  for (const model of original) insert.run(model.id, model.categoria, model.escopo, model.nome, model.mensagem, model.padrao);
  for (const [key, value] of Object.entries(settings)) {
    if (value === null) db.prepare("DELETE FROM settings WHERE chave = ?").run(key);
    else setSetting(key, value);
  }
});

function model(categoria: string, escopo: string, mensagem: string, padrao = 1) {
  return saveMessageTemplate({ categoria, escopo, nome: "Modelo de teste", mensagem, padrao });
}
function pericia(overrides: Partial<Pericia> = {}): Pericia {
  return { nome: "CLIENTE TEMPLATE TESTE", telefone: "(11) 98765-4300", processo: "5001234-11.2026.8.26.0001", tipo: "Perícia Médica", origem: "medica", data: "14/10/2026", horario: "10:00", local: "Novo local", ...overrides };
}
function previous(event: Pericia) {
  const old = createPericiaAgendadaManual({ ...event, data: "09/10/2026", horario: "08:00", local: "Local anterior" });
  appointments.push(old.id);
  return old;
}

describe("modelos por categoria", () => {
  it("migra textos personalizados sem duplicar modelos ao reiniciar", () => {
    db.prepare("DELETE FROM message_templates").run();
    setSetting("message_templates_migrated", "false");
    setSetting("audiencia_online_mensagem", "Texto personalizado {{NOME}}");
    initializeMessageTemplates();
    expect(listMessageTemplates("audiencia").find(t => t.escopo === "online")?.mensagem).toBe("Texto personalizado {{NOME}}");
    const count = listMessageTemplates("audiencia").length;
    initializeMessageTemplates();
    expect(listMessageTemplates("audiencia")).toHaveLength(count);
  });
  it("um modelo alternativo não altera o envio até ser definido como padrão", () => {
    const before = getSetting("lembrete_hoje_mensagem");
    const alternate = model("lembrete", "hoje", "Novo texto {{NOME}}", 0);
    expect(alternate.padrao).toBe(0);
    expect(getSetting("lembrete_hoje_mensagem")).toBe(before);
    saveMessageTemplate({ ...alternate, padrao: 1 }, alternate.id);
    expect(getSetting("lembrete_hoje_mensagem")).toBe("Novo texto {{NOME}}");
    expect(listMessageTemplates("lembrete").filter(t => t.escopo === "hoje" && t.padrao)).toHaveLength(1);
  });
  it("promove outro modelo ao excluir o padrão e protege a última mensagem", () => {
    const alternate = model("cobranca", "pericia", "Cobrança nova");
    deleteMessageTemplate(alternate.id);
    const remaining = listMessageTemplates("cobranca").filter(t => t.escopo === "pericia");
    expect(remaining).toHaveLength(1);
    expect(remaining[0].padrao).toBe(1);
    expect(getSetting("cobranca_mensagem")).toBe(remaining[0].mensagem);
    expect(() => deleteMessageTemplate(remaining[0].id)).toThrow("pelo menos um");
  });
  it("rejeita conteúdo vazio, escopo inválido e sintaxe inválida", () => {
    expect(() => model("audiencia", "qualquer", "Texto")).toThrow();
    expect(() => model("audiencia", "online", " ")).toThrow();
    expect(() => model("audiencia", "online", "{{#each")).toThrow();
  });
  it("usa o padrão específico antes de Todos e volta ao geral após sua exclusão", () => {
    const general = defaultRescheduleTemplate("social")!;
    const specific = model("remarcacao", "social", "Social");
    expect(defaultRescheduleTemplate("social")?.id).toBe(specific.id);
    expect(defaultRescheduleTemplate("audiencia")?.id).toBe(general.id);
    deleteMessageTemplate(specific.id);
    expect(defaultRescheduleTemplate("social")?.id).toBe(general.id);
  });
});

describe("mensagens de remarcação", () => {
  it("usa dados antigos e novos sem substituir o agendamento na prévia", () => {
    const event = pericia();
    const old = previous(event);
    model("remarcacao", "todos", "{{NOME}} | {{DATA_ANTERIOR}} {{HORARIO_ANTERIOR}} {{LOCAL_ANTERIOR}} | {{NOVA_DATA}} {{NOVO_HORARIO}} {{NOVO_LOCAL}} | {{PROCESSO}}");
    const result = composeMessages({ cardId: "card-template", nomeCliente: event.nome, pericias: [event] }, listTemplates()[0].id);
    expect(result).toEqual(["CLIENTE TEMPLATE TESTE | 09/10/2026 08:00 Local anterior | 14/10/2026 10:00 Novo local | 5001234-11.2026.8.26.0001"]);
    expect(getPericiaAgendada(old.id)?.status).toBe("ativa");
  });
  it("captura dados antigos e novos junto com o texto antes da substituição no calendário", () => {
    const event = pericia();
    const old = previous(event);
    const composed = composeDispatch({ cardId: "card-snapshot", nomeCliente: event.nome, pericias: [event] }, listTemplates()[0].id);
    expect(composed.remarcacoes).toEqual([expect.objectContaining({
      agendamento_anterior_id: old.id,
      anterior: { data: "09/10/2026", horario: "08:00", local: "Local anterior" },
      novo: { data: "14/10/2026", horario: "10:00", local: "Novo local" },
    })]);
    expect(getPericiaAgendada(old.id)?.status).toBe("ativa");
  });

  it.each(["medica", "social", "audiencia"] as const)("seleciona remarcação específica de %s", scope => {
    const event = pericia({ origem: scope, tipo: scope === "audiencia" ? "Online" : scope === "social" ? "Perícia Social" : "Perícia Médica" });
    previous(event);
    model("remarcacao", scope, `${scope}: {{NOVA_DATA}}`);
    expect(composeMessages({ cardId: "card-scope", nomeCliente: event.nome, pericias: [event], modo: scope === "audiencia" ? "audiencia_online" : "template" }, listTemplates()[0].id)).toEqual([`${scope}: 14/10/2026`]);
  });
  it("usa texto normal quando não há alteração de data ou horário", () => {
    const event = pericia();
    const old = previous(event);
    const same = { ...event, data: old.data, horario: old.horario || "" };
    setSetting("audiencia_presencial_mensagem", "Normal {{DATA}}");
    expect(composeMessages({ cardId: "card-normal", nomeCliente: event.nome, pericias: [same], modo: "audiencia_presencial" }, null)).toEqual(["Normal 09/10/2026"]);
  });
  it("rejeita mensagens vazias após a substituição das variáveis", () => {
    const event = pericia();
    previous(event);
    model("remarcacao", "todos", "{{VARIAVEL_INEXISTENTE}}");
    expect(() => composeMessages({ cardId: "card-vazio", nomeCliente: event.nome, pericias: [event] }, listTemplates()[0].id)).toThrow("mensagem ficou vazia");
  });
  it("mantém o texto normal da perícia que não mudou no envio com dois compromissos", () => {
    const event = pericia();
    previous(event);
    model("remarcacao", "todos", "Remarcado {{NOVA_DATA}}");
    const second = pericia({ tipo: "Perícia Social", origem: "social", data: "15/10/2026" });
    const result = composeMessages({ cardId: "card-misto", nomeCliente: event.nome, pericias: [event, second] }, listTemplates()[0].id);
    expect(result).toHaveLength(2);
    expect(result[0]).toBe("Remarcado 14/10/2026");
    expect(result[1]).toContain("15/10/2026");
    expect(result[1]).not.toContain("Remarcado");
  });
});

