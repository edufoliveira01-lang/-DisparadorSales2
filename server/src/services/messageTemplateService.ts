import Handlebars from "handlebars";
import { db } from "../db";
import { getSetting, setSetting } from "./settingsService";
import * as defaults from "./templateService";

export const GROUPS: Record<string, Record<string, { label: string; key?: string; content: string }>> = {
  audiencia: {
    presencial: { label: "Presencial", key: "audiencia_presencial_mensagem", content: defaults.AUDIENCIA_PRESENCIAL_MENSAGEM_PADRAO },
    online: { label: "Online", key: "audiencia_online_mensagem", content: defaults.AUDIENCIA_ONLINE_MENSAGEM_PADRAO },
    hibrida: { label: "Híbrida", key: "audiencia_hibrida_mensagem", content: defaults.AUDIENCIA_HIBRIDA_MENSAGEM_PADRAO },
  },
  cobranca: {
    pericia: { label: "Perícia", key: "cobranca_mensagem", content: defaults.COBRANCA_MENSAGEM_PADRAO },
    audiencia: { label: "Audiência", key: "cobranca_audiencia_mensagem", content: defaults.COBRANCA_AUDIENCIA_MENSAGEM_PADRAO },
  },
  lembrete: {
    hoje: { label: "Hoje", key: "lembrete_hoje_mensagem", content: defaults.LEMBRETE_HOJE_MENSAGEM_PADRAO },
    amanha: { label: "Amanhã", key: "lembrete_amanha_mensagem", content: defaults.LEMBRETE_AMANHA_MENSAGEM_PADRAO },
    futuro: { label: "Data futura", key: "lembrete_futuro_mensagem", content: defaults.LEMBRETE_FUTURO_MENSAGEM_PADRAO },
  },
  remarcacao: Object.fromEntries(["todos", "medica", "social", "audiencia"].map(scope => [scope, {
    label: ({ todos: "Todos", medica: "Perícia médica", social: "Perícia social", audiencia: "Audiência" } as Record<string, string>)[scope],
    content: "Olá {{NOME}}! Seu agendamento de {{TIPO_PERICIA}} foi remarcado.\n\nData anterior: {{DATA_ANTERIOR}} às {{HORARIO_ANTERIOR}}\nNova data: {{NOVA_DATA}}\nNovo horário: {{NOVO_HORARIO}}\nLocal: {{NOVO_LOCAL}}\nProcesso: {{PROCESSO}}\n\nPor favor, confirme o recebimento desta mensagem.",
  }])),
};

export interface MessageTemplate {
  id: number;
  categoria: string;
  escopo: string;
  nome: string;
  mensagem: string;
  padrao: number;
}

// A migração tem marcador próprio: reiniciar não recria modelos excluídos nem altera textos.
export function initializeMessageTemplates(): void {
  db.transaction(() => {
    if (getSetting("message_templates_migrated") === "true") return;
    for (const [categoria, scopes] of Object.entries(GROUPS)) {
      for (const [escopo, config] of Object.entries(scopes)) {
        if (categoria === "remarcacao" && escopo !== "todos") continue;
        db.prepare("INSERT INTO message_templates (categoria, escopo, nome, mensagem, padrao) VALUES (?, ?, ?, ?, 1)")
          .run(categoria, escopo, `Padrão — ${config.label}`, (config.key && getSetting(config.key)) || config.content);
      }
    }
    setSetting("message_templates_migrated", "true");
  })();
}

export function listMessageTemplates(categoria: string): MessageTemplate[] {
  return db.prepare("SELECT * FROM message_templates WHERE categoria = ? ORDER BY padrao DESC, id ASC").all(categoria) as MessageTemplate[];
}

export function getMessageTemplate(id: number): MessageTemplate | undefined {
  return db.prepare("SELECT * FROM message_templates WHERE id = ?").get(id) as MessageTemplate | undefined;
}

function syncDefault(template: MessageTemplate): void {
  const config = GROUPS[template.categoria][template.escopo];
  if (config.key) setSetting(config.key, template.mensagem);
}

export function saveMessageTemplate(data: Omit<MessageTemplate, "id">, id?: number): MessageTemplate {
  if (!GROUPS[data.categoria]?.[data.escopo] || !data.nome?.trim() || !data.mensagem?.trim()) {
    throw new Error("Informe categoria, aplicação, nome e mensagem válidos.");
  }
  Handlebars.compile(data.mensagem, { noEscape: true })({});
  const original = id === undefined ? undefined : getMessageTemplate(id);
  if (id !== undefined && !original) throw new Error("Template não encontrado.");
  if (original && (original.categoria !== data.categoria || original.escopo !== data.escopo)) {
    throw new Error("Crie um novo template para mudar a categoria ou aplicação de um modelo salvo.");
  }
  return db.transaction(() => {
    const hasDefault = db.prepare("SELECT id FROM message_templates WHERE categoria = ? AND escopo = ? AND padrao = 1").get(data.categoria, data.escopo);
    const padrao = original?.padrao === 1 || data.padrao === 1 || !hasDefault ? 1 : 0;
    if (padrao) db.prepare("UPDATE message_templates SET padrao = 0 WHERE categoria = ? AND escopo = ?").run(data.categoria, data.escopo);
    if (id === undefined) {
      id = Number(db.prepare("INSERT INTO message_templates (categoria, escopo, nome, mensagem, padrao) VALUES (?, ?, ?, ?, ?)")
        .run(data.categoria, data.escopo, data.nome.trim(), data.mensagem, padrao).lastInsertRowid);
    } else {
      db.prepare("UPDATE message_templates SET nome = ?, mensagem = ?, padrao = ? WHERE id = ?").run(data.nome.trim(), data.mensagem, padrao, id);
    }
    const saved = getMessageTemplate(id)!;
    if (saved.padrao) syncDefault(saved);
    return saved;
  })();
}

export function deleteMessageTemplate(id: number): void {
  const original = getMessageTemplate(id);
  if (!original) throw new Error("Template não encontrado.");
  // Sempre há um padrão por aplicação; excluir o último não deixa envios sem texto.
  const remaining = listMessageTemplates(original.categoria).filter(t => t.escopo === original.escopo && t.id !== id);
  const canFallback = original.categoria === "remarcacao" && original.escopo !== "todos" && listMessageTemplates("remarcacao").some(t => t.escopo === "todos" && t.padrao);
  if (!remaining.length && !canFallback) throw new Error("Mantenha pelo menos um template para esta aplicação.");
  db.transaction(() => {
    db.prepare("DELETE FROM message_templates WHERE id = ?").run(id);
    if (original.padrao && remaining.length) {
      db.prepare("UPDATE message_templates SET padrao = 1 WHERE id = ?").run(remaining[0].id);
      syncDefault({ ...remaining[0], padrao: 1 });
    }
  })();
}

export function defaultRescheduleTemplate(scope: string): MessageTemplate | undefined {
  return db.prepare("SELECT * FROM message_templates WHERE categoria = 'remarcacao' AND padrao = 1 AND escopo IN (?, 'todos') ORDER BY CASE WHEN escopo = ? THEN 0 ELSE 1 END LIMIT 1")
    .get(scope, scope) as MessageTemplate | undefined;
}
