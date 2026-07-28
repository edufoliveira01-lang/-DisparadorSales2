import { db } from "../db";
import { normalizePhone } from "../utils/phone";

export interface Contact {
  id: number;
  nome: string;
  telefone: string;
  observacoes: string | null;
  created_at: string;
}

const listStmt = db.prepare("SELECT * FROM contacts ORDER BY nome COLLATE NOCASE ASC");
const getStmt = db.prepare("SELECT * FROM contacts WHERE id = ?");
const insertStmt = db.prepare("INSERT INTO contacts (nome, telefone, observacoes) VALUES (?, ?, ?)");
const updateStmt = db.prepare("UPDATE contacts SET nome = ?, telefone = ?, observacoes = ? WHERE id = ?");
const deleteStmt = db.prepare("DELETE FROM contacts WHERE id = ?");

export function listContacts(): Contact[] {
  return listStmt.all() as Contact[];
}

export function getContact(id: number): Contact | undefined {
  return getStmt.get(id) as Contact | undefined;
}

export function createContact(nome: string, telefone: string, observacoes?: string): Contact {
  const info = insertStmt.run(nome.trim(), normalizePhone(telefone), observacoes?.trim() || null);
  return getContact(info.lastInsertRowid as number)!;
}

export function updateContact(id: number, nome: string, telefone: string, observacoes?: string): Contact | undefined {
  updateStmt.run(nome.trim(), normalizePhone(telefone), observacoes?.trim() || null, id);
  return getContact(id);
}

export function deleteContact(id: number): void {
  deleteStmt.run(id);
}
