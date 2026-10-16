import { db } from "../db";
import { normalizePhone } from "../utils/phone";
import { normalizeProcesso } from "../utils/processo";

export interface Contact {
  id: number;
  nome: string;
  telefone: string;
  processo: string | null;
  processo_chave: string;
  observacoes: string | null;
  created_at: string;
}

const listStmt = db.prepare("SELECT * FROM contacts ORDER BY nome COLLATE NOCASE ASC");
const getStmt = db.prepare("SELECT * FROM contacts WHERE id = ?");
const insertStmt = db.prepare(
  "INSERT INTO contacts (nome, telefone, processo, processo_chave, observacoes) VALUES (?, ?, ?, ?, ?)"
);
const updateStmt = db.prepare(
  "UPDATE contacts SET nome = ?, telefone = ?, processo = ?, processo_chave = ?, observacoes = ? WHERE id = ?"
);
// O histórico guarda os dados do envio e deve sobreviver à exclusão da agenda.
// Desvincula somente o contato; a transação reverte tudo se a exclusão falhar.
const deleteContactsTransaction = db.transaction((ids: number[]): number => {
  const placeholders = ids.map(() => "?").join(",");
  db.prepare(`UPDATE send_logs SET contact_id = NULL WHERE contact_id IN (${placeholders})`).run(...ids);
  const info = db.prepare(`DELETE FROM contacts WHERE id IN (${placeholders})`).run(...ids);
  return info.changes;
});

export function listContacts(): Contact[] {
  return listStmt.all() as Contact[];
}

export function getContact(id: number): Contact | undefined {
  return getStmt.get(id) as Contact | undefined;
}

export function createContact(nome: string, telefone: string, observacoes?: string, processo?: string): Contact {
  const processoLimpo = processo?.trim() || null;
  const info = insertStmt.run(
    nome.trim(),
    normalizePhone(telefone),
    processoLimpo,
    normalizeProcesso(processoLimpo),
    observacoes?.trim() || null
  );
  return getContact(info.lastInsertRowid as number)!;
}

export function updateContact(
  id: number,
  nome: string,
  telefone: string,
  observacoes?: string,
  processo?: string
): Contact | undefined {
  const processoLimpo = processo?.trim() || null;
  updateStmt.run(
    nome.trim(),
    normalizePhone(telefone),
    processoLimpo,
    normalizeProcesso(processoLimpo),
    observacoes?.trim() || null,
    id
  );
  return getContact(id);
}

export function deleteContact(id: number): void {
  deleteContacts([id]);
}

/** Apaga em massa; ids inexistentes são ignorados. Retorna quantos registros foram de fato apagados. */
export function deleteContacts(ids: number[]): number {
  if (ids.length === 0) return 0;
  return deleteContactsTransaction(ids);
}
