import { db } from "../../db";
import { DjenInputError } from "./store";
import { classificarPublicacaoParaQuadro, ETAPAS_AUTOMATICAS, type EtapaAutomatica } from "./kanbanClassifier";

type Lista = { id: number; nome: string; posicao: number; contar_dias: number; codigo: string | null };
type Cartao = {
  processo_chave: string; lista_id: number; posicao: number; entrou_em: string;
  inicio_espera_em: string | null; modo: "automatico" | "manual";
  etapa_publicacao_id: number | null; etapa_evidencia: string | null;
  sugestao_codigo: string | null; sugestao_publicacao_id: number | null; sugestao_evidencia: string | null;
  numero: string; cliente_nome: string | null;
  destinatarios_json: string; publicacao_id: number; data_disponibilizacao: string;
  situacao: string; texto: string; ia_json: string | null; categorias_json: string;
  publicacoes_total: number; prazos_abertos: number; publicacoes_nao_lidas: number;
};
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
const listas = () => db.prepare("SELECT id,nome,posicao,contar_dias,codigo FROM djen_kanban_listas ORDER BY posicao,id").all() as Lista[];
const nomeValido = (nome: unknown) => {
  if (typeof nome !== "string" || nome.trim().length < 2 || nome.trim().length > 70)
    throw new DjenInputError("Informe um nome de lista com 2 a 70 caracteres.");
  return nome.trim();
};

/** Novos processos entram na triagem; a captura do DJEN não substitui decisões da equipe. */
function incluirProcessosNovos() {
  const primeira = db.prepare("SELECT id FROM djen_kanban_listas ORDER BY id LIMIT 1").get() as { id: number } | undefined;
  if (!primeira) throw new DjenInputError("O quadro precisa de pelo menos uma lista.");
  db.prepare(
    `INSERT OR IGNORE INTO djen_kanban_cartoes(processo_chave,lista_id,posicao)
     SELECT pr.chave,?,COALESCE((SELECT MAX(posicao)+1 FROM djen_kanban_cartoes WHERE lista_id=?),0)+ROW_NUMBER() OVER (ORDER BY pr.chave)
       FROM djen_processos pr
      WHERE EXISTS (SELECT 1 FROM djen_publicacoes p WHERE p.processo_chave=pr.chave AND p.cancelada=0)
        AND NOT EXISTS (SELECT 1 FROM djen_kanban_cartoes k WHERE k.processo_chave=pr.chave)`,
  ).run(primeira.id, primeira.id);
}

