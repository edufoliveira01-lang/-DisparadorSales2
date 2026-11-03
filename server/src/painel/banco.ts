import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

export type Banco = Database.Database;

/** Banco próprio do painel. Nunca compartilha arquivo nem schema com o banco do produto. */
export function abrirBancoPainel(arquivo: string): Banco {
  if (arquivo !== ":memory:") fs.mkdirSync(path.dirname(arquivo), { recursive: true, mode: 0o700 });
  const db = new Database(arquivo);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(`
    CREATE TABLE IF NOT EXISTS planos (
      id TEXT PRIMARY KEY, nome TEXT NOT NULL,
      preco_centavos INTEGER NOT NULL DEFAULT 0 CHECK(preco_centavos >= 0),
      entitlements_json TEXT NOT NULL DEFAULT '{}',
      ativo INTEGER NOT NULL DEFAULT 1, criado_em TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS escritorios (
      id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, nome TEXT NOT NULL,
      documento TEXT, email TEXT NOT NULL, telefone TEXT,
      plano_id TEXT NOT NULL REFERENCES planos(id),
      entitlements_json TEXT NOT NULL DEFAULT '{}',
      status_manual TEXT CHECK(status_manual IN ('suspensa','cancelada')),
      teste_ate TEXT, pago_ate TEXT, carencia_dias INTEGER,
      asaas_customer_id TEXT, asaas_subscription_id TEXT, link_fatura TEXT,
      chave_hash TEXT NOT NULL UNIQUE, chave_prefixo TEXT NOT NULL,
      ultimo_contato_em TEXT, ultima_versao TEXT, ultimo_ip TEXT,
      observacoes TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL, atualizado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_escritorios_sub ON escritorios(asaas_subscription_id);
    CREATE INDEX IF NOT EXISTS idx_escritorios_cli ON escritorios(asaas_customer_id);
    CREATE TABLE IF NOT EXISTS pagamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      escritorio_id TEXT NOT NULL REFERENCES escritorios(id) ON DELETE CASCADE,
      asaas_payment_id TEXT NOT NULL, evento TEXT NOT NULL, status TEXT,
      valor_centavos INTEGER, vencimento TEXT, pago_em TEXT, link_fatura TEXT,
      criado_em TEXT NOT NULL, UNIQUE(asaas_payment_id, evento)
    );
    CREATE TABLE IF NOT EXISTS eventos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, escritorio_id TEXT,
      tipo TEXT NOT NULL, detalhe_json TEXT NOT NULL DEFAULT '{}', criado_em TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_eventos_escritorio ON eventos(escritorio_id, id DESC);
    CREATE TABLE IF NOT EXISTS admins (usuario TEXT PRIMARY KEY, senha_hash TEXT NOT NULL, criado_em TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessoes (token_hash TEXT PRIMARY KEY, usuario TEXT NOT NULL, criado_em TEXT NOT NULL, expira_em TEXT NOT NULL);
  `);
  // Migração: porta e data de criação da instância gerenciada pelo painel.
  const cols = (db.prepare("PRAGMA table_info(escritorios)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("porta")) db.exec("ALTER TABLE escritorios ADD COLUMN porta INTEGER");
  if (!cols.includes("instancia_em")) db.exec("ALTER TABLE escritorios ADD COLUMN instancia_em TEXT");
  if (!db.prepare("SELECT id FROM planos LIMIT 1").get())
    db.prepare("INSERT INTO planos(id,nome,preco_centavos,entitlements_json,ativo,criado_em) VALUES ('escritorio','Escritório',0,'{}',1,?)").run(new Date().toISOString());
  return db;
}
