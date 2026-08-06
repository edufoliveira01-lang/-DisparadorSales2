import { Router, raw } from "express";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { db, dataDir } from "../db";

export const backupRouter = Router();

const dbPath = path.join(dataDir, "disparador.sqlite3");
const TABELAS_ESPERADAS = ["users", "settings", "contacts", "templates", "send_logs", "pending_replies"];
const SQLITE_MAGIC = Buffer.from([
  0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x20, 0x66, 0x6f, 0x72, 0x6d, 0x61, 0x74, 0x20, 0x33, 0x00,
]); // "SQLite format 3\0"

backupRouter.get("/download", async (_req, res) => {
  const tmpPath = path.join(dataDir, `backup-tmp-${Date.now()}.sqlite3`);
  try {
    // db.backup usa a Online Backup API do SQLite: gera uma cópia consistente do banco "ao vivo"
    // (incluindo o que ainda está só no WAL) sem travar o servidor.
    await db.backup(tmpPath);
    const timestamp = new Date().toISOString().slice(0, 10);
    res.download(tmpPath, `disparazap-backup-${timestamp}.sqlite3`, (err) => {
      fs.unlink(tmpPath, () => {});
      if (err && !res.headersSent) {
        res.status(500).json({ error: "Erro ao gerar backup." });
      }
    });
  } catch (err) {
    fs.unlink(tmpPath, () => {});
    console.error("[Backup] Erro ao gerar backup:", err);
    res.status(500).json({ error: "Erro ao gerar backup." });
  }
});

backupRouter.post("/restore", raw({ type: "application/octet-stream", limit: "100mb" }), (req, res) => {
  const buffer = req.body as Buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length < 16 || !buffer.subarray(0, 16).equals(SQLITE_MAGIC)) {
    return res.status(400).json({ error: "O arquivo enviado não é um banco de dados SQLite válido." });
  }

  const tmpPath = path.join(dataDir, `restore-tmp-${Date.now()}.sqlite3`);
  fs.writeFileSync(tmpPath, buffer);

  const limparSidecars = (base: string) => {
    for (const suffix of ["-wal", "-shm"]) {
      const p = base + suffix;
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
  };

  try {
    const check = new Database(tmpPath, { readonly: true });
    try {
      const tabelas = new Set(
        (check.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map((t) => t.name)
      );
      if (!TABELAS_ESPERADAS.every((t) => tabelas.has(t))) {
        throw new Error("Faltam tabelas esperadas do DisparaZap.");
      }
    } finally {
      check.close();
      // Abrir para leitura pode criar -wal/-shm ao lado do arquivo temporário; limpa antes de seguir.
      limparSidecars(tmpPath);
    }
  } catch (err) {
    fs.unlinkSync(tmpPath);
    return res.status(400).json({ error: "O arquivo não parece ser um backup válido do DisparaZap." });
  }

  try {
    db.pragma("wal_checkpoint(TRUNCATE)");
    db.close();
  } catch (err) {
    console.error("[Backup] Erro ao fechar conexão do banco para restauração:", err);
  }

  for (const suffix of ["", "-wal", "-shm"]) {
    const p = dbPath + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  fs.renameSync(tmpPath, dbPath);

  res.json({ ok: true, message: "Backup restaurado com sucesso. O sistema sera reiniciado em instantes." });

  // O banco e um singleton importado por dezenas de modulos - em vez de tentar recriar a conexao
  // e todo o estado em memoria (WhatsApp, sessoes, agendamentos), e mais seguro encerrar o
  // processo e deixar o PM2 reiniciar o servidor ja lendo o arquivo restaurado.
  setTimeout(() => process.exit(0), 500);
});
