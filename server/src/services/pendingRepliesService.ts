import { db } from "../db";
import { normalizePhone } from "../utils/phone";

export type PendingReplyStatus = "aguardando" | "respondido" | "cancelado";
export type TipoResposta = "mensagem" | "reacao";

export interface PendingReply {
  id: number;
  card_id: string;
  card_nome: string | null;
  telefone: string;
  telefone_digits: string;
  status: PendingReplyStatus;
  tipo_resposta: TipoResposta | null;
  resposta_preview: string | null;
  created_at: string;
  resolved_at: string | null;
}

// Só um pendente "aguardando" por telefone: se um novo disparo for feito para o mesmo
// número antes do cliente responder ao anterior, o pendente antigo perde o sentido
// (a resposta que chegar deve ser associada ao cartão do disparo mais recente).
const cancelAwaitingForPhoneStmt = db.prepare(
  `UPDATE pending_replies SET status = 'cancelado', resolved_at = CURRENT_TIMESTAMP WHERE telefone_digits = ? AND status = 'aguardando'`
);
const insertStmt = db.prepare(
  `INSERT INTO pending_replies (card_id, card_nome, telefone, telefone_digits, status)
   VALUES (@card_id, @card_nome, @telefone, @telefone_digits, 'aguardando')`
);
const getStmt = db.prepare("SELECT * FROM pending_replies WHERE id = ?");
const findAwaitingByDigitsStmt = db.prepare(
  `SELECT * FROM pending_replies WHERE telefone_digits = ? AND status = 'aguardando' ORDER BY created_at DESC LIMIT 1`
);
const listStmt = db.prepare(
  `SELECT * FROM pending_replies ORDER BY (status = 'aguardando') DESC, created_at DESC LIMIT 200`
);
const resolveStmt = db.prepare(
  `UPDATE pending_replies SET status = 'respondido', tipo_resposta = ?, resposta_preview = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
);
const cancelStmt = db.prepare(
  `UPDATE pending_replies SET status = 'cancelado', resolved_at = CURRENT_TIMESTAMP WHERE id = ?`
);

export function createPendingReply(cardId: string, cardNome: string | null, telefone: string): PendingReply {
  const telefoneDigits = normalizePhone(telefone);
  cancelAwaitingForPhoneStmt.run(telefoneDigits);
  const info = insertStmt.run({ card_id: cardId, card_nome: cardNome, telefone, telefone_digits: telefoneDigits });
  return getStmt.get(info.lastInsertRowid) as PendingReply;
}

export function findAwaitingByPhoneDigits(telefoneDigits: string): PendingReply | undefined {
  return findAwaitingByDigitsStmt.get(telefoneDigits) as PendingReply | undefined;
}

export function listPendingReplies(): PendingReply[] {
  return listStmt.all() as PendingReply[];
}

export function getPendingReply(id: number): PendingReply | undefined {
  return getStmt.get(id) as PendingReply | undefined;
}

export function resolvePendingReply(id: number, tipoResposta: TipoResposta, preview: string | null): PendingReply {
  resolveStmt.run(tipoResposta, preview, id);
  return getStmt.get(id) as PendingReply;
}

export function cancelPendingReply(id: number): PendingReply {
  cancelStmt.run(id);
  return getStmt.get(id) as PendingReply;
}
