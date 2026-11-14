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

    -- Anotações no cadastro da pessoa (sem processo): o caminho curto para registrar algo sobre o cliente
    CREATE TABLE IF NOT EXISTS gestao_anotacoes_pessoa (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pessoa_id INTEGER NOT NULL REFERENCES gestao_pessoas(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, autor TEXT NOT NULL DEFAULT '',
      texto TEXT NOT NULL, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gestao_anotacoes_pessoa ON gestao_anotacoes_pessoa(pessoa_id, id DESC);

    -- Fase 2: arquivos por pasta (processo) ou pessoa, com versões; modelos de documento
    CREATE TABLE IF NOT EXISTS gestao_arquivos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      processo_id INTEGER REFERENCES gestao_processos(id) ON DELETE CASCADE,
      pessoa_id INTEGER REFERENCES gestao_pessoas(id) ON DELETE CASCADE,
      nome TEXT NOT NULL, armazenado TEXT NOT NULL UNIQUE, mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      tamanho INTEGER NOT NULL DEFAULT 0, categoria TEXT NOT NULL DEFAULT '', descricao TEXT NOT NULL DEFAULT '',
      grupo INTEGER, versao INTEGER NOT NULL DEFAULT 1,
      enviado_por INTEGER REFERENCES users(id) ON DELETE SET NULL, autor TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CHECK(processo_id IS NOT NULL OR pessoa_id IS NOT NULL)
    );
    CREATE INDEX IF NOT EXISTS idx_gestao_arquivos_processo ON gestao_arquivos(processo_id, criado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_gestao_arquivos_pessoa ON gestao_arquivos(pessoa_id, criado_em DESC);
    CREATE INDEX IF NOT EXISTS idx_gestao_arquivos_grupo ON gestao_arquivos(grupo, versao);
    CREATE TABLE IF NOT EXISTS gestao_modelos (
      id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, categoria TEXT NOT NULL DEFAULT '',
      conteudo TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1, padrao TEXT UNIQUE,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    -- Fase 3: tarefas (manuais ou vindas dos prazos do DJEN)
    CREATE TABLE IF NOT EXISTS gestao_tarefas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '',
      processo_id INTEGER REFERENCES gestao_processos(id) ON DELETE CASCADE,
      pessoa_id INTEGER REFERENCES gestao_pessoas(id) ON DELETE SET NULL,
      responsavel_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
      prazo TEXT, prazo_fatal INTEGER NOT NULL DEFAULT 0,
      prioridade TEXT NOT NULL DEFAULT 'normal' CHECK(prioridade IN ('baixa','normal','alta','urgente')),
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','em_andamento','concluida','cancelada')),
      concluida_em TEXT, origem TEXT NOT NULL DEFAULT 'manual' CHECK(origem IN ('manual','djen')),
      djen_prazo_id INTEGER UNIQUE REFERENCES djen_prazos(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gestao_tarefas_resp ON gestao_tarefas(responsavel_user_id, status, prazo);
    CREATE INDEX IF NOT EXISTS idx_gestao_tarefas_processo ON gestao_tarefas(processo_id);

    -- Fase 4: contratos de honorários e lançamentos financeiros (controle interno)
    CREATE TABLE IF NOT EXISTS gestao_contratos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pessoa_id INTEGER REFERENCES gestao_pessoas(id) ON DELETE SET NULL,
      processo_id INTEGER REFERENCES gestao_processos(id) ON DELETE SET NULL,
      descricao TEXT NOT NULL, tipo TEXT NOT NULL DEFAULT 'parcelado' CHECK(tipo IN ('fixo','parcelado','exito','misto')),
      valor_total_centavos INTEGER NOT NULL DEFAULT 0, percentual_exito INTEGER,
      status TEXT NOT NULL DEFAULT 'ativo' CHECK(status IN ('ativo','quitado','cancelado')),
      observacoes TEXT NOT NULL DEFAULT '', criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS gestao_lancamentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL CHECK(tipo IN ('receber','pagar')),
      categoria TEXT NOT NULL DEFAULT 'honorarios' CHECK(categoria IN ('honorarios','custas','despesa','comissao','repasse','outro')),
      descricao TEXT NOT NULL, valor_centavos INTEGER NOT NULL CHECK(valor_centavos > 0),
      vencimento TEXT NOT NULL, pago_em TEXT, valor_pago_centavos INTEGER, forma_pagamento TEXT NOT NULL DEFAULT '',
      cancelado INTEGER NOT NULL DEFAULT 0,
      pessoa_id INTEGER REFERENCES gestao_pessoas(id) ON DELETE SET NULL,
      processo_id INTEGER REFERENCES gestao_processos(id) ON DELETE SET NULL,
      contrato_id INTEGER REFERENCES gestao_contratos(id) ON DELETE SET NULL,
      beneficiario_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reembolsavel INTEGER NOT NULL DEFAULT 0, parcela_numero INTEGER, parcela_total INTEGER,
      observacoes TEXT NOT NULL DEFAULT '', criado_por INTEGER REFERENCES users(id) ON DELETE SET NULL,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gestao_lanc_venc ON gestao_lancamentos(vencimento, tipo);
    CREATE INDEX IF NOT EXISTS idx_gestao_lanc_pessoa ON gestao_lancamentos(pessoa_id);
    CREATE INDEX IF NOT EXISTS idx_gestao_lanc_processo ON gestao_lancamentos(processo_id);
    CREATE INDEX IF NOT EXISTS idx_gestao_lanc_contrato ON gestao_lancamentos(contrato_id);

    -- Modelo da ficha de cadastro impressa (uma linha só, em JSON)
    CREATE TABLE IF NOT EXISTS gestao_ficha_config (id INTEGER PRIMARY KEY CHECK(id=1), config_json TEXT NOT NULL DEFAULT '{}', atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

    -- Dados do escritório (nome, endereço, advogados, testemunhas) e textos dos documentos (procuração, contrato…), em JSON
    CREATE TABLE IF NOT EXISTS gestao_escritorio_config (id INTEGER PRIMARY KEY CHECK(id=1), config_json TEXT NOT NULL DEFAULT '{}', atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE IF NOT EXISTS gestao_documentos_config (id INTEGER PRIMARY KEY CHECK(id=1), config_json TEXT NOT NULL DEFAULT '{}', atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);

    -- Campos personalizados (pessoa ou processo) e seus valores; "senha" fica criptografada
    CREATE TABLE IF NOT EXISTS gestao_campos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entidade TEXT NOT NULL CHECK(entidade IN ('pessoa','processo')),
      nome TEXT NOT NULL,
      tipo TEXT NOT NULL CHECK(tipo IN ('texto','texto_longo','numero','moeda','data','sim_nao','lista','senha','link','telefone','email')),
      opcoes_json TEXT NOT NULL DEFAULT '[]', grupo TEXT NOT NULL DEFAULT '', ordem INTEGER NOT NULL DEFAULT 0,
      ativo INTEGER NOT NULL DEFAULT 1, imprimir INTEGER NOT NULL DEFAULT 1,
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE UNIQUE INDEX IF NOT EXISTS uq_gestao_campos_nome ON gestao_campos(entidade, nome COLLATE NOCASE);
    CREATE TABLE IF NOT EXISTS gestao_campos_valores (
      campo_id INTEGER NOT NULL REFERENCES gestao_campos(id) ON DELETE CASCADE,
      entidade_id INTEGER NOT NULL, valor TEXT NOT NULL DEFAULT '', atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(campo_id, entidade_id)
    );
    CREATE INDEX IF NOT EXISTS idx_gestao_campos_valores_entidade ON gestao_campos_valores(entidade_id);
  `);
  // Ficha de cadastro: escolaridade, PIS/NIT, nome da mãe e filiação (colunas acrescentadas sem tocar nas existentes).
  const colunas = (db.prepare("PRAGMA table_info(gestao_pessoas)").all() as { name: string }[]).map((c) => c.name);
  for (const nome of ["escolaridade", "pis", "nome_mae", "filiacao", "nacionalidade", "sexo"]) if (!colunas.includes(nome)) db.exec(`ALTER TABLE gestao_pessoas ADD COLUMN ${nome} TEXT NOT NULL DEFAULT ''`);
  // Anotação IMPORTANTE (pendência): fica em destaque no cadastro do cliente até alguém marcar como cumprida.
  for (const tabela of ["gestao_anotacoes", "gestao_anotacoes_pessoa"]) {
    const cols = (db.prepare(`PRAGMA table_info(${tabela})`).all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("importante")) db.exec(`ALTER TABLE ${tabela} ADD COLUMN importante INTEGER NOT NULL DEFAULT 0`);
    if (!cols.includes("cumprida_em")) db.exec(`ALTER TABLE ${tabela} ADD COLUMN cumprida_em TEXT`);
    if (!cols.includes("cumprida_por")) db.exec(`ALTER TABLE ${tabela} ADD COLUMN cumprida_por TEXT`);
  }
  // Aditamentos do financeiro: o saldo de um pagamento parcial aponta para o lançamento de origem; cada alteração fica no histórico.
  const colsLanc = (db.prepare("PRAGMA table_info(gestao_lancamentos)").all() as { name: string }[]).map((c) => c.name);
  if (!colsLanc.includes("origem_lancamento_id")) db.exec("ALTER TABLE gestao_lancamentos ADD COLUMN origem_lancamento_id INTEGER");
  db.exec(`
    CREATE TABLE IF NOT EXISTS gestao_lancamentos_historico (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lancamento_id INTEGER NOT NULL, acao TEXT NOT NULL, detalhe TEXT NOT NULL DEFAULT '',
      user_id INTEGER, autor TEXT NOT NULL DEFAULT '', criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_gestao_lanc_hist ON gestao_lancamentos_historico(lancamento_id, id DESC);
  `);
  // Asaas (boleto/PIX) e régua de cobrança.
  db.exec(`
    CREATE TABLE IF NOT EXISTS gestao_asaas_clientes (pessoa_id INTEGER PRIMARY KEY, customer_id TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS gestao_asaas_cobrancas (
      lancamento_id INTEGER PRIMARY KEY, payment_id TEXT NOT NULL UNIQUE, billing_type TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING',
      invoice_url TEXT NOT NULL DEFAULT '', bank_slip_url TEXT NOT NULL DEFAULT '', linha_digitavel TEXT NOT NULL DEFAULT '', pix_payload TEXT NOT NULL DEFAULT '',
      valor_centavos INTEGER NOT NULL, vencimento TEXT NOT NULL, taxa_centavos INTEGER, liquido_centavos INTEGER, pago_em TEXT, forma_paga TEXT NOT NULL DEFAULT '',
      erro TEXT, criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS gestao_asaas_extrato (
      id TEXT PRIMARY KEY, data TEXT NOT NULL, tipo TEXT NOT NULL, descricao TEXT NOT NULL DEFAULT '', valor_centavos INTEGER NOT NULL, payment_id TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_asaas_extrato_data ON gestao_asaas_extrato(data);
    -- Mensagens enviadas pelo Deskcomm: guarda a conversa para conferir depois resposta e leitura (✓✓) do cliente
    CREATE TABLE IF NOT EXISTS deskcomm_mensagens (
      message_id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      telefone_digits TEXT NOT NULL,
      ack INTEGER NOT NULL DEFAULT 1,
      criada_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_deskcomm_mensagens_conversa ON deskcomm_mensagens(conversation_id);
    CREATE TABLE IF NOT EXISTS gestao_avisos_cobranca (
      id INTEGER PRIMARY KEY AUTOINCREMENT, lancamento_id INTEGER NOT NULL, regra TEXT NOT NULL, origem TEXT NOT NULL DEFAULT 'automatico',
      status TEXT NOT NULL, tentativas INTEGER NOT NULL DEFAULT 0, erro TEXT, mensagem TEXT NOT NULL DEFAULT '', telefone TEXT NOT NULL DEFAULT '',
      criado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, atualizado_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(lancamento_id, regra)
    );
    CREATE INDEX IF NOT EXISTS idx_avisos_cobranca_criado ON gestao_avisos_cobranca(criado_em DESC);
    CREATE TABLE IF NOT EXISTS gestao_cobranca_pausa (pessoa_id INTEGER PRIMARY KEY);
  `);
  const colsCob = (db.prepare("PRAGMA table_info(gestao_asaas_cobrancas)").all() as { name: string }[]).map((c) => c.name);
  if (!colsCob.includes("taxa_prevista_centavos")) db.exec("ALTER TABLE gestao_asaas_cobrancas ADD COLUMN taxa_prevista_centavos INTEGER");
  if (!colsCob.includes("boleto_arquivo_id")) db.exec("ALTER TABLE gestao_asaas_cobrancas ADD COLUMN boleto_arquivo_id INTEGER");
  // Contatos espelhados dos clientes (os avisos continuam lendo a tabela contacts; quem cadastra é o Cliente).
  const colsContatos = (db.prepare("PRAGMA table_info(contacts)").all() as { name: string }[]).map((c) => c.name);
  if (!colsContatos.includes("pessoa_id")) db.exec("ALTER TABLE contacts ADD COLUMN pessoa_id INTEGER");
  if (!colsContatos.includes("origem")) db.exec("ALTER TABLE contacts ADD COLUMN origem TEXT NOT NULL DEFAULT 'manual'");
  db.exec("CREATE INDEX IF NOT EXISTS idx_contacts_pessoa ON contacts(pessoa_id)");
}
