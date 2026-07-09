import { db } from "../db";

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
}

const insertStmt = db.prepare(
  `INSERT INTO send_logs (card_id, card_nome, contact_id, telefone, pericias_json, mensagem_enviada, status, erro)
   VALUES (@card_id, @card_nome, @contact_id, @telefone, @pericias_json, @mensagem_enviada, @status, @erro)`
);
const listStmt = db.prepare("SELECT * FROM send_logs ORDER BY created_at DESC, id DESC");
const lastForCardStmt = db.prepare("SELECT * FROM send_logs WHERE card_id = ? ORDER BY created_at DESC, id DESC LIMIT 1");
const getStmt = db.prepare("SELECT * FROM send_logs WHERE id = ?");

export function createLog(entry: NewSendLog): SendLog {
  const info = insertStmt.run(entry);
  return getStmt.get(info.lastInsertRowid) as SendLog;
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
