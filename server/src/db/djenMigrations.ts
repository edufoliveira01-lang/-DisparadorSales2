import type Database from "better-sqlite3";
import { refinarCategoriasDaAnalise, type AnaliseCodex } from "../services/djen/classifier";
import { classificarComplementar } from "../services/djen/classificacaoComplementar";

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
  db.exec(`CREATE TABLE IF NOT EXISTS djen_historico_consultas (
    processo_chave TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'pendente',
    inicio TEXT, fim TEXT, consultado_em TEXT, erro TEXT,
    revisao INTEGER NOT NULL DEFAULT 0, revisao_conferida INTEGER NOT NULL DEFAULT -1,
    proxima_tentativa_em TEXT
  );`);
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
  const prazoCampos = db.prepare("PRAGMA table_info(djen_prazos)").all() as { name: string }[];
  if (!prazoCampos.some((c) => c.name === "responsavel"))
    db.exec("ALTER TABLE djen_prazos ADD COLUMN responsavel TEXT NOT NULL DEFAULT 'nao_identificado'");
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
  if (!configCampos.some((c) => c.name === "aguardo_dias"))
    db.exec("ALTER TABLE djen_config ADD COLUMN aguardo_dias INTEGER NOT NULL DEFAULT 30");
  db.exec(`
    CREATE TABLE IF NOT EXISTS djen_analise_cache (
      chave TEXT PRIMARY KEY, versao TEXT NOT NULL, analise_json TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS djen_exemplos_classificacao (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      publicacao_id INTEGER NOT NULL REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
      categoria TEXT NOT NULL,
      trecho TEXT NOT NULL,
      orientacao TEXT NOT NULL,
      criado_por INTEGER,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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
    CREATE TABLE IF NOT EXISTS djen_acompanhamentos_aguardo (
      publicacao_id INTEGER PRIMARY KEY REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','cobrado','resolvido')),
      ultima_cobranca_em TEXT
    );
    CREATE TABLE IF NOT EXISTS djen_acompanhamentos_obrigacoes (
      publicacao_id INTEGER NOT NULL REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
      tipo TEXT NOT NULL CHECK(tipo IN ('perito_laudo','perito_esclarecimentos','perito_calculos','inss_implantacao','parte_contraria','terceiro_oficio')),
      status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','cobrado','resolvido')),
      ultima_cobranca_em TEXT,
      PRIMARY KEY(publicacao_id,tipo)
    );
    CREATE INDEX IF NOT EXISTS idx_djen_publicacoes_processo_data
      ON djen_publicacoes(processo_chave,data_disponibilizacao DESC,id DESC);
    CREATE TABLE IF NOT EXISTS djen_kanban_listas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nome TEXT NOT NULL COLLATE NOCASE UNIQUE,
      posicao INTEGER NOT NULL,
      codigo TEXT UNIQUE,
      regra_categoria TEXT,
      contar_dias INTEGER NOT NULL DEFAULT 0 CHECK(contar_dias IN (0,1)),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS djen_kanban_cartoes (
      processo_chave TEXT PRIMARY KEY REFERENCES djen_processos(chave) ON DELETE CASCADE,
      lista_id INTEGER NOT NULL REFERENCES djen_kanban_listas(id),
      posicao INTEGER NOT NULL DEFAULT 0,
      entrou_em TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      inicio_espera_em TEXT,
      modo TEXT NOT NULL DEFAULT 'automatico' CHECK(modo IN ('automatico','manual')),
      etapa_publicacao_id INTEGER,
      etapa_evidencia TEXT,
      revisar_etapa INTEGER NOT NULL DEFAULT 1,
      sugestao_codigo TEXT,
      sugestao_publicacao_id INTEGER,
      sugestao_evidencia TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_djen_kanban_cartoes_lista ON djen_kanban_cartoes(lista_id,posicao);
    CREATE TABLE IF NOT EXISTS djen_kanban_movimentos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      processo_chave TEXT NOT NULL REFERENCES djen_processos(chave) ON DELETE CASCADE,
      origem TEXT,
      destino TEXT NOT NULL,
      origem_movimento TEXT NOT NULL DEFAULT 'manual',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_djen_kanban_movimentos_processo ON djen_kanban_movimentos(processo_chave,id DESC);
  `);
  if (!(db.prepare("SELECT id FROM djen_kanban_listas LIMIT 1").get())) {
    const etapas = [
      "Sem etapa identificada", "Petição inicial", "Emenda inicial", "Perito designado",
      "Perícia agendada", "Perícia realizada", "Laudo / manifestações",
      "Sentença", "Recurso", "Acórdão", "Cumprimento de sentença",
      "Aguardando implantação do benefício", "Cálculos", "Aguardando expedição de RPV",
      "RPV expedida / aguardando pagamento", "Concluído",
    ];
    const inserir = db.prepare("INSERT OR IGNORE INTO djen_kanban_listas(nome,posicao,contar_dias) VALUES (?,?,?)");
    db.transaction(() => etapas.forEach((nome, posicao) => inserir.run(nome, posicao, nome === "Aguardando expedição de RPV" ? 1 : 0)))();
  }
  const colunasListas = db.prepare("PRAGMA table_info(djen_kanban_listas)").all() as { name: string }[];
  if (!colunasListas.some((c) => c.name === "codigo")) db.exec("ALTER TABLE djen_kanban_listas ADD COLUMN codigo TEXT");
  if (!colunasListas.some((c) => c.name === "regra_categoria")) db.exec("ALTER TABLE djen_kanban_listas ADD COLUMN regra_categoria TEXT");
  db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_djen_kanban_listas_codigo ON djen_kanban_listas(codigo)");
  const codigos = [
    "triagem", "peticao_inicial", "emenda_inicial", "perito_designado", "pericia_agendada",
    "pericia_realizada", "laudo_manifestacoes", "sentenca", "recurso", "acordao",
    "cumprimento_sentenca", "aguarda_implantacao", "calculos", "aguarda_expedicao_rpv",
    "rpv_expedida", "concluido",
  ];
  // Os 16 primeiros IDs são as etapas criadas na instalação inicial; renomes não alteram sua identidade.
  db.transaction(() => codigos.forEach((codigo, indice) =>
    db.prepare("UPDATE djen_kanban_listas SET codigo=? WHERE id=? AND codigo IS NULL").run(codigo, indice + 1)))();
  if (!db.prepare("SELECT id FROM djen_kanban_listas WHERE codigo='distribuicao'").get()) db.transaction(() => {
    const existente = db.prepare("SELECT id FROM djen_kanban_listas WHERE nome='Distribuição' COLLATE NOCASE AND codigo IS NULL").get() as { id: number } | undefined;
    if (existente) {
      db.prepare("UPDATE djen_kanban_listas SET codigo='distribuicao',regra_categoria=NULL WHERE id=?").run(existente.id);
    } else {
      db.prepare("UPDATE djen_kanban_listas SET posicao=posicao+1 WHERE posicao>=2").run();
      db.prepare("INSERT INTO djen_kanban_listas(nome,posicao,codigo) VALUES ('Distribuição',2,'distribuicao')").run();
    }
  })();
  // 2.56.0: etapas adicionais para reduzir a triagem. Idempotente; renomes e ordem escolhidos pelo
  // usuário são preservados (só se cria a lista ausente, ou adota uma lista de mesmo nome sem código).
  const novasEtapas: { codigo: string; nome: string; depois: string; contar: number }[] = [
    { codigo: "aguarda_juizo", nome: "Aguardando juízo", depois: "triagem", contar: 1 },
    { codigo: "sobrestado", nome: "Sobrestado / suspenso", depois: "aguarda_juizo", contar: 0 },
    { codigo: "aguarda_terceiros", nome: "Aguardando outra parte / terceiros", depois: "sobrestado", contar: 1 },
    { codigo: "prov_escritorio", nome: "Providência do escritório", depois: "aguarda_terceiros", contar: 1 },
    { codigo: "citacao_contestacao", nome: "Citação / contestação", depois: "emenda_inicial", contar: 0 },
    { codigo: "audiencia", nome: "Audiência", depois: "citacao_contestacao", contar: 0 },
    { codigo: "conclusos_sentenca", nome: "Conclusos para sentença", depois: "laudo_manifestacoes", contar: 0 },
    { codigo: "proposta_acordo", nome: "Proposta de acordo", depois: "laudo_manifestacoes", contar: 0 },
    { codigo: "transito_julgado", nome: "Trânsito em julgado", depois: "acordao", contar: 0 },
  ];
  // 2.57.0: a lista "Acordo (proposta / homologação)" da 2.56.0 vira "Proposta de acordo", logo após
  // o laudo (o INSS ou a parte contrária propõe e o escritório precisa se manifestar). A homologação
  // passa a pertencer à etapa Sentença. Preserva o nome se o usuário já o tiver alterado.
  db.transaction(() => {
    const antiga = db.prepare("SELECT id,posicao,nome FROM djen_kanban_listas WHERE codigo='acordo'").get() as { id: number; posicao: number; nome: string } | undefined;
    if (!antiga) return;
    if (db.prepare("SELECT id FROM djen_kanban_listas WHERE codigo='proposta_acordo'").get()) return;
    const laudo = db.prepare("SELECT posicao FROM djen_kanban_listas WHERE codigo='laudo_manifestacoes'").get() as { posicao: number } | undefined;
    if (laudo && laudo.posicao < antiga.posicao) {
      db.prepare("UPDATE djen_kanban_listas SET posicao=posicao+1 WHERE posicao>? AND posicao<?").run(laudo.posicao, antiga.posicao);
      db.prepare("UPDATE djen_kanban_listas SET posicao=? WHERE id=?").run(laudo.posicao + 1, antiga.id);
    }
    const nomeNovo = antiga.nome === "Acordo (proposta / homologação)" && !db.prepare("SELECT id FROM djen_kanban_listas WHERE nome='Proposta de acordo' COLLATE NOCASE AND id<>?").get(antiga.id) ? "Proposta de acordo" : antiga.nome;
    db.prepare("UPDATE djen_kanban_listas SET codigo='proposta_acordo',nome=? WHERE id=?").run(nomeNovo, antiga.id);
  })();
  db.transaction(() => {
    for (const etapa of novasEtapas) {
      if (db.prepare("SELECT id FROM djen_kanban_listas WHERE codigo=?").get(etapa.codigo)) continue;
      const homonima = db.prepare("SELECT id FROM djen_kanban_listas WHERE nome=? COLLATE NOCASE AND codigo IS NULL").get(etapa.nome) as { id: number } | undefined;
      if (homonima) { db.prepare("UPDATE djen_kanban_listas SET codigo=?,regra_categoria=NULL WHERE id=?").run(etapa.codigo, homonima.id); continue; }
      const ancora = db.prepare("SELECT posicao FROM djen_kanban_listas WHERE codigo=?").get(etapa.depois) as { posicao: number } | undefined;
      const posicao = ancora ? ancora.posicao + 1 : (db.prepare("SELECT COALESCE(MAX(posicao),-1)+1 AS n FROM djen_kanban_listas").get() as { n: number }).n;
      if (ancora) db.prepare("UPDATE djen_kanban_listas SET posicao=posicao+1 WHERE posicao>=?").run(posicao);
      db.prepare("INSERT INTO djen_kanban_listas(nome,posicao,codigo,contar_dias) VALUES (?,?,?,?)").run(etapa.nome, posicao, etapa.codigo, etapa.contar);
    }
  })();
  db.prepare("UPDATE OR IGNORE djen_kanban_listas SET nome='Sem etapa identificada' WHERE codigo='triagem' AND nome='A classificar'").run();
  const colunasCartoes = db.prepare("PRAGMA table_info(djen_kanban_cartoes)").all() as { name: string }[];
  if (!colunasCartoes.some((c) => c.name === "modo")) {
    db.exec("ALTER TABLE djen_kanban_cartoes ADD COLUMN modo TEXT NOT NULL DEFAULT 'automatico' CHECK(modo IN ('automatico','manual'))");
    // Etapas movidas na versão anterior ficam manuais; nenhuma escolha existente é sobrescrita.
    db.exec(`UPDATE djen_kanban_cartoes SET modo='manual'
      WHERE lista_id<>(SELECT MIN(id) FROM djen_kanban_listas)
         OR EXISTS(SELECT 1 FROM djen_kanban_movimentos m WHERE m.processo_chave=djen_kanban_cartoes.processo_chave)`);
  }
  if (!colunasCartoes.some((c) => c.name === "etapa_publicacao_id")) db.exec("ALTER TABLE djen_kanban_cartoes ADD COLUMN etapa_publicacao_id INTEGER");
  if (!colunasCartoes.some((c) => c.name === "etapa_evidencia")) db.exec("ALTER TABLE djen_kanban_cartoes ADD COLUMN etapa_evidencia TEXT");
  if (!colunasCartoes.some((c) => c.name === "revisar_etapa")) db.exec("ALTER TABLE djen_kanban_cartoes ADD COLUMN revisar_etapa INTEGER NOT NULL DEFAULT 1");
  if (!colunasCartoes.some((c) => c.name === "sugestao_codigo")) db.exec("ALTER TABLE djen_kanban_cartoes ADD COLUMN sugestao_codigo TEXT");
  if (!colunasCartoes.some((c) => c.name === "sugestao_publicacao_id")) db.exec("ALTER TABLE djen_kanban_cartoes ADD COLUMN sugestao_publicacao_id INTEGER");
  if (!colunasCartoes.some((c) => c.name === "sugestao_evidencia")) db.exec("ALTER TABLE djen_kanban_cartoes ADD COLUMN sugestao_evidencia TEXT");
  const colunasMovimentos = db.prepare("PRAGMA table_info(djen_kanban_movimentos)").all() as { name: string }[];
  if (!colunasMovimentos.some((c) => c.name === "origem_movimento")) db.exec("ALTER TABLE djen_kanban_movimentos ADD COLUMN origem_movimento TEXT NOT NULL DEFAULT 'manual'");
  db.exec("DROP TRIGGER IF EXISTS djen_kanban_publicacao_atualizada");
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS djen_kanban_publicacao_inserida AFTER INSERT ON djen_publicacoes
    BEGIN UPDATE djen_kanban_cartoes SET revisar_etapa=1 WHERE processo_chave=NEW.processo_chave; END;
    CREATE TRIGGER IF NOT EXISTS djen_kanban_publicacao_atualizada
      AFTER UPDATE OF texto,ia_json,categorias_json,evidencias_json,cancelada,data_disponibilizacao,processo_chave ON djen_publicacoes
    BEGIN
      UPDATE djen_kanban_cartoes SET revisar_etapa=1 WHERE processo_chave=NEW.processo_chave;
      UPDATE djen_kanban_cartoes SET revisar_etapa=1 WHERE processo_chave=OLD.processo_chave;
    END;
    CREATE TRIGGER IF NOT EXISTS djen_kanban_publicacao_excluida AFTER DELETE ON djen_publicacoes
    BEGIN UPDATE djen_kanban_cartoes SET revisar_etapa=1 WHERE processo_chave=OLD.processo_chave; END;
    CREATE TABLE IF NOT EXISTS djen_kanban_meta (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
  `);
  // Reavalia o histórico após mudanças no classificador, preservando escolhas manuais.
  const versaoQuadro = db.prepare("SELECT valor FROM djen_kanban_meta WHERE chave='classificador'").get() as { valor: string } | undefined;
  if (versaoQuadro?.valor !== "2.58.0") db.transaction(() => {
    db.exec("UPDATE djen_kanban_cartoes SET revisar_etapa=1");
    db.prepare("INSERT INTO djen_kanban_meta(chave,valor) VALUES ('classificador','2.58.0') ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor").run();
  })();
  // Metadados de origem da análise. Preserva o JSON e as revisões já existentes.
  const publicationAiColumns = db.prepare("PRAGMA table_info(djen_publicacoes)").all() as { name: string }[];
  for (const name of ["ia_provedor", "ia_modelo", "ia_configuracao"]) {
    if (!publicationAiColumns.some((c) => c.name === name)) db.exec(`ALTER TABLE djen_publicacoes ADD COLUMN ${name} TEXT`);
  }
  db.prepare("UPDATE djen_publicacoes SET ia_provedor='codex' WHERE ia_provedor IS NULL AND ia_json IS NOT NULL").run();
  const executionAiColumns = db.prepare("PRAGMA table_info(djen_codex_execucoes)").all() as { name: string }[];
  if (!executionAiColumns.some((c) => c.name === "provedor")) db.exec("ALTER TABLE djen_codex_execucoes ADD COLUMN provedor TEXT NOT NULL DEFAULT 'codex'");
  // Reconcilia análises antigas somente quando o próprio texto comprova o fato.
  // Revisões humanas e registros sem análise permanecem intactos.
  const candidatos = db.prepare(
    "SELECT id,texto,ia_json FROM djen_publicacoes WHERE revisada=0 AND cancelada=0 AND categorias_json='[]' AND ia_json IS NOT NULL",
  ).all() as { id: number; texto: string; ia_json: string }[];
  const atualizar = db.prepare(
    "UPDATE djen_publicacoes SET categorias_json=?,evidencias_json=?,ia_json=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND revisada=0 AND categorias_json='[]'",
  );
  db.transaction(() => {
    for (const row of candidatos) {
      try {
        const analise = JSON.parse(row.ia_json) as AnaliseCodex;
        if (!Array.isArray(analise.categorias) || !Array.isArray(analise.evidencias) || typeof analise.resumo !== "string") continue;
        const refinada = refinarCategoriasDaAnalise(analise, row.texto);
        if (!refinada.categorias.length) continue;
        atualizar.run(
          JSON.stringify(refinada.categorias),
          JSON.stringify(refinada.evidencias),
          JSON.stringify({ ...analise, ...refinada }),
          row.id,
        );
      } catch {
        // Uma análise legada incompleta nunca bloqueia a abertura do banco.
      }
    }
  })();
  // 2.55.0: acompanhamento de ofícios a terceiros. O CHECK antigo não aceita o novo tipo;
  // a tabela é recriada preservando todas as linhas.
  const obrigacoesSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='djen_acompanhamentos_obrigacoes'").get() as { sql: string } | undefined)?.sql || "";
  if (obrigacoesSql && !obrigacoesSql.includes("terceiro_oficio")) db.transaction(() => {
    db.exec(`ALTER TABLE djen_acompanhamentos_obrigacoes RENAME TO djen_acompanhamentos_obrigacoes_antiga;
      CREATE TABLE djen_acompanhamentos_obrigacoes (
        publicacao_id INTEGER NOT NULL REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
        tipo TEXT NOT NULL CHECK(tipo IN ('perito_laudo','perito_esclarecimentos','perito_calculos','inss_implantacao','parte_contraria','terceiro_oficio')),
        status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','cobrado','resolvido')),
        ultima_cobranca_em TEXT,
        PRIMARY KEY(publicacao_id,tipo)
      );
      INSERT INTO djen_acompanhamentos_obrigacoes(publicacao_id,tipo,status,ultima_cobranca_em)
        SELECT publicacao_id,tipo,status,ultima_cobranca_em FROM djen_acompanhamentos_obrigacoes_antiga;
      DROP TABLE djen_acompanhamentos_obrigacoes_antiga;`);
  })();
  // 2.55.0: baixa manual de prazos do escritório conferidos nos autos.
  db.exec(`CREATE TABLE IF NOT EXISTS djen_prazos_escritorio_estado (
    publicacao_id INTEGER PRIMARY KEY REFERENCES djen_publicacoes(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'pendente' CHECK(status IN ('pendente','resolvido')),
    cumprido_em TEXT, observacoes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // 2.54.0: classificação complementar local (sem custo de IA) para publicações ainda em
  // "Outros". Só adiciona categorias comprovadas por trecho literal; revisões humanas e
  // publicações que já têm categoria permanecem intactas. Executa uma única vez.
  const complementarFeito = db.prepare("SELECT valor FROM djen_kanban_meta WHERE chave='classificacao_complementar'").get() as { valor: string } | undefined;
  if (complementarFeito?.valor !== "2.54.0") {
    const pendentes = db.prepare(
      "SELECT id,texto,classe,ia_json FROM djen_publicacoes WHERE revisada=0 AND cancelada=0 AND categorias_json='[]'",
    ).all() as { id: number; texto: string; classe: string | null; ia_json: string | null }[];
    const gravar = db.prepare("UPDATE djen_publicacoes SET categorias_json=?,evidencias_json=?,ia_json=COALESCE(?,ia_json),updated_at=CURRENT_TIMESTAMP WHERE id=? AND revisada=0 AND categorias_json='[]'");
    db.transaction(() => {
      for (const row of pendentes) {
        try {
          const c = classificarComplementar(row.texto, { classe: row.classe || "" });
          if (!c.categorias.length) continue;
          let iaAtualizada: string | null = null;
          if (row.ia_json) {
            const analise = JSON.parse(row.ia_json) as AnaliseCodex;
            if (Array.isArray(analise.categorias) && Array.isArray(analise.evidencias))
              iaAtualizada = JSON.stringify({ ...analise, categorias: c.categorias, evidencias: c.evidencias });
          }
          gravar.run(JSON.stringify(c.categorias), JSON.stringify(c.evidencias), iaAtualizada, row.id);
        } catch {
          // Um registro legado inválido nunca bloqueia a abertura do banco.
        }
      }
      db.prepare("INSERT INTO djen_kanban_meta(chave,valor) VALUES ('classificacao_complementar','2.54.0') ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor").run();
    })();
  }
}



