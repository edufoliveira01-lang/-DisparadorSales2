import type Database from "better-sqlite3";

/** Módulo de gestão do escritório (pessoas, processos, pastas). Só acrescenta tabelas: nada do sistema anterior é alterado. */
export function runGestaoMigrations(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gestao_pessoas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL DEFAULT 'cliente' CHECK(tipo IN ('cliente','parte_contraria','testemunha','perito','outro')),
      pessoa_juridica INTEGER NOT NULL DEFAULT 0,
      nome TEXT NOT NULL,
      documento TEXT NOT NULL DEFAULT '', rg TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '', telefone TEXT NOT NULL DEFAULT '', telefone2 TEXT NOT NULL DEFAULT '',
      cep TEXT NOT NULL DEFAULT '', logradouro TEXT NOT NULL DEFAULT '', numero TEXT NOT NULL DEFAULT '', complemento TEXT NOT NULL DEFAULT '',
      bairro TEXT NOT NULL DEFAULT '', cidade TEXT NOT NULL DEFAULT '', uf TEXT NOT NULL DEFAULT '',
      data_nascimento TEXT NOT NULL DEFAULT '', profissao TEXT NOT NULL DEFAULT '', estado_civil TEXT NOT NULL DEFAULT '',
      origem TEXT NOT NULL DEFAULT '', observacoes TEXT NOT NULL DEFAULT '',
      contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
      ativo INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gestao_pessoas_contato ON gestao_pessoas(contact_id) WHERE contact_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_gestao_pessoas_nome ON gestao_pessoas(nome COLLATE NOCASE);
    CREATE INDEX IF NOT EXISTS idx_gestao_pessoas_documento ON gestao_pessoas(documento);

    CREATE TABLE IF NOT EXISTS gestao_processos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      numero TEXT NOT NULL, chave TEXT NOT NULL UNIQUE, pasta TEXT NOT NULL UNIQUE,
      titulo TEXT NOT NULL DEFAULT '',
      tribunal TEXT NOT NULL DEFAULT '', orgao TEXT NOT NULL DEFAULT '', comarca TEXT NOT NULL DEFAULT '',
      classe TEXT NOT NULL DEFAULT '', assunto TEXT NOT NULL DEFAULT '', area TEXT NOT NULL DEFAULT '',
      valor_causa_centavos INTEGER, fase TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','suspenso','arquivado','encerrado')),
      responsavel_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      data_distribuicao TEXT NOT NULL DEFAULT '', observacoes TEXT NOT NULL DEFAULT '',
      djen_chave TEXT UNIQUE,
      criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gestao_processos_status ON gestao_processos(status, atualizado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_gestao_processos_resp ON gestao_processos(responsavel_user_id);

    CREATE TABLE IF NOT EXISTS gestao_partes (
      processo_id INTEGER NOT NULL REFERENCES gestao_processos(id) ON DELETE CASCADE,
      pessoa_id INTEGER NOT NULL REFERENCES gestao_pessoas(id) ON DELETE CASCADE,
      papel TEXT NOT NULL CHECK(papel IN ('autor','reu','terceiro','testemunha','perito','advogado_contrario')),
      principal INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(processo_id, pessoa_id, papel)
    );
    CREATE INDEX IF NOT EXISTS idx_gestao_partes_pessoa ON gestao_partes(pessoa_id);

    CREATE TABLE IF NOT EXISTS gestao_anotacoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      processo_id INTEGER NOT NULL REFERENCES gestao_processos(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, autor TEXT NOT NULL DEFAULT '',
      texto TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gestao_anotacoes_processo ON gestao_anotacoes(processo_id, id DESC);
  `);
}