type Candidato = { codigo: EtapaAutomatica; evidencia: string; publicacao_id: number; data: string };
function sincronizarEtapasAutomaticas(forcarProcesso?: string) {
  const colunas = listas();
  const porCodigo = new Map(colunas.filter((l) => l.codigo).map((l) => [l.codigo, l]));
  const cards = db.prepare(
    `SELECT k.processo_chave,k.lista_id,k.modo,k.etapa_publicacao_id,l.codigo AS codigo_atual,l.nome AS nome_atual
       FROM djen_kanban_cartoes k JOIN djen_kanban_listas l ON l.id=k.lista_id
      WHERE k.revisar_etapa=1`,
  ).all() as { processo_chave: string; lista_id: number; modo: string; etapa_publicacao_id: number | null; codigo_atual: string | null; nome_atual: string }[];
  if (!cards.length) return;
  const rows = db.prepare(
    `SELECT p.processo_chave,p.id,p.texto,p.data_disponibilizacao
       FROM djen_publicacoes p JOIN djen_kanban_cartoes k ON k.processo_chave=p.processo_chave
      WHERE p.cancelada=0 AND k.revisar_etapa=1
      ORDER BY p.processo_chave,p.data_disponibilizacao,p.id`,
  ).all() as { processo_chave: string; id: number; texto: string; data_disponibilizacao: string }[];
  const candidatos = new Map<string, Candidato>();
  const sinaisPorId = new Map<number, EtapaAutomatica>();
  for (const pub of rows) {
    const sinal = classificarPublicacaoParaQuadro(pub.texto);
    if (!sinal) continue;
    sinaisPorId.set(pub.id, sinal.codigo);
    const antigo = candidatos.get(pub.processo_chave);
    if (!antigo || ETAPAS_AUTOMATICAS.indexOf(sinal.codigo) >= ETAPAS_AUTOMATICAS.indexOf(antigo.codigo))
      candidatos.set(pub.processo_chave, { ...sinal, publicacao_id: pub.id, data: pub.data_disponibilizacao });
  }
  const atualizar = db.prepare("UPDATE djen_kanban_cartoes SET lista_id=?,entrou_em=CURRENT_TIMESTAMP,inicio_espera_em=?,etapa_publicacao_id=?,etapa_evidencia=?,updated_at=CURRENT_TIMESTAMP WHERE processo_chave=?");
  const salvarSinal = db.prepare("UPDATE djen_kanban_cartoes SET revisar_etapa=0,sugestao_codigo=?,sugestao_publicacao_id=?,sugestao_evidencia=? WHERE processo_chave=?");
  const atualizarProva = db.prepare("UPDATE djen_kanban_cartoes SET etapa_publicacao_id=?,etapa_evidencia=? WHERE processo_chave=?");
  const historico = db.prepare("INSERT INTO djen_kanban_movimentos(processo_chave,origem,destino,origem_movimento) VALUES (?,?,?,'automatico')");
  db.transaction(() => {
    for (const card of cards) {
      const sinal = candidatos.get(card.processo_chave);
      salvarSinal.run(sinal?.codigo || null, sinal?.publicacao_id || null, sinal?.evidencia || null, card.processo_chave);
      if (card.modo !== "automatico") continue;
      const provaRevogada = card.etapa_publicacao_id !== null && sinaisPorId.get(card.etapa_publicacao_id) !== card.codigo_atual;
      if (!sinal) {
        const triagem = porCodigo.get("triagem");
        if (provaRevogada && triagem && triagem.id !== card.lista_id) {
          atualizar.run(triagem.id, null, null, null, card.processo_chave);
          historico.run(card.processo_chave, card.nome_atual, triagem.nome);
        }
        continue;
      }
      const coluna = porCodigo.get(sinal.codigo);
      if (!coluna) continue;
      const rankAtual = ETAPAS_AUTOMATICAS.indexOf(card.codigo_atual as EtapaAutomatica);
      const rankNovo = ETAPAS_AUTOMATICAS.indexOf(sinal.codigo);
      const mudou = coluna.id !== card.lista_id && (card.processo_chave === forcarProcesso || provaRevogada || rankNovo > rankAtual);
      if (mudou) {
        atualizar.run(coluna.id, coluna.contar_dias ? (sinal.data <= hoje() ? sinal.data : hoje()) : null,
          sinal.publicacao_id, sinal.evidencia, card.processo_chave);
        historico.run(card.processo_chave, card.nome_atual, coluna.nome);
      } else if (coluna.id === card.lista_id && card.etapa_publicacao_id !== sinal.publicacao_id) {
        atualizarProva.run(sinal.publicacao_id, sinal.evidencia, card.processo_chave);
      }
    }
  })();
}

/** Executado após um lote do DJEN; publica o quadro já classificado para a interface. */
export function atualizarKanbanComNovasPublicacoes() {
  incluirProcessosNovos();
  sincronizarEtapasAutomaticas();
}

export function listarKanban() {
  atualizarKanbanComNovasPublicacoes();
  const cards = db.prepare(
    `SELECT k.*,pr.numero,c.nome AS cliente_nome,p.destinatarios_json,p.id AS publicacao_id,
            p.data_disponibilizacao,p.situacao,p.texto,p.ia_json,p.categorias_json,
            (SELECT COUNT(*) FROM djen_publicacoes q WHERE q.processo_chave=k.processo_chave AND q.cancelada=0) AS publicacoes_total,
            (SELECT COUNT(*) FROM djen_publicacoes q WHERE q.processo_chave=k.processo_chave AND q.cancelada=0 AND q.lida=0) AS publicacoes_nao_lidas,
            (SELECT COUNT(*) FROM djen_prazos d JOIN djen_publicacoes q ON q.id=d.publicacao_id
              WHERE q.processo_chave=k.processo_chave AND q.cancelada=0 AND d.status='aberto') AS prazos_abertos
       FROM djen_kanban_cartoes k
       JOIN djen_processos pr ON pr.chave=k.processo_chave
       LEFT JOIN contacts c ON c.id=pr.cliente_id
       JOIN djen_publicacoes p ON p.id=(
         SELECT q.id FROM djen_publicacoes q WHERE q.processo_chave=k.processo_chave AND q.cancelada=0
         ORDER BY q.data_disponibilizacao DESC,q.id DESC LIMIT 1)
      ORDER BY k.lista_id,k.posicao,k.processo_chave`,
  ).all() as Cartao[];
  const colunas = listas();
  const listasPorId = new Map(colunas.map((l) => [l.id, l]));
  const listasPorCodigo = new Map(colunas.filter((l) => l.codigo).map((l) => [l.codigo, l]));
  return {
    listas: colunas,
    cartoes: cards.map((c) => {
      let nome = c.cliente_nome;
      let resumo = c.situacao || c.texto.slice(0, 240);
      let categorias: string[] = [];
      try {
        if (!nome) nome = (JSON.parse(c.destinatarios_json) as { nome?: string }[])[0]?.nome || null;
      } catch { /* Publicação antiga sem destinatários estruturados. */ }
      try {
        const ia = c.ia_json ? JSON.parse(c.ia_json) : null;
        if (typeof ia?.resumo === "string" && ia.resumo.trim()) resumo = ia.resumo;
      } catch { /* Mantém a descrição da publicação. */ }
      try {
        const parsed = JSON.parse(c.categorias_json);
        categorias = Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === "string") : [];
      } catch { /* Nenhuma categoria confiável. */ }
      const { destinatarios_json, ia_json, texto, categorias_json, ...resto } = c;
      const sugestao = c.modo === "manual" && c.sugestao_codigo && c.sugestao_codigo !== listasPorId.get(c.lista_id)?.codigo
        ? { codigo: c.sugestao_codigo, lista_nome: listasPorCodigo.get(c.sugestao_codigo)?.nome || null, evidencia: c.sugestao_evidencia }
        : null;
      return { ...resto, cliente_nome: nome, resumo: resumo.slice(0, 220), categorias, sugestao };
    }),
  };
}

