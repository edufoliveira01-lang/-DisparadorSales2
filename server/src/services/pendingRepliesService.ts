import { db } from "../db";
import { normalizePhone } from "../utils/phone";
import { whatsappMessageStableKey } from "../utils/whatsappMessageId";
import { whatsappManager } from "./whatsappService";
import type { NotificationChannel } from "./notificationDeliveryService";

export type PendingReplyStatus = "aguardando" | "respondido" | "cancelado";
export type TipoResposta = "mensagem" | "reacao";

export interface PendingReply {
  id: number;
  card_id: string;
  card_nome: string | null;
  telefone: string;
  telefone_digits: string;
  whatsapp_chat_id: string | null;
  status: PendingReplyStatus;
  tipo_resposta: TipoResposta | null;
  resposta_preview: string | null;
  observacao_finalizacao: string | null;
  whatsapp_message_id: string | null;
  send_log_id: number | null;
  /** -1 erro, 0 pendente, 1 enviado ao servidor, 2 entregue (✓✓ cinza), 3 lido (✓✓ azul), 4 áudio reproduzido. */
  ack: number | null;
  ack_updated_at: string | null;
  created_at: string;
  resolved_at: string | null;
  alerta_resposta_enviado_em: string | null;
}

// Só um pendente "aguardando" por telefone: se um novo disparo for feito para o mesmo
// número antes do cliente responder ao anterior, o pendente antigo perde o sentido
// (a resposta que chegar deve ser associada ao cartão do disparo mais recente).
const cancelAwaitingForPhoneStmt = db.prepare(
  `UPDATE pending_replies
   SET status = 'cancelado',
       observacao_finalizacao = 'Espera encerrada automaticamente após um novo envio para o mesmo telefone.',
       resolved_at = CURRENT_TIMESTAMP
   WHERE telefone_digits = ? AND status = 'aguardando'`
);
const insertStmt = db.prepare(
  `INSERT INTO pending_replies (card_id, card_nome, telefone, telefone_digits, whatsapp_chat_id, whatsapp_message_id, status, ack)
   VALUES (@card_id, @card_nome, @telefone, @telefone_digits, @whatsapp_chat_id, @whatsapp_message_id, 'aguardando', 1)`
);
const getStmt = db.prepare("SELECT * FROM pending_replies WHERE id = ?");
const getByMessageIdStmt = db.prepare(`
  SELECT * FROM pending_replies
  WHERE whatsapp_message_id = @message_id
     OR substr(whatsapp_message_id, -length(@stable_id)) = @stable_id
  ORDER BY id DESC
  LIMIT 1
`);
const findAwaitingByMessageIdStmt = db.prepare(`
  SELECT * FROM pending_replies
  WHERE status = 'aguardando'
    AND (
      whatsapp_message_id = @message_id
      OR substr(whatsapp_message_id, -length(@stable_id)) = @stable_id
    )
  ORDER BY created_at DESC
  LIMIT 1
`);
const findAwaitingByChatIdStmt = db.prepare(
  "SELECT * FROM pending_replies WHERE whatsapp_chat_id = ? AND status = 'aguardando' ORDER BY created_at DESC LIMIT 1"
);
const findAwaitingByDigitsStmt = db.prepare(
  `SELECT * FROM pending_replies WHERE telefone_digits = ? AND status = 'aguardando' ORDER BY created_at DESC LIMIT 1`
);
const listStmt = db.prepare(
  `SELECT * FROM pending_replies ORDER BY (status = 'aguardando') DESC, created_at DESC LIMIT 200`
);
const resolveStmt = db.prepare(
  `UPDATE pending_replies SET status = 'respondido', tipo_resposta = ?, resposta_preview = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
);
const resolveAwaitingStmt = db.prepare(
  `UPDATE pending_replies SET status = 'respondido', tipo_resposta = ?, resposta_preview = ?, resolved_at = CURRENT_TIMESTAMP
   WHERE id = ? AND status = 'aguardando'`
);
const cancelStmt = db.prepare(
  `UPDATE pending_replies SET status = 'cancelado', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
);
const finalizeAwaitingStmt = db.prepare(
  `UPDATE pending_replies
   SET status = 'cancelado', observacao_finalizacao = ?, resolved_at = CURRENT_TIMESTAMP
   WHERE id = ? AND status = 'aguardando'`
);
const deleteStmt = db.prepare("DELETE FROM pending_replies WHERE id = ?");
const updateAckStmt = db.prepare(`
  UPDATE pending_replies
  SET ack = @ack, ack_updated_at = CURRENT_TIMESTAMP
  WHERE (
    whatsapp_message_id = @message_id
    OR substr(whatsapp_message_id, -length(@stable_id)) = @stable_id
  )
    AND (@ack = -1 OR ack IS NULL OR @ack > ack)
`);
const linkSendLogStmt = db.prepare("UPDATE pending_replies SET send_log_id = ? WHERE id = ?");

