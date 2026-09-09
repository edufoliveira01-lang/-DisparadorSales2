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
  tipo_envio: "disparo" | "lembrete";
  created_at: string;
  /** Dados do pending_reply correlato pelo vínculo direto ou pelo whatsapp_message_id legado,
   * quando esse envio estava sob monitoramento de resposta (lista de confirmação configurada no
   * Trello). Vem de um LEFT JOIN — undefined/null quando nunca houve monitoramento. */
  resposta_status?: "aguardando" | "respondido" | "cancelado" | null;
  resposta_resolved_at?: string | null;
  resposta_tipo?: "mensagem" | "reacao" | null;
  resposta_preview?: string | null;
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
  tipo_envio?: "disparo" | "lembrete";
}

const insertStmt = db.prepare(
  `INSERT INTO send_logs (card_id, card_nome, contact_id, telefone, pericias_json, mensagem_enviada, status, erro, whatsapp_message_id, tipo_envio)
   VALUES (@card_id, @card_nome, @contact_id, @telefone, @pericias_json, @mensagem_enviada, @status, @erro, @whatsapp_message_id, @tipo_envio)`
);
// LEFT JOIN pelo vínculo direto; whatsapp_message_id fica como compatibilidade para registros
// antigos. Assim o Histórico enxerga a resposta mesmo quando a API do WhatsApp não devolveu o ID
// da mensagem no momento do envio.
const listStmt = db.prepare(`
  SELECT
    send_logs.*,
    pending_replies.status AS resposta_status,
    pending_replies.resolved_at AS resposta_resolved_at,
    pending_replies.tipo_resposta AS resposta_tipo,
    pending_replies.resposta_preview AS resposta_preview
  FROM send_logs
  LEFT JOIN pending_replies ON
    pending_replies.send_log_id = send_logs.id
    OR (
      pending_replies.send_log_id IS NULL
      AND pending_replies.whatsapp_message_id IS NOT NULL
      AND pending_replies.whatsapp_message_id = send_logs.whatsapp_message_id
    )
  ORDER BY send_logs.created_at DESC, send_logs.id DESC
`);
const lastForCardStmt = db.prepare("SELECT * FROM send_logs WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT 1");
const getStmt = db.prepare("SELECT * FROM send_logs WHERE id = ?");
const getByMessageIdStmt = db.prepare("SELECT * FROM send_logs WHERE whatsapp_message_id = ?");
const updateAckStmt = db.prepare(
  "UPDATE send_logs SET ack = ?, ack_updated_at = CURRENT_TIMESTAMP WHERE whatsapp_message_id = ?"
);
const deleteStmt = db.prepare("DELETE FROM send_logs WHERE id = ?");

export function createLog(entry: NewSendLog): SendLog {
  const info = insertStmt.run({
    ...entry,
    whatsapp_message_id: entry.whatsapp_message_id ?? null,
    tipo_envio: entry.tipo_envio ?? "disparo",
  });
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

/**
 * Envios com problema de entrega ainda não notificados: falha no envio (alerta imediato) ou
 * "enviado" há mais de horasLimite horas sem confirmar entrega (ack ainda não chegou a 2).
 * Lembretes bem-sucedidos não entram na espera por confirmação: eles são mensagens informativas
 * e só geram alerta quando o próprio envio falha de fato.
 * Usado pela verificação periódica que avisa no Telegram.
 */
export function listLogsPendentesDeAlerta(horasLimite: number): SendLog[] {
  return db
    .prepare(
      `SELECT * FROM send_logs
       WHERE alerta_entrega_enviado_em IS NULL
         AND (
           status = 'falha'
           OR (
             tipo_envio != 'lembrete'
             AND status = 'sucesso'
             AND (ack IS NULL OR ack < 2)
             AND created_at <= datetime('now', '-' || ? || ' hours')
           )
         )
       ORDER BY created_at ASC`
    )
    .all(horasLimite) as SendLog[];
}

export function marcarAlertaEnviado(ids: number[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE send_logs SET alerta_entrega_enviado_em = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`).run(...ids);
}

export function deleteLog(id: number): void {
  deleteStmt.run(id);
}

/** Apaga em massa; ids inexistentes são ignorados. Retorna quantos registros foram de fato apagados. */
export function deleteLogs(ids: number[]): number {
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const info = db.prepare(`DELETE FROM send_logs WHERE id IN (${placeholders})`).run(...ids);
  return info.changes;
}
