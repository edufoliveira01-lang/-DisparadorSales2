import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { PLANOS_PADRAO } from "./planosPadrao";

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
  // Atendimento (DeskcommCRM via ponte): estado da empresa lá — ativo, suspenso ou vazio (nunca provisionado).
  if (!cols.includes("atendimento_estado")) db.exec("ALTER TABLE escritorios ADD COLUMN atendimento_estado TEXT");
  if (!cols.includes("atendimento_em")) db.exec("ALTER TABLE escritorios ADD COLUMN atendimento_em TEXT");
  if (!cols.includes("atendimento_erro")) db.exec("ALTER TABLE escritorios ADD COLUMN atendimento_erro TEXT");
  // Plano à venda na página pública de contratação.
  const colsPlano = (db.prepare("PRAGMA table_info(planos)").all() as { name: string }[]).map((c) => c.name);
  if (!colsPlano.includes("publico")) db.exec("ALTER TABLE planos ADD COLUMN publico INTEGER NOT NULL DEFAULT 0");
  if (!colsPlano.includes("resumo")) db.exec("ALTER TABLE planos ADD COLUMN resumo TEXT NOT NULL DEFAULT ''");
  if (!colsPlano.includes("destaque")) db.exec("ALTER TABLE planos ADD COLUMN destaque INTEGER NOT NULL DEFAULT 0");
  // Plano genérico de sempre (compatibilidade com escritórios e rotinas que o usam como padrão).
  if (!db.prepare("SELECT id FROM planos LIMIT 1").get())
    db.prepare("INSERT INTO planos(id,nome,preco_centavos,entitlements_json,ativo,criado_em) VALUES ('escritorio','Escritório',0,'{}',1,?)").run(new Date().toISOString());
  // Os quatro planos de fábrica entram uma vez (quem já os editou ou apagou não é sobrescrito).
  db.exec("CREATE TABLE IF NOT EXISTS config_painel (chave TEXT PRIMARY KEY, valor TEXT NOT NULL)");
  if (!db.prepare("SELECT 1 FROM config_painel WHERE chave='planos_padrao_v1'").get()) {
    const agora = new Date().toISOString();
    const ins = db.prepare("INSERT OR IGNORE INTO planos(id,nome,preco_centavos,entitlements_json,ativo,criado_em,publico,resumo,destaque) VALUES (?,?,?,?,1,?,1,?,?)");
    for (const p of PLANOS_PADRAO) ins.run(p.id, p.nome, p.preco_centavos, JSON.stringify(p.entitlements), agora, p.resumo, p.destaque ? 1 : 0);
    db.prepare("INSERT INTO config_painel(chave,valor) VALUES ('planos_padrao_v1',?)").run(agora);
  }
  return db;
}