/**
 * telefoneExibicao é o número "para humano ler" (o telefone salvo no contato). chatIdDigits é
 * o identificador que o WhatsApp de fato usa para essa conversa (resolvido via getNumberId no
 * envio) — às vezes diferente do telefone por causa da ambiguidade do 9º dígito em números
 * brasileiros, ou porque o WhatsApp migrou o contato para um "LID" (identificador interno, não
 * o telefone). Usamos chatIdDigits só para casar com quem responde depois; telefoneExibicao é
 * só para exibição na tela.
 */
export function createPendingReply(
  cardId: string,
  cardNome: string | null,
  telefoneExibicao: string,
  chatIdDigits: string,
  whatsappChatId: string,
  whatsappMessageId: string | null = null
): PendingReply {
  const telefoneDigits = normalizePhone(chatIdDigits);
  cancelAwaitingForPhoneStmt.run(telefoneDigits);
  const info = insertStmt.run({
    card_id: cardId,
    card_nome: cardNome,
    telefone: telefoneExibicao,
    telefone_digits: telefoneDigits,
    whatsapp_chat_id: whatsappChatId,
    whatsapp_message_id: whatsappMessageId,
  });
  const pending = getStmt.get(info.lastInsertRowid) as PendingReply;

  // Se o pendente tem um ID de mensagem, verifica se já chegou algum ack para ele enquanto
  // o registro estava sendo criado (race condition).
  if (pending.whatsapp_message_id) {
    whatsappManager.processarAckPendente(pending.whatsapp_message_id);
  }

  return pending;
}

/** Atualiza o nível de confirmação (ack) do pendente associado a essa mensagem do WhatsApp. */
export function updatePendingReplyAckByMessageId(whatsappMessageId: string, ack: number): PendingReply | undefined {
  const params = {
    message_id: whatsappMessageId,
    stable_id: whatsappMessageStableKey(whatsappMessageId),
    ack,
  };
  const info = updateAckStmt.run(params);
  if (info.changes === 0) return undefined;
  return getByMessageIdStmt.get(params) as PendingReply;
}

export function findAwaitingByPhoneDigits(telefoneDigits: string): PendingReply | undefined {
  return findAwaitingByDigitsStmt.get(telefoneDigits) as PendingReply | undefined;
}

export function findAwaitingByWhatsappChatId(whatsappChatId: string): PendingReply | undefined {
  return findAwaitingByChatIdStmt.get(whatsappChatId) as PendingReply | undefined;
}

/** Procura primeiro pelo chat completo (@lid/@c.us) e depois pelos dígitos normalizados. */
export function findAwaitingByChatIdentifier(chatId: string): PendingReply | undefined {
  return findAwaitingByWhatsappChatId(chatId)
    ?? findAwaitingByPhoneDigits(normalizePhone(chatId.split("@")[0]));
}

export function findAwaitingByWhatsappMessageId(whatsappMessageId: string): PendingReply | undefined {
  return findAwaitingByMessageIdStmt.get({
    message_id: whatsappMessageId,
    stable_id: whatsappMessageStableKey(whatsappMessageId),
  }) as PendingReply | undefined;
}

export function linkPendingReplyToSendLog(pendingId: number, sendLogId: number): PendingReply | undefined {
  const info = linkSendLogStmt.run(sendLogId, pendingId);
  if (info.changes === 0) return undefined;
  return getStmt.get(pendingId) as PendingReply;
}

export function listPendingReplies(): PendingReply[] {
  return listStmt.all() as PendingReply[];
}

