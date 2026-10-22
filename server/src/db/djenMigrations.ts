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
  const columns = db.prepare("PRAGMA table_info(djen_publicacoes)").all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === "ia_status")) {
    db.transaction(() => {
      db.exec(`
        ALTER TABLE djen_publicacoes ADD COLUMN ia_status TEXT NOT NULL DEFAULT 'pendente';
        ALTER TABLE djen_publicacoes ADD COLUMN ia_json TEXT;
        ALTER TABLE djen_publicacoes ADD COLUMN ia_erro TEXT;
        ALTER TABLE djen_publicacoes ADD COLUMN ia_em TEXT;
        ALTER TABLE djen_config ADD COLUMN ia_ativa INTEGER NOT NULL DEFAULT 0;
        ALTER TABLE djen_config ADD COLUMN ia_pausa TEXT;
        UPDATE djen_publicacoes SET categorias_json='[]', evidencias_json='[]', resultado='nao_identificado' WHERE revisada=0;
        UPDATE djen_publicacoes SET ia_status='nao_solicitada' WHERE revisada=1;
      `);
    })();
  }
  const atuais = db.prepare("PRAGMA table_info(djen_publicacoes)").all() as {
    name: string;
  }[];
  if (!atuais.some((c) => c.name === "ia_versao"))
    db.transaction(() => {
      db.exec(`
      ALTER TABLE djen_publicacoes ADD COLUMN ia_versao TEXT NOT NULL DEFAULT '';
      ALTER TABLE djen_publicacoes ADD COLUMN ia_duracao_ms INTEGER;
      ALTER TABLE djen_publicacoes ADD COLUMN ia_iniciada_em TEXT;
      ALTER TABLE djen_publicacoes ADD COLUMN situacao TEXT NOT NULL DEFAULT '';
      ALTER TABLE djen_config ADD COLUMN ia_paralelismo INTEGER NOT NULL DEFAULT 2;
      UPDATE djen_publicacoes SET ia_status='pendente',ia_json=NULL,ia_em=NULL,categorias_json='[]',evidencias_json='[]',resultado='nao_identificado' WHERE revisada=0 AND cancelada=0;
    `);
    })();
  db.exec(`
    CREATE TABLE IF NOT EXISTS djen_prazos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, publicacao_id INTEGER NOT NULL REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
      descricao TEXT NOT NULL, inicio TEXT, termino TEXT, status TEXT NOT NULL DEFAULT 'aberto', observacoes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_djen_prazos_publicacao ON djen_prazos(publicacao_id,termino);
    CREATE TABLE IF NOT EXISTS djen_documentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, publicacao_id INTEGER NOT NULL REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
      nome TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS djen_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT, publicacao_id INTEGER NOT NULL REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL, descricao TEXT NOT NULL, dados_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_djen_historico_publicacao ON djen_historico(publicacao_id,id DESC);
  `);
  const campos = db.prepare("PRAGMA table_info(djen_publicacoes)").all() as {
    name: string;
  }[];
  if (!campos.some((c) => c.name === "concluida"))
    db.transaction(() => {
      db.exec(`ALTER TABLE djen_publicacoes ADD COLUMN concluida INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE djen_publicacoes ADD COLUMN concluida_em TEXT;
      ALTER TABLE djen_publicacoes ADD COLUMN ia_manual INTEGER NOT NULL DEFAULT 0;
      UPDATE djen_publicacoes SET ia_status='pendente',ia_erro=NULL WHERE revisada=0 AND cancelada=0;
      CREATE TABLE IF NOT EXISTS djen_agenda_links(prazo_id INTEGER NOT NULL REFERENCES djen_prazos(id) ON DELETE CASCADE, calendar_id TEXT NOT NULL, event_id TEXT NOT NULL, url TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(prazo_id,calendar_id));`);
    })();
  const configCampos = db.prepare("PRAGMA table_info(djen_config)").all() as {
    name: string;
  }[];
  if (!configCampos.some((c) => c.name === "ia_modo"))
    db.exec(
      "ALTER TABLE djen_config ADD COLUMN ia_modo TEXT NOT NULL DEFAULT 'economico' CHECK(ia_modo IN ('economico','equilibrado','precisao'))",
    );
  db.exec(`
    CREATE TABLE IF NOT EXISTS djen_analise_cache (
      chave TEXT PRIMARY KEY, versao TEXT NOT NULL, analise_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS djen_codex_execucoes (
      id INTEGER PRIMARY KEY AUTOINCREMENT, modelo TEXT NOT NULL, esforco TEXT NOT NULL,
      modo TEXT NOT NULL, itens INTEGER NOT NULL, caracteres INTEGER NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('concluida','falha','cache')),
      duracao_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_djen_codex_execucoes_data ON djen_codex_execucoes(created_at DESC);
    CREATE TABLE IF NOT EXISTS djen_calendarios_oficiais (
      chave TEXT PRIMARY KEY, tribunal TEXT NOT NULL, orgao TEXT NOT NULL, ano INTEGER NOT NULL,
      status TEXT NOT NULL DEFAULT 'pendente', municipio TEXT, uf TEXT,
      eventos_json TEXT NOT NULL DEFAULT '[]', fontes_json TEXT NOT NULL DEFAULT '[]', avisos_json TEXT NOT NULL DEFAULT '[]',
      erro TEXT, consultado_em TEXT, atualizado_em TEXT, proxima_tentativa INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_djen_calendarios_escopo ON djen_calendarios_oficiais(tribunal,orgao,ano);
    CREATE TABLE IF NOT EXISTS djen_calendario_ajustes (
      chave TEXT PRIMARY KEY REFERENCES djen_calendarios_oficiais(chave) ON DELETE CASCADE,
      ajustes_json TEXT NOT NULL, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS djen_calendario_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT, chave TEXT NOT NULL REFERENCES djen_calendarios_oficiais(chave) ON DELETE CASCADE,
      tipo TEXT NOT NULL, descricao TEXT NOT NULL, dados_json TEXT, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS djen_acompanhamentos_pericia (
      pericia_id INTEGER PRIMARY KEY REFERENCES pericias_agendadas(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','cobrado','resolvido')),
      ultima_cobranca_em TEXT, observacoes TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare(
    `UPDATE djen_publicacoes
        SET categorias_json='["pericia"]',
            ia_json=json_set(ia_json,'$.categorias',json('["pericia"]')),
            situacao=CASE WHEN situacao='' THEN 'Perícia agendada' ELSE situacao END
      WHERE revisada=0 AND cancelada=0 AND categorias_json='[]' AND ia_json IS NOT NULL
        AND json_extract(ia_json,'$.agendamento.data') IS NOT NULL
        AND json_extract(ia_json,'$.agendamento.horario') IS NOT NULL
        AND (texto LIKE '%designad%' OR texto LIKE '%agendad%' OR texto LIKE '%redesignad%' OR texto LIKE '%marcad%')`,
  ).run();
}
