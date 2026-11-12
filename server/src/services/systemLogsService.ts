import { db } from "../db";

export type SystemLogLevel = "info" | "aviso" | "erro";
export type SystemLogOrigin = "automatico" | "usuario" | "sistema";

export interface SystemLog {
  id: number;
  nivel: SystemLogLevel;
  categoria: string;
  evento: string;
  titulo: string;
  mensagem: string | null;
  origem: SystemLogOrigin;
  detalhes_json: string | null;
  created_at: string;
}

export interface NewSystemLog {
  nivel: SystemLogLevel;
  categoria: string;
  evento: string;
  titulo: string;
  mensagem?: string | null;
  origem: SystemLogOrigin;
  detalhes?: unknown;
}

const insertStmt = db.prepare(`
  INSERT INTO system_logs (nivel, categoria, evento, titulo, mensagem, origem, detalhes_json)
  VALUES (@nivel, @categoria, @evento, @titulo, @mensagem, @origem, @detalhes_json)
`);

const getStmt = db.prepare("SELECT * FROM system_logs WHERE id = ?");

export function createSystemLog(entry: NewSystemLog): SystemLog {
  let detalhesJson: string | null = null;
  if (entry.detalhes !== undefined) {
    try {
      detalhesJson = JSON.stringify(entry.detalhes);
    } catch {
      detalhesJson = JSON.stringify({ aviso: "Os detalhes deste registro não puderam ser serializados." });
    }
  }

  const info = insertStmt.run({
    nivel: entry.nivel,
    categoria: entry.categoria,
    evento: entry.evento,
    titulo: entry.titulo,
    mensagem: entry.mensagem ?? null,
    origem: entry.origem,
    detalhes_json: detalhesJson,
  });

  return getStmt.get(info.lastInsertRowid) as SystemLog;
}

/** Registra auditoria sem permitir que uma falha secundária no banco interrompa o fluxo principal. */
export function recordSystemLog(entry: NewSystemLog): SystemLog | null {
  try {
    return createSystemLog(entry);
  } catch (err) {
    console.error("[Logs] Não foi possível registrar o evento:", err);
    return null;
  }
}

export function listSystemLogs(limit = 500): SystemLog[] {
  const limiteSeguro = Math.min(Math.max(Math.trunc(limit) || 500, 1), 1000);
  return db
    .prepare("SELECT * FROM system_logs ORDER BY created_at DESC, id DESC LIMIT ?")
    .all(limiteSeguro) as SystemLog[];
}

/** Apaga registros mais antigos que N dias (7 a 3650) ou todos ("todos"). Devolve quantos foram apagados. */
export function apagarLogsAntigos(dias: unknown): number {
  if (dias === "todos") return db.prepare("DELETE FROM system_logs").run().changes;
  const n = Number(dias);
  if (!Number.isInteger(n) || n < 7 || n > 3650) throw new Error("Informe um período de 7 a 3650 dias, ou «todos».");
  return db.prepare("DELETE FROM system_logs WHERE created_at < datetime('now', '-' || ? || ' days')").run(n).changes;
}