/** Cursor por ID: percorre toda a espera, sem o limite da lista exibida na interface. */
export function listAwaitingRepliesPage(afterId = 0, limit = 50): PendingReply[] {
  if (!Number.isSafeInteger(afterId) || afterId < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    throw new Error("Paginação de respostas inválida.");
  return db.prepare("SELECT * FROM pending_replies WHERE status='aguardando' AND id>? ORDER BY id LIMIT ?")
    .all(afterId, limit) as PendingReply[];
}

export function getPendingReply(id: number): PendingReply | undefined {
  return getStmt.get(id) as PendingReply | undefined;
}

/** Pendentes entregues (ack >= 2) que continuam sem resposta além do prazo. Uma mensagem que
 * ainda está apenas "enviada" pertence exclusivamente à regra de não entrega. */
export function listPendingRepliesPendentesDeAlerta(
  horasLimite: number,
  canal?: NotificationChannel
): PendingReply[] {
  if (canal) {
    return db
      .prepare(
        `SELECT pending_replies.*
         FROM pending_replies
         LEFT JOIN send_logs ON send_logs.id = pending_replies.send_log_id
         WHERE pending_replies.status = 'aguardando'
           AND NOT EXISTS (
             SELECT 1 FROM notification_deliveries
             WHERE tipo = 'resposta' AND origem_id = pending_replies.id AND canal = ?
           )
           AND MAX(COALESCE(pending_replies.ack, -1), COALESCE(send_logs.ack, -1)) >= 2
           AND CASE
             WHEN COALESCE(pending_replies.ack, -1) >= 2 AND COALESCE(send_logs.ack, -1) >= 2
               THEN MIN(COALESCE(pending_replies.ack_updated_at, pending_replies.created_at),
                        COALESCE(send_logs.ack_updated_at, send_logs.created_at))
             WHEN COALESCE(pending_replies.ack, -1) >= 2
               THEN COALESCE(pending_replies.ack_updated_at, pending_replies.created_at)
             ELSE COALESCE(send_logs.ack_updated_at, send_logs.created_at)
           END <= datetime('now', '-' || ? || ' hours')
         ORDER BY pending_replies.created_at ASC`
      )
      .all(canal, horasLimite) as PendingReply[];
  }
  return db
    .prepare(
      `SELECT pending_replies.*
       FROM pending_replies
       LEFT JOIN send_logs ON send_logs.id = pending_replies.send_log_id
       WHERE pending_replies.status = 'aguardando'
         AND pending_replies.alerta_resposta_enviado_em IS NULL
         AND MAX(COALESCE(pending_replies.ack, -1), COALESCE(send_logs.ack, -1)) >= 2
         AND CASE
           WHEN COALESCE(pending_replies.ack, -1) >= 2 AND COALESCE(send_logs.ack, -1) >= 2
             THEN MIN(COALESCE(pending_replies.ack_updated_at, pending_replies.created_at),
                      COALESCE(send_logs.ack_updated_at, send_logs.created_at))
           WHEN COALESCE(pending_replies.ack, -1) >= 2
             THEN COALESCE(pending_replies.ack_updated_at, pending_replies.created_at)
           ELSE COALESCE(send_logs.ack_updated_at, send_logs.created_at)
         END <= datetime('now', '-' || ? || ' hours')
       ORDER BY pending_replies.created_at ASC`
    )
    .all(horasLimite) as PendingReply[];
}

export function marcarAlertaRespostaEnviado(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(
    `UPDATE pending_replies SET alerta_resposta_enviado_em = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`
  ).run(...ids);
}

export function resolvePendingReply(id: number, tipoResposta: TipoResposta, preview: string | null): PendingReply {
  resolveStmt.run(tipoResposta, preview, id);
  return getStmt.get(id) as PendingReply;
}

/** Resolve somente uma vez, mesmo se os eventos message e message_create chegarem juntos. */
export function resolvePendingReplyIfAwaiting(
  id: number,
  tipoResposta: TipoResposta,
  preview: string | null
): PendingReply | undefined {
  const info = resolveAwaitingStmt.run(tipoResposta, preview, id);
  if (info.changes === 0) return undefined;
  return getStmt.get(id) as PendingReply;
}

export function cancelPendingReply(id: number): PendingReply {
  cancelStmt.run(id);
  return getStmt.get(id) as PendingReply;
}

/** Encerra uma espera sem fingir que houve resposta e preserva o motivo para o Histórico. */
export function finalizePendingReply(id: number, observacao: string): PendingReply | undefined {
  const info = finalizeAwaitingStmt.run(observacao.trim(), id);
  if (info.changes === 0) return undefined;
  return getStmt.get(id) as PendingReply;
}

export function deletePendingReply(id: number): void {
  deleteStmt.run(id);
}

/** Apaga em massa; ids inexistentes são ignorados. Retorna quantos registros foram de fato apagados. */
export function deletePendingReplies(ids: number[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const info = db.prepare(`DELETE FROM pending_replies WHERE id IN (${placeholders})`).run(...ids);
  return info.changes;
}


