import type Database from "better-sqlite3";

/** Dados do acompanhamento processual não usam as tabelas de perícias, envios ou prazos. */
export function runDjenMigrations(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS djen_advogados (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL, numero_oab TEXT NOT NULL, uf_oab TEXT NOT NULL,
      modo_busca TEXT NOT NULL DEFAULT 'ambos' CHECK(modo_busca IN ('ambos','oab','nome')),
      ativo INTEGER NOT NULL DEFAULT 1,
      cursor_data TEXT, ultimo_sucesso_em TEXT, ultimo_erro TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(numero_oab, uf_oab)
    );
    CREATE TABLE IF NOT EXISTS djen_processos (
      chave TEXT PRIMARY KEY, numero TEXT NOT NULL,
      cliente_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      observacoes TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS djen_publicacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, comunicacao_id TEXT NOT NULL UNIQUE,
      hash TEXT, processo_chave TEXT NOT NULL REFERENCES djen_processos(chave),
      tribunal TEXT NOT NULL, orgao TEXT NOT NULL, classe TEXT NOT NULL,
      tipo_documento TEXT NOT NULL, tipo_comunicacao TEXT NOT NULL,
      data_disponibilizacao TEXT NOT NULL, texto TEXT NOT NULL,
      link TEXT, destinatarios_json TEXT NOT NULL DEFAULT '[]', advogados_json TEXT NOT NULL DEFAULT '[]',
      categorias_json TEXT NOT NULL DEFAULT '[]', evidencias_json TEXT NOT NULL DEFAULT '[]',
      resultado TEXT NOT NULL DEFAULT 'nao_identificado',
      revisada INTEGER NOT NULL DEFAULT 0, lida INTEGER NOT NULL DEFAULT 0, cancelada INTEGER NOT NULL DEFAULT 0,
      captured_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_djen_publicacoes_data ON djen_publicacoes(data_disponibilizacao DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_djen_publicacoes_processo ON djen_publicacoes(processo_chave);
    CREATE TABLE IF NOT EXISTS djen_publicacao_advogados (
      publicacao_id INTEGER NOT NULL REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
      advogado_id INTEGER NOT NULL REFERENCES djen_advogados(id),
      correspondencia TEXT NOT NULL CHECK(correspondencia IN ('oab','consulta_oab','nome_revisar')),
      PRIMARY KEY(publicacao_id, advogado_id)
    );
    CREATE TABLE IF NOT EXISTS djen_buscas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      origem TEXT NOT NULL, inicio TEXT NOT NULL, fim TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'executando', novas INTEGER NOT NULL DEFAULT 0,
      recebidas INTEGER NOT NULL DEFAULT 0, consultas INTEGER NOT NULL DEFAULT 0,
      erros_json TEXT NOT NULL DEFAULT '[]', started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
    );
    CREATE TABLE IF NOT EXISTS djen_config (
      id INTEGER PRIMARY KEY CHECK(id = 1), automatico INTEGER NOT NULL DEFAULT 0,
      intervalo_minutos INTEGER NOT NULL DEFAULT 60, janela_inicial_dias INTEGER NOT NULL DEFAULT 7
    );
    INSERT OR IGNORE INTO djen_config(id) VALUES (1);
    CREATE TABLE IF NOT EXISTS djen_mensagens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicacao_id INTEGER NOT NULL REFERENCES djen_publicacoes(id),
      request_id TEXT NOT NULL UNIQUE, cliente_nome TEXT NOT NULL, telefone TEXT NOT NULL,
      texto TEXT NOT NULL, status TEXT NOT NULL, whatsapp_message_id TEXT, ack INTEGER, erro TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_djen_mensagens_publicacao ON djen_mensagens(publicacao_id, id DESC);
  `);
}
