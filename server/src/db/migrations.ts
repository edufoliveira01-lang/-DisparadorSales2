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
      whatsapp_message_id TEXT,
      ack INTEGER,
      ack_updated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (contact_id) REFERENCES contacts(id)
    );

    CREATE INDEX IF NOT EXISTS idx_send_logs_card_id ON send_logs(card_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_nome ON contacts(nome);

    CREATE TABLE IF NOT EXISTS pending_replies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      card_nome TEXT,
      telefone TEXT NOT NULL,
      telefone_digits TEXT NOT NULL,
      status TEXT CHECK(status IN ('aguardando','respondido','cancelado')) DEFAULT 'aguardando',
      tipo_resposta TEXT CHECK(tipo_resposta IN ('mensagem','reacao')),
      resposta_preview TEXT,
      whatsapp_message_id TEXT,
      ack INTEGER,
      ack_updated_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      resolved_at DATETIME
    );

    CREATE INDEX IF NOT EXISTS idx_pending_replies_telefone_digits ON pending_replies(telefone_digits);
    CREATE INDEX IF NOT EXISTS idx_pending_replies_status ON pending_replies(status);

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      email TEXT,
      recovery_token TEXT,
      recovery_expires DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at DATETIME NOT NULL,
      last_activity DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // Migração para adicionar colunas se não existirem
  try {
    db.exec("ALTER TABLE templates ADD COLUMN conteudo_pericia_medica TEXT");
    db.exec("ALTER TABLE templates ADD COLUMN conteudo_pericia_social TEXT");
  } catch {
    // Colunas já existem
  }

  // Rastreamento de status de entrega/leitura (✓✓ do WhatsApp) por envio e por pendente de
  // resposta — cada ALTER isolado no seu próprio try/catch para não pular as colunas
  // seguintes se uma já existir.
  for (const stmt of [
    "ALTER TABLE send_logs ADD COLUMN whatsapp_message_id TEXT",
    "ALTER TABLE send_logs ADD COLUMN ack INTEGER",
    "ALTER TABLE send_logs ADD COLUMN ack_updated_at DATETIME",
    "ALTER TABLE pending_replies ADD COLUMN whatsapp_message_id TEXT",
    "ALTER TABLE pending_replies ADD COLUMN ack INTEGER",
    "ALTER TABLE pending_replies ADD COLUMN ack_updated_at DATETIME",
  ]) {
    try {
      db.exec(stmt);
    } catch {
      // Coluna já existe
    }
  }
  db.exec("CREATE INDEX IF NOT EXISTS idx_send_logs_whatsapp_message_id ON send_logs(whatsapp_message_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_pending_replies_whatsapp_message_id ON pending_replies(whatsapp_message_id)");

  // Marca quando um alerta de "entrega com problema" (falha no envio, ou entregue não
  // confirmada após X horas) já foi mandado pro Telegram, pra não notificar o mesmo envio
  // de novo a cada verificação periódica.
  try {
    db.exec("ALTER TABLE send_logs ADD COLUMN alerta_entrega_enviado_em DATETIME");
  } catch {
    // Coluna já existe
  }

  // Criar usuário padrão se não existir nenhum
  const userCount = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  if (userCount.count === 0) {
    // Senha padrão: admin123 (hash simples para exemplo, ideal seria bcrypt mas para uso local/simples manteremos direto ou hash sha256)
    // Usaremos um hash SHA256 fixo para 'admin123' para facilitar a primeira entrada
    const crypto = require("node:crypto");
    const hash = crypto.createHash("sha256").update("admin123").digest("hex");
    db.prepare("INSERT INTO users (username, password_hash) VALUES (?, ?)").run("admin", hash);
  }

  const templateCount = db.prepare("SELECT COUNT(*) as count FROM templates").get() as { count: number };
  if (templateCount.count === 0) {
    db.prepare(
      `INSERT INTO templates (nome, conteudo_1_pericia, conteudo_2_pericias, conteudo_pericia_medica, conteudo_pericia_social, modo_envio_2_pericias)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "Padrão",
      "Olá {{NOME}}, tudo bem?\n\nVocê tem uma perícia agendada:\n\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n\nQualquer dúvida, estou à disposição!",
      "Olá {{NOME}}, tudo bem?\n\nVocê tem as seguintes perícias agendadas:\n\n{{#each PERICIAS}}\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n\n{{/each}}\nQualquer dúvida, estou à disposição!",
      "Olá {{NOME}}, tudo bem?\n\nVocê tem uma perícia médica agendada:\n\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n\nQualquer dúvida, estou à disposição!",
      "Olá {{NOME}}, tudo bem?\n\nVocê tem uma perícia social agendada:\n\n📌 {{TIPO_PERICIA}}\n🗓 Data: {{DATA}}\n🕐 Horário: {{HORARIO}}\n📍 Local: {{LOCAL}}\n\nQualquer dúvida, estou à disposição!",
      "combinada"
    );
  }
}