export function criarListaKanban(data: Record<string, unknown>) {
  const nome = nomeValido(data.nome);
  if (listas().length >= 40) throw new DjenInputError("O quadro permite até 40 listas.");
  if (db.prepare("SELECT id FROM djen_kanban_listas WHERE nome=?").get(nome))
    throw new DjenInputError("Já existe uma lista com esse nome.");
  const posicao = (db.prepare("SELECT COALESCE(MAX(posicao),-1)+1 AS n FROM djen_kanban_listas").get() as { n: number }).n;
  const result = db.prepare("INSERT INTO djen_kanban_listas(nome,posicao,contar_dias) VALUES (?,?,?)")
    .run(nome, posicao, data.contar_dias === true ? 1 : 0);
  return db.prepare("SELECT id,nome,posicao,contar_dias FROM djen_kanban_listas WHERE id=?").get(result.lastInsertRowid);
}

export function alterarListaKanban(id: number, data: Record<string, unknown>) {
  const atual = db.prepare("SELECT id,nome,contar_dias FROM djen_kanban_listas WHERE id=?").get(id) as Lista | undefined;
  if (!atual) throw new DjenInputError("Lista não encontrada.");
  const nome = nomeValido(data.nome);
  if (db.prepare("SELECT id FROM djen_kanban_listas WHERE nome=? AND id<>?").get(nome, id))
    throw new DjenInputError("Já existe uma lista com esse nome.");
  const contar = data.contar_dias === true ? 1 : data.contar_dias === false ? 0 : atual.contar_dias;
  db.transaction(() => {
    db.prepare("UPDATE djen_kanban_listas SET nome=?,contar_dias=? WHERE id=?").run(nome, contar, id);
    if (contar && !atual.contar_dias)
      db.prepare("UPDATE djen_kanban_cartoes SET inicio_espera_em=? WHERE lista_id=? AND inicio_espera_em IS NULL").run(hoje(), id);
    if (!contar && atual.contar_dias)
      db.prepare("UPDATE djen_kanban_cartoes SET inicio_espera_em=NULL WHERE lista_id=?").run(id);
  })();
  return db.prepare("SELECT id,nome,posicao,contar_dias FROM djen_kanban_listas WHERE id=?").get(id);
}

export function ordenarListasKanban(ids: unknown) {
  const atuais = listas();
  if (!Array.isArray(ids) || ids.length !== atuais.length ||
      !ids.every((n) => Number.isSafeInteger(n)) || new Set(ids).size !== ids.length ||
      ids.some((n) => !atuais.some((l) => l.id === n)))
    throw new DjenInputError("A ordem das listas mudou. Atualize o quadro e tente novamente.");
  db.transaction(() => ids.forEach((id, i) => db.prepare("UPDATE djen_kanban_listas SET posicao=? WHERE id=?").run(i, id)))();
  return listas();
}

export function excluirListaKanban(id: number) {
  const todas = listas();
  if (!todas.some((l) => l.id === id)) throw new DjenInputError("Lista não encontrada.");
  if (todas.length === 1 || id === Math.min(...todas.map((l) => l.id)))
    throw new DjenInputError("A lista de triagem precisa permanecer no quadro.");
  if (db.prepare("SELECT 1 FROM djen_kanban_cartoes WHERE lista_id=? LIMIT 1").get(id))
    throw new DjenInputError("Mova os cartões antes de excluir esta lista.");
  db.prepare("DELETE FROM djen_kanban_listas WHERE id=?").run(id);
  ordenarListasKanban(listas().map((l) => l.id));
  return { ok: true };
}

