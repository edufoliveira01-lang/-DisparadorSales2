import type Database from "better-sqlite3";
import { parseBrazilianDate, type Pericia } from "../services/parserService";
import { normalizePhone } from "../utils/phone";

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

    CREATE TABLE IF NOT EXISTS pericias_agendadas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      card_id TEXT NOT NULL,
      tipo TEXT NOT NULL,
      tipo_chave TEXT NOT NULL,
      origem TEXT,
      nome TEXT NOT NULL,
      nome_chave TEXT NOT NULL,
      telefone TEXT NOT NULL,
      telefone_digits TEXT NOT NULL,
      processo TEXT,
      processo_chave TEXT NOT NULL,
      data TEXT NOT NULL,
      horario TEXT,
      local TEXT,
      data_hora_ms INTEGER NOT NULL,
      status TEXT CHECK(status IN ('ativa','substituida')) DEFAULT 'ativa',
      substituida_por_id INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (substituida_por_id) REFERENCES pericias_agendadas(id)
    );

    CREATE INDEX IF NOT EXISTS idx_pericias_agendadas_data_hora ON pericias_agendadas(data_hora_ms);
    CREATE INDEX IF NOT EXISTS idx_pericias_agendadas_status ON pericias_agendadas(status);
    CREATE INDEX IF NOT EXISTS idx_pericias_agendadas_chave ON pericias_agendadas(tipo_chave, nome_chave, telefone_digits, processo_chave);

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
    // Id completo do chat (com domínio, ex: "5511999999999@c.us" ou "123456789@lid"), guardado
    // à parte de telefone_digits porque este último só serve para CASAR o remetente de uma
    // resposta recebida (comparação de dígitos, sem domínio). Reenviar uma nova mensagem (ex:
    // "Cobrar resposta") exige o id completo — telefone_digits sozinho não é suficiente quando o
    // contato foi resolvido como "LID" (identificador interno do WhatsApp, não um telefone de
    // verdade), caso em que tentar tratá-lo como telefone faz o WhatsApp não encontrar ninguém.
    "ALTER TABLE pending_replies ADD COLUMN whatsapp_chat_id TEXT",
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

  // Envios de antes do recurso de notificação existir nunca vão ter "ack" preenchido (o
  // rastreamento de entrega é mais recente que eles) — sem essa marcação, a primeira
  // verificação periódica trataria TODOS esses registros antigos como "sem confirmar entrega"
  // e disparariam um alerta retroativo enorme assim que o usuário configurasse o Telegram. Como
  // isso é só um problema na primeira vez, marcamos como "já alertado" uma única vez (guardado
  // em settings) tudo que já existia até aqui — dali em diante, só envios novos entram na
  // verificação normal.
  const backfillFeito = db.prepare("SELECT 1 FROM settings WHERE chave = 'alerta_backfill_feito'").get();
  if (!backfillFeito) {
    db.exec("UPDATE send_logs SET alerta_entrega_enviado_em = CURRENT_TIMESTAMP WHERE alerta_entrega_enviado_em IS NULL");
    db.prepare("INSERT INTO settings (chave, valor) VALUES ('alerta_backfill_feito', '1')").run();
  }

  // Mesma ideia acima, mas para o alerta de "cliente não respondeu": marca quando já avisamos
  // no Telegram sobre um pendente parado em "aguardando" há mais tempo que o prazo configurado.
  try {
    db.exec("ALTER TABLE pending_replies ADD COLUMN alerta_resposta_enviado_em DATETIME");
  } catch {
    // Coluna já existe
  }

  // Mesmo backfill de uma vez só, agora para pendentes de resposta: sem isso, todo pendente
  // "aguardando" já parado há muito tempo (de antes desse alerta existir) dispararia um alerta
  // retroativo em massa assim que o usuário configurasse o prazo de resposta.
  const backfillRespostaFeito = db.prepare("SELECT 1 FROM settings WHERE chave = 'resposta_alerta_backfill_feito'").get();
  if (!backfillRespostaFeito) {
    db.exec(
      "UPDATE pending_replies SET alerta_resposta_enviado_em = CURRENT_TIMESTAMP WHERE alerta_resposta_enviado_em IS NULL"
    );
    db.prepare("INSERT INTO settings (chave, valor) VALUES ('resposta_alerta_backfill_feito', '1')").run();
  }

  // Backfill de uma vez só: popula pericias_agendadas a partir do histórico de envios já
  // existente (send_logs) — sem isso, o calendário nasceria vazio para quem já usava o sistema
  // antes dessa feature existir, mesmo tendo anos de envios no Histórico. Implementado aqui com
  // SQL direto (em vez de chamar periciasAgendadasService) para evitar import circular: aquele
  // módulo importa `db` de "../db", que só termina de inicializar depois que runMigrations(db)
  // retorna — nesse ponto ele ainda nem existe.
  const periciasBackfillFeito = db.prepare("SELECT 1 FROM settings WHERE chave = 'pericias_agendadas_backfill_feito'").get();
  if (!periciasBackfillFeito) {
    const logsComPericias = db
      .prepare("SELECT card_id, pericias_json FROM send_logs WHERE status = 'sucesso' AND pericias_json IS NOT NULL ORDER BY created_at ASC")
      .all() as { card_id: string; pericias_json: string }[];

    const inserirPericiaAgendada = db.prepare(
      `INSERT INTO pericias_agendadas
         (card_id, tipo, tipo_chave, origem, nome, nome_chave, telefone, telefone_digits, processo, processo_chave, data, horario, local, data_hora_ms, status)
       VALUES (@card_id, @tipo, @tipo_chave, @origem, @nome, @nome_chave, @telefone, @telefone_digits, @processo, @processo_chave, @data, @horario, @local, @data_hora_ms, 'ativa')`
    );
    const buscarAtivasPorChave = db.prepare(
      `SELECT id FROM pericias_agendadas WHERE status = 'ativa' AND tipo_chave = ? AND nome_chave = ? AND telefone_digits = ? AND processo_chave = ?`
    );
    const marcarSubstituida = db.prepare(
      "UPDATE pericias_agendadas SET status = 'substituida', substituida_por_id = ? WHERE id = ?"
    );
    const chaveNormalizada = (valor: string | null | undefined) => (valor || "").trim().toLowerCase().replace(/\s+/g, " ");

    for (const log of logsComPericias) {
      let pericias: Pericia[];
      try {
        pericias = JSON.parse(log.pericias_json);
      } catch {
        continue; // registro antigo com JSON corrompido/inválido — ignora
      }

      for (const pericia of pericias) {
        const dataHoraMs = parseBrazilianDate(pericia.data, pericia.horario);
        if (!Number.isFinite(dataHoraMs)) continue; // sem data reconhecível, não dá pra calendarizar

        const tipoChave = chaveNormalizada(pericia.tipo);
        const nomeChave = chaveNormalizada(pericia.nome);
        const telefoneDigits = normalizePhone(pericia.telefone);
        const processoChave = chaveNormalizada(pericia.processo);

        const anteriores = buscarAtivasPorChave.all(tipoChave, nomeChave, telefoneDigits, processoChave) as { id: number }[];
        const info = inserirPericiaAgendada.run({
          card_id: log.card_id,
          tipo: pericia.tipo,
          tipo_chave: tipoChave,
          origem: pericia.origem ?? null,
          nome: pericia.nome,
          nome_chave: nomeChave,
          telefone: pericia.telefone,
          telefone_digits: telefoneDigits,
          processo: pericia.processo || null,
          processo_chave: processoChave,
          data: pericia.data,
          horario: pericia.horario || null,
          local: pericia.local || null,
          data_hora_ms: dataHoraMs,
        });
        for (const anterior of anteriores) {
          marcarSubstituida.run(info.lastInsertRowid, anterior.id);
        }
      }
    }

    db.prepare("INSERT INTO settings (chave, valor) VALUES ('pericias_agendadas_backfill_feito', '1')").run();
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
