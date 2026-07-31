import { db } from "../db";
import { whatsappManager } from "./whatsappService";

export interface SendLog {
  id: number;
  card_id: string;
  card_nome: string | null;
  contact_id: number | null;
  telefone: string | null;
  pericias_json: string | null;
  mensagem_enviada: string | null;
  status: "sucesso" | "falha";
  erro: string | null;
  whatsapp_message_id: string | null;
  /** Nível de confirmação do WhatsApp (os "tiques"): -1 erro, 0 pendente, 1 enviado ao servidor,
   * 2 entregue no aparelho, 3 lido, 4 áudio reproduzido. Null quando não há mensagem para rastrear
   * (ex: falha antes do envio) ou o evento de confirmação ainda não chegou. */
  ack: number | null;
  ack_updated_at: string | null;
  created_at: string;
}

export interface NewSendLog {
  card_id: string;
  card_nome: string | null;
  contact_id: number | null;
  telefone: string | null;
  pericias_json: string | null;
  mensagem_enviada: string | null;
  status: "sucesso" | "falha";
  erro: string | null;
  whatsapp_message_id?: string | null;
}

const insertStmt = db.prepare(
  `INSERT INTO send_logs (card_id, card_nome, contact_id, telefone, pericias_json, mensagem_enviada, status, erro, whatsapp_message_id)
   VALUES (@card_id, @card_nome, @contact_id, @telefone, @pericias_json, @mensagem_enviada, @status, @erro, @whatsapp_message_id)`
);
const listStmt = db.prepare("SELECT * FROM send_logs ORDER BY created_at DESC, id DESC");
const lastForCardStmt = db.prepare("SELECT * FROM send_logs WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT 1");
const getStmt = db.prepare("SELECT * FROM send_logs WHERE id = ?");
const getByMessageIdStmt = db.prepare("SELECT * FROM send_logs WHERE whatsapp_message_id = ?");
const updateAckStmt = db.prepare(
  "UPDATE send_logs SET ack = ?, ack_updated_at = CURRENT_TIMESTAMP WHERE whatsapp_message_id = ?"
);

export function createLog(entry: NewSendLog): SendLog {
  const info = insertStmt.run({ ...entry, whatsapp_message_id: entry.whatsapp_message_id ?? null });
  const log = getStmt.get(info.lastInsertRowid) as SendLog;

  // Se o log tem um ID de mensagem, verifica se já chegou algum ack para ele enquanto
  // o registro estava sendo criado (race condition).
  if (log.whatsapp_message_id) {
    whatsappManager.processarAckPendente(log.whatsapp_message_id);
  }

  return log;
}

export function listLogs(): SendLog[] {
  return listStmt.all() as SendLog[];
}

export function getLastStatusForCard(cardId: string): SendLog | undefined {
  return lastForCardStmt.get(cardId) as SendLog | undefined;
}

export function getLog(id: number): SendLog | undefined {
  return getStmt.get(id) as SendLog | undefined;
}

/** Atualiza o nível de confirmação (ack) do envio associado a essa mensagem do WhatsApp. */
export function updateLogAckByMessageId(whatsappMessageId: string, ack: number): SendLog | undefined {
  const info = updateAckStmt.run(ack, whatsappMessageId);
  if (info.changes === 0) return undefined;
  return getByMessageIdStmt.get(whatsappMessageId) as SendLog;
}