export function moverCartaoKanban(processo: string, destino: number, antesDe?: string) {
  incluirProcessosNovos();
  const coluna = db.prepare("SELECT id,nome,contar_dias FROM djen_kanban_listas WHERE id=?").get(destino) as Lista | undefined;
  const atual = db.prepare("SELECT k.lista_id,l.nome AS lista_nome,k.inicio_espera_em FROM djen_kanban_cartoes k JOIN djen_kanban_listas l ON l.id=k.lista_id WHERE k.processo_chave=?")
    .get(processo) as { lista_id: number; lista_nome: string; inicio_espera_em: string | null } | undefined;
  if (!coluna || !atual) throw new DjenInputError("Processo ou lista não encontrado no quadro.");
  const origem = db.prepare("SELECT processo_chave FROM djen_kanban_cartoes WHERE lista_id=? ORDER BY posicao,processo_chave").all(atual.lista_id) as { processo_chave: string }[];
  const destinoAtual = atual.lista_id === destino ? origem : db.prepare("SELECT processo_chave FROM djen_kanban_cartoes WHERE lista_id=? ORDER BY posicao,processo_chave").all(destino) as { processo_chave: string }[];
  const outros = destinoAtual.map((r) => r.processo_chave).filter((chave) => chave !== processo);
  if (antesDe && antesDe !== processo && !outros.includes(antesDe))
    throw new DjenInputError("A posição de destino mudou. Atualize o quadro.");
  outros.splice(antesDe && antesDe !== processo ? outros.indexOf(antesDe) : outros.length, 0, processo);
  const update = db.prepare("UPDATE djen_kanban_cartoes SET lista_id=?,posicao=?,updated_at=CURRENT_TIMESTAMP WHERE processo_chave=?");
  db.transaction(() => {
    if (atual.lista_id !== destino) {
      db.prepare("UPDATE djen_kanban_cartoes SET lista_id=?,entrou_em=CURRENT_TIMESTAMP,inicio_espera_em=?,modo='manual',etapa_publicacao_id=NULL,etapa_evidencia=NULL,updated_at=CURRENT_TIMESTAMP WHERE processo_chave=?")
        .run(destino, coluna.contar_dias ? hoje() : null, processo);
      origem.filter((r) => r.processo_chave !== processo).forEach((r, i) => update.run(atual.lista_id, i, r.processo_chave));
      db.prepare("INSERT INTO djen_kanban_movimentos(processo_chave,origem,destino) VALUES (?,?,?)")
        .run(processo, atual.lista_nome, coluna.nome);
    }
    outros.forEach((chave, i) => update.run(destino, i, chave));
  })();
  return { ok: true };
}

export function ativarClassificacaoAutomatica(processo: string) {
  incluirProcessosNovos();
  const atual = db.prepare("SELECT processo_chave FROM djen_kanban_cartoes WHERE processo_chave=?").get(processo);
  if (!atual) throw new DjenInputError("Processo não encontrado no quadro.");
  db.prepare("UPDATE djen_kanban_cartoes SET modo='automatico',revisar_etapa=1,updated_at=CURRENT_TIMESTAMP WHERE processo_chave=?").run(processo);
  sincronizarEtapasAutomaticas(processo);
  return { ok: true };
}

export function fixarEtapaManual(processo: string) {
  incluirProcessosNovos();
  const result = db.prepare("UPDATE djen_kanban_cartoes SET modo='manual',updated_at=CURRENT_TIMESTAMP WHERE processo_chave=?").run(processo);
  if (!result.changes) throw new DjenInputError("Processo não encontrado no quadro.");
  return { ok: true };
}

export function alterarInicioEsperaKanban(processo: string, data: unknown) {
  if (typeof data !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(data) ||
      Number.isNaN(Date.parse(`${data}T12:00:00Z`)) ||
      new Date(`${data}T12:00:00Z`).toISOString().slice(0, 10) !== data || data > hoje())
    throw new DjenInputError("Informe uma data de início válida, até hoje.");
  const row = db.prepare("SELECT k.processo_chave,l.contar_dias FROM djen_kanban_cartoes k JOIN djen_kanban_listas l ON l.id=k.lista_id WHERE k.processo_chave=?")
    .get(processo) as { processo_chave: string; contar_dias: number } | undefined;
  if (!row || !row.contar_dias) throw new DjenInputError("Este cartão não está em uma lista com contagem de dias.");
  db.prepare("UPDATE djen_kanban_cartoes SET inicio_espera_em=?,updated_at=CURRENT_TIMESTAMP WHERE processo_chave=?").run(data, processo);
  return { ok: true };
}

export function historicoCartaoKanban(processo: string) {
  if (!db.prepare("SELECT chave FROM djen_processos WHERE chave=?").get(processo))
    throw new DjenInputError("Processo não encontrado.");
  return db.prepare("SELECT origem,destino,origem_movimento,created_at FROM djen_kanban_movimentos WHERE processo_chave=? ORDER BY id DESC LIMIT 50").all(processo);
}
