import { afterEach, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { runMigrations } from "../src/db/migrations";
import { createSystemLog, listSystemLogs, recordSystemLog } from "../src/services/systemLogsService";
import { listLogs, listLogsPendentesDeAlerta } from "../src/services/logsService";
import {
  findAwaitingByChatIdentifier,
  findAwaitingByWhatsappMessageId,
  finalizePendingReply,
  linkPendingReplyToSendLog,
  listPendingRepliesPendentesDeAlerta,
  resolvePendingReplyIfAwaiting,
} from "../src/services/pendingRepliesService";
import { markNotificationDelivered } from "../src/services/notificationDeliveryService";

const prefixo = `TESTE-LOG-${Date.now()}-`;

function inserirEnvio(tipoEnvio: "disparo" | "lembrete", status: "sucesso" | "falha"): number {
  const info = db.prepare(`
    INSERT INTO send_logs
      (card_id, card_nome, status, tipo_envio, ack, alerta_entrega_enviado_em, created_at)
    VALUES (?, 'CLIENTE TESTE', ?, ?, NULL, NULL, datetime('now', '-30 hours'))
  `).run(`${prefixo}${tipoEnvio}-${status}`, status, tipoEnvio);
  return Number(info.lastInsertRowid);
}

describe("logs de sistema", () => {
  afterEach(() => {
    db.prepare("DELETE FROM system_logs WHERE titulo LIKE ?").run(`${prefixo}%`);
    db.prepare("DELETE FROM send_logs WHERE card_id LIKE ?").run(`${prefixo}%`);
  });

  it("registra origem, nível e detalhes estruturados", () => {
    const criado = createSystemLog({
      nivel: "aviso",
      categoria: "notificacao",
      evento: "alerta_entrega",
      titulo: `${prefixo}alerta`,
      mensagem: "Alerta automático enviado.",
      origem: "automatico",
      detalhes: {
        tipo_verificacao: "periodica",
        canais: [{ canal: "Telegram", sucesso: true }],
        envios: [{ id: 321, enviado_em: "2026-09-08T12:00:00.000Z" }],
      },
    });

    expect(criado.id).toBeGreaterThan(0);
    expect(criado.nivel).toBe("aviso");
    expect(criado.origem).toBe("automatico");
    expect(JSON.parse(criado.detalhes_json!)).toMatchObject({
      tipo_verificacao: "periodica",
      canais: [{ canal: "Telegram", sucesso: true }],
      envios: [{ id: 321 }],
    });
  });

  it("lista os registros mais recentes primeiro", () => {
    const primeiro = createSystemLog({
      nivel: "info",
      categoria: "sistema",
      evento: "teste",
      titulo: `${prefixo}primeiro`,
      origem: "sistema",
    });
    const segundo = createSystemLog({
      nivel: "erro",
      categoria: "sistema",
      evento: "teste",
      titulo: `${prefixo}segundo`,
      origem: "sistema",
    });

    const ids = listSystemLogs(20).filter((log) => log.titulo.startsWith(prefixo)).map((log) => log.id);
    expect(ids.indexOf(segundo.id)).toBeLessThan(ids.indexOf(primeiro.id));
  });

  it("oferece gravação segura para não interromper o fluxo principal", () => {
    const criado = recordSystemLog({
      nivel: "info",
      categoria: "sistema",
      evento: "teste_seguro",
      titulo: `${prefixo}seguro`,
      origem: "sistema",
    });
    expect(criado?.titulo).toBe(`${prefixo}seguro`);
  });
});

describe("seleção de envios para alerta de entrega", () => {
  afterEach(() => {
    db.prepare(`
      DELETE FROM notification_deliveries
      WHERE tipo = 'entrega'
        AND origem_id IN (SELECT id FROM send_logs WHERE card_id LIKE ?)
    `).run(`${prefixo}%`);
    db.prepare("DELETE FROM send_logs WHERE card_id LIKE ?").run(`${prefixo}%`);
  });

  it("não alerta lembrete bem-sucedido apenas por falta de confirmação técnica", () => {
    const id = inserirEnvio("lembrete", "sucesso");
    expect(listLogsPendentesDeAlerta(24).some((log) => log.id === id)).toBe(false);
  });

  it("continua alertando quando o envio do lembrete falha de fato", () => {
    const id = inserirEnvio("lembrete", "falha");
    expect(listLogsPendentesDeAlerta(24).some((log) => log.id === id)).toBe(true);
  });

  it("mantém a confirmação de entrega para disparos normais", () => {
    const id = inserirEnvio("disparo", "sucesso");
    expect(listLogsPendentesDeAlerta(24).some((log) => log.id === id)).toBe(true);
  });

  it("controla Telegram e Whapi separadamente quando só um canal confirmou o alerta", () => {
    const id = inserirEnvio("disparo", "falha");

    expect(listLogsPendentesDeAlerta(24, "Telegram").some((log) => log.id === id)).toBe(true);
    expect(listLogsPendentesDeAlerta(24, "Whapi").some((log) => log.id === id)).toBe(true);

    markNotificationDelivered("entrega", "Telegram", [id]);

    expect(listLogsPendentesDeAlerta(24, "Telegram").some((log) => log.id === id)).toBe(false);
    expect(listLogsPendentesDeAlerta(24, "Whapi").some((log) => log.id === id)).toBe(true);
  });
});

describe("seleção de respostas pendentes para notificação", () => {
  afterEach(() => {
    db.prepare(`
      DELETE FROM notification_deliveries
      WHERE tipo = 'resposta'
        AND origem_id IN (SELECT id FROM pending_replies WHERE card_id LIKE ?)
    `).run(`${prefixo}%`);
    db.prepare("DELETE FROM pending_replies WHERE card_id LIKE ?").run(`${prefixo}%`);
  });

  it("mantém a tentativa da Whapi depois de o Telegram receber o alerta", () => {
    const info = db.prepare(`
      INSERT INTO pending_replies
        (card_id, card_nome, telefone, telefone_digits, status, created_at)
      VALUES (?, 'CLIENTE SEM RESPOSTA', '(13) 99123-8064', '5513991238064', 'aguardando', datetime('now', '-30 hours'))
    `).run(`${prefixo}resposta-por-canal`);
    const id = Number(info.lastInsertRowid);

    expect(listPendingRepliesPendentesDeAlerta(24, "Telegram").some((item) => item.id === id)).toBe(true);
    expect(listPendingRepliesPendentesDeAlerta(24, "Whapi").some((item) => item.id === id)).toBe(true);

    markNotificationDelivered("resposta", "Telegram", [id]);

    expect(listPendingRepliesPendentesDeAlerta(24, "Telegram").some((item) => item.id === id)).toBe(false);
    expect(listPendingRepliesPendentesDeAlerta(24, "Whapi").some((item) => item.id === id)).toBe(true);
  });
});

describe("correlação da resposta com o Histórico", () => {
  afterEach(() => {
    db.prepare("DELETE FROM pending_replies WHERE card_id LIKE ?").run(`${prefixo}%`);
    db.prepare("DELETE FROM send_logs WHERE card_id LIKE ?").run(`${prefixo}%`);
  });

  it("encontra o pendente pelo chat completo LID e pelo ID da mensagem citada", () => {
    const chatId = `${Date.now()}@lid`;
    const messageId = `true_${Date.now()}@c.us_TESTE`;
    const info = db.prepare(`
      INSERT INTO pending_replies
        (card_id, card_nome, telefone, telefone_digits, whatsapp_chat_id, whatsapp_message_id, status)
      VALUES (?, 'CLIENTE RESPOSTA', '(13) 99123-8064', '5513991238064', ?, ?, 'aguardando')
    `).run(`${prefixo}lid`, chatId, messageId);

    expect(findAwaitingByChatIdentifier(chatId)?.id).toBe(Number(info.lastInsertRowid));
    expect(findAwaitingByWhatsappMessageId(messageId)?.id).toBe(Number(info.lastInsertRowid));
  });

  it("mostra no Histórico a resposta vinculada diretamente mesmo sem ID do WhatsApp", () => {
    const cardId = `${prefixo}sem-message-id`;
    const logInfo = db.prepare(`
      INSERT INTO send_logs (card_id, card_nome, telefone, status, tipo_envio)
      VALUES (?, 'CLIENTE RESPOSTA', '(13) 99123-8064', 'sucesso', 'disparo')
    `).run(cardId);
    const pendingInfo = db.prepare(`
      INSERT INTO pending_replies
        (card_id, card_nome, telefone, telefone_digits, whatsapp_chat_id, whatsapp_message_id, status)
      VALUES (?, 'CLIENTE RESPOSTA', '(13) 99123-8064', '5513991238064', '5513991238064@c.us', NULL, 'aguardando')
    `).run(cardId);

    const pendingId = Number(pendingInfo.lastInsertRowid);
    const logId = Number(logInfo.lastInsertRowid);
    linkPendingReplyToSendLog(pendingId, logId);
    expect(resolvePendingReplyIfAwaiting(pendingId, "mensagem", "Boa tarde! Recebi o comunicado.")?.status)
      .toBe("respondido");
    expect(resolvePendingReplyIfAwaiting(pendingId, "mensagem", "Evento duplicado")).toBeUndefined();

    expect(listLogs().find((log) => log.id === logId)).toMatchObject({
      resposta_status: "respondido",
      resposta_tipo: "mensagem",
      resposta_preview: "Boa tarde! Recebi o comunicado.",
    });
  });

  it("finaliza a espera sem inventar resposta e preserva a observação no Histórico", () => {
    const cardId = `${prefixo}finalizado-sem-resposta`;
    const logInfo = db.prepare(`
      INSERT INTO send_logs (card_id, card_nome, telefone, status, tipo_envio)
      VALUES (?, 'CLIENTE SEM RESPOSTA', '(13) 99123-8064', 'sucesso', 'disparo')
    `).run(cardId);
    const pendingInfo = db.prepare(`
      INSERT INTO pending_replies
        (card_id, card_nome, telefone, telefone_digits, whatsapp_chat_id, status, send_log_id)
      VALUES (?, 'CLIENTE SEM RESPOSTA', '(13) 99123-8064', '5513991238064', '5513991238064@c.us', 'aguardando', ?)
    `).run(cardId, logInfo.lastInsertRowid);

    const pendingId = Number(pendingInfo.lastInsertRowid);
    expect(finalizePendingReply(pendingId, "Cliente não respondeu e bloqueou o contato.")).toMatchObject({
      status: "cancelado",
      tipo_resposta: null,
      resposta_preview: null,
      observacao_finalizacao: "Cliente não respondeu e bloqueou o contato.",
    });
    expect(finalizePendingReply(pendingId, "Tentativa duplicada")).toBeUndefined();

    expect(listLogs().find((log) => log.id === Number(logInfo.lastInsertRowid))).toMatchObject({
      resposta_status: "cancelado",
      resposta_tipo: null,
      resposta_preview: null,
      resposta_observacao_finalizacao: "Cliente não respondeu e bloqueou o contato.",
    });
  });

  it("recupera o vínculo de registros antigos pelo mesmo card e horário próximo", () => {
    const cardId = `${prefixo}migracao`;
    const logInfo = db.prepare(`
      INSERT INTO send_logs (card_id, card_nome, telefone, status, tipo_envio, created_at)
      VALUES (?, 'CLIENTE ANTIGO', '(13) 99123-8064', 'sucesso', 'disparo', '2026-09-09 16:43:55')
    `).run(cardId);
    const pendingInfo = db.prepare(`
      INSERT INTO pending_replies
        (card_id, card_nome, telefone, telefone_digits, whatsapp_chat_id, status, created_at)
      VALUES (?, 'CLIENTE ANTIGO', '(13) 99123-8064', '5513991238064', '5513991238064@c.us', 'aguardando', '2026-09-09 16:43:56')
    `).run(cardId);

    runMigrations(db);

    const pendente = db.prepare("SELECT send_log_id FROM pending_replies WHERE id = ?")
      .get(pendingInfo.lastInsertRowid) as { send_log_id: number | null };
    expect(pendente.send_log_id).toBe(Number(logInfo.lastInsertRowid));
  });
});
