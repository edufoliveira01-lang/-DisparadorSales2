import type Database from "better-sqlite3";

export function runMigrations(db: Database.Database): void {
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS contacts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      telefone TEXT NOT NULL,
      observacoes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS templates (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL,
      conteudo_1_pericia TEXT NOT NULL,
      conteudo_2_pericias TEXT NOT NULL,
      conteudo_pericia_medica TEXT,
      conteudo_pericia_social TEXT,
      modo_envio_2_pericias TEXT CHECK(modo_envio_2_pericias IN ('combinada','separadas')) DEFAULT 'combinada',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS settings (
      chave TEXT PRIMARY KEY,
      valor TEXT
    );

    CREATE TABLE IF NOT EXISTS send_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      card_nome TEXT,
      contact_id INTEGER,
      telefone TEXT,
      pericias_json TEXT,
      mensagem_enviada TEXT,
      status TEXT CHECK(status IN ('sucesso','falha')),
      erro TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_send_logs_card_id ON send_logs(card_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_nome ON contacts(nome);
  `);

  const templateCount = db.prepare("SELECT COUNT(*) as count FROM templates").get() as { count: number };
  if (templateCount.count === 0) {
    db.prepare(
      `INSERT INTO templates (nome, conteudo_1_pericia, conteudo_2_pericias, modo_envio_2_pericias)
       VALUES (?, ?, ?, ?)`
    ).run(
      "Padrão",
      "Olá {{NOME}}, tudo bem?\n\nVocê tem uma perícia agendada:\n\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n\nQualquer dúvida, estou à disposição!",
      "Olá {{NOME}}, tudo bem?\n\nVocê tem as seguintes perícias agendadas:\n\n{{#each PERICIAS}}\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n\n{{/each}}\nQualquer dúvida, estou à disposição!",
      "combinada"
    );
  }
}
