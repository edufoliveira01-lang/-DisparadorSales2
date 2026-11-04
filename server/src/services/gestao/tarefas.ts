import { db } from "../../db";
import { hojeSaoPaulo, limparCachesDjen } from "../djen/cache";
import { ErroGestao } from "./pessoas";
import { resumoDjenPericias } from "./integracao";
import { dataValida } from "./validacao";

export const PRIORIDADES = ["baixa", "normal", "alta", "urgente"] as const;
export const STATUS_TAREFA = ["pendente", "em_andamento", "concluida", "cancelada"] as const;
const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

interface Linha {
  id: number; titulo: string; descricao: string; processo_id: number | null; pessoa_id: number | null; responsavel_user_id: number | null; criado_por: number | null;
  prazo: string | null; prazo_fatal: number; prioridade: string; status: string; concluida_em: string | null; origem: string; djen_prazo_id: number | null; criado_em: string; atualizado_em: string;
}
const SELECT = `SELECT t.*, u.display_name AS resp_nome, u.username AS resp_usuario, pr.numero AS processo_numero, pr.pasta AS processo_pasta, pe.nome AS pessoa_nome
  FROM gestao_tarefas t LEFT JOIN users u ON u.id=t.responsavel_user_id LEFT JOIN gestao_processos pr ON pr.id=t.processo_id LEFT JOIN gestao_pessoas pe ON pe.id=t.pessoa_id`;

function visao(l: Linha & { resp_nome: string | null; resp_usuario: string | null; processo_numero: string | null; processo_pasta: string | null; pessoa_nome: string | null }, hoje: string) {
  const aberta = l.status === "pendente" || l.status === "em_andamento";
  const { resp_nome, resp_usuario, ...resto } = l;
  return { ...resto, responsavel: resp_nome || resp_usuario || null, aberta, atrasada: aberta && !!l.prazo && l.prazo < hoje, prazo_fatal: Boolean(l.prazo_fatal) };
}

function limpar(d: Record<string, unknown>, atual?: Linha) {
  const titulo = txt(d.titulo ?? atual?.titulo, 200);
  if (titulo.length < 3) throw new ErroGestao("Descreva a tarefa (mínimo de 3 letras).");
  const prazo = d.prazo === undefined ? (atual?.prazo ?? "") : txt(d.prazo, 10);
  if (!dataValida(prazo)) throw new ErroGestao("Prazo inválido (use AAAA-MM-DD).");
  const prioridade = String(d.prioridade ?? atual?.prioridade ?? "normal");
  if (!(PRIORIDADES as readonly string[]).includes(prioridade)) throw new ErroGestao("Prioridade inválida.");
  const resp = d.responsavel_user_id === undefined ? (atual?.responsavel_user_id ?? null) : d.responsavel_user_id ? Number(d.responsavel_user_id) : null;
  if (resp !== null && !db.prepare("SELECT id FROM users WHERE id=? AND active=1").get(resp)) throw new ErroGestao("Responsável não encontrado ou inativo.");
  const proc = d.processo_id === undefined ? (atual?.processo_id ?? null) : d.processo_id ? Number(d.processo_id) : null;
  if (proc !== null && !db.prepare("SELECT id FROM gestao_processos WHERE id=?").get(proc)) throw new ErroGestao("Processo não encontrado.");
  const pessoa = d.pessoa_id === undefined ? (atual?.pessoa_id ?? null) : d.pessoa_id ? Number(d.pessoa_id) : null;
  if (pessoa !== null && !db.prepare("SELECT id FROM gestao_pessoas WHERE id=?").get(pessoa)) throw new ErroGestao("Pessoa não encontrada.");
  return { titulo, descricao: txt(d.descricao ?? atual?.descricao, 4000), prazo: prazo || null, prioridade, resp, proc, pessoa,
    fatal: d.prazo_fatal === undefined ? (atual?.prazo_fatal ?? 0) : d.prazo_fatal ? 1 : 0 };
}

export function listarTarefas(f: { responsavel?: string; status?: string; processo?: string; periodo?: string; busca?: string; pagina?: number; limite?: number }, userId: number) {
  const hoje = hojeSaoPaulo();
  const onde: string[] = []; const par: unknown[] = [];
  if (f.responsavel === "eu") { onde.push("t.responsavel_user_id=?"); par.push(userId); }
  else if (f.responsavel === "sem") onde.push("t.responsavel_user_id IS NULL");
  else if (f.responsavel && Number(f.responsavel)) { onde.push("t.responsavel_user_id=?"); par.push(Number(f.responsavel)); }
  const st = f.status ?? "abertas";
  if (st === "abertas") onde.push("t.status IN ('pendente','em_andamento')");
  else if ((STATUS_TAREFA as readonly string[]).includes(st)) { onde.push("t.status=?"); par.push(st); }
  if (f.processo && Number(f.processo)) { onde.push("t.processo_id=?"); par.push(Number(f.processo)); }
  if (f.periodo === "atrasadas") { onde.push("t.status IN ('pendente','em_andamento') AND t.prazo < ?"); par.push(hoje); }
  else if (f.periodo === "hoje") { onde.push("t.prazo = ?"); par.push(hoje); }
  else if (f.periodo === "semana") { onde.push("t.prazo BETWEEN ? AND ?"); par.push(hoje, somarDias(hoje, 7)); }
  const busca = txt(f.busca, 100);
  if (busca) { onde.push("(t.titulo LIKE ? ESCAPE '\\' OR pr.numero LIKE ? OR pe.nome LIKE ? ESCAPE '\\')"); const like = `%${busca.replace(/[\\%_]/g, "\\$&")}%`; par.push(like, like, like); }
  const limite = Math.min(100, Math.max(1, Math.trunc(f.limite || 30)));
  const pagina = Math.max(1, Math.trunc(f.pagina || 1));
  const w = onde.length ? `WHERE ${onde.join(" AND ")}` : "";
  const total = (db.prepare(`SELECT COUNT(*) n FROM gestao_tarefas t LEFT JOIN gestao_processos pr ON pr.id=t.processo_id LEFT JOIN gestao_pessoas pe ON pe.id=t.pessoa_id ${w}`).get(...par) as { n: number }).n;
  const linhas = db.prepare(`${SELECT} ${w} ORDER BY (t.status IN ('concluida','cancelada')), t.prazo IS NULL, t.prazo, CASE t.prioridade WHEN 'urgente' THEN 0 WHEN 'alta' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, t.id DESC LIMIT ? OFFSET ?`)
    .all(...par, limite, (pagina - 1) * limite) as any[];
  return { total, pagina, limite, itens: linhas.map((l) => visao(l, hoje)) };
}

export function obterTarefa(id: number) {
  const l = db.prepare(`${SELECT} WHERE t.id=?`).get(id) as any;
  if (!l) throw new ErroGestao("Tarefa não encontrada.", 404);
  return visao(l, hojeSaoPaulo());
}

export function criarTarefa(d: Record<string, unknown>, userId: number) {
  const v = limpar(d);
  const r = db.prepare("INSERT INTO gestao_tarefas(titulo,descricao,processo_id,pessoa_id,responsavel_user_id,criado_por,prazo,prazo_fatal,prioridade) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(v.titulo, v.descricao, v.proc, v.pessoa, v.resp, userId, v.prazo, v.fatal, v.prioridade);
  return obterTarefa(Number(r.lastInsertRowid));
}
export function atualizarTarefa(id: number, d: Record<string, unknown>) {
  const atual = db.prepare("SELECT * FROM gestao_tarefas WHERE id=?").get(id) as Linha | undefined;
  if (!atual) throw new ErroGestao("Tarefa não encontrada.", 404);
  const v = limpar(d, atual);
  const status = d.status === undefined ? atual.status : String(d.status);
  if (!(STATUS_TAREFA as readonly string[]).includes(status)) throw new ErroGestao("Situação inválida.");
  const concluida = status === "concluida" ? (atual.concluida_em ?? hojeSaoPaulo()) : null;
  db.prepare("UPDATE gestao_tarefas SET titulo=?,descricao=?,processo_id=?,pessoa_id=?,responsavel_user_id=?,prazo=?,prazo_fatal=?,prioridade=?,status=?,concluida_em=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?")
    .run(v.titulo, v.descricao, v.proc, v.pessoa, v.resp, v.prazo, v.fatal, v.prioridade, status, concluida, id);
  espelharNoDjen(id, status);
  return obterTarefa(id);
}
export function concluirTarefa(id: number, concluida: boolean) {
  const atual = db.prepare("SELECT status FROM gestao_tarefas WHERE id=?").get(id) as { status: string } | undefined;
  if (!atual) throw new ErroGestao("Tarefa não encontrada.", 404);
  const status = concluida ? "concluida" : "pendente";
  db.prepare("UPDATE gestao_tarefas SET status=?,concluida_em=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?").run(status, concluida ? hojeSaoPaulo() : null, id);
  espelharNoDjen(id, status);
  return obterTarefa(id);
}
export function excluirTarefa(id: number) {
  obterTarefa(id);
  db.prepare("DELETE FROM gestao_tarefas WHERE id=?").run(id);
  return { ok: true };
}

/** Concluir/reabrir uma tarefa que veio de um prazo do DJEN reflete no prazo original (e vice-versa na sincronização). */
function espelharNoDjen(tarefaId: number, status: string) {
  const t = db.prepare("SELECT djen_prazo_id FROM gestao_tarefas WHERE id=?").get(tarefaId) as { djen_prazo_id: number | null };
  if (!t?.djen_prazo_id) return;
  const alvo = status === "concluida" ? "concluido" : status === "cancelada" ? null : "aberto";
  if (!alvo) return;
  db.prepare("UPDATE djen_prazos SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status<>?").run(alvo, t.djen_prazo_id, alvo);
  limparCachesDjen();
}

/** Prazos do DJEN de processos com ficha viram tarefas (uma vez); prazos concluídos lá concluem a tarefa. */
let ultimaSincronizacao = 0;
export function sincronizarPrazosDjen(forcar = false) {
  if (!forcar && Date.now() - ultimaSincronizacao < 60_000) return { criadas: 0, atualizadas: 0 };
  ultimaSincronizacao = Date.now();
  let criadas = 0, atualizadas = 0;
  db.transaction(() => {
    const novos = db.prepare(`SELECT dp.id,dp.descricao,dp.termino,dp.status,g.id AS processo_id,g.responsavel_user_id
      FROM djen_prazos dp JOIN djen_publicacoes pub ON pub.id=dp.publicacao_id JOIN gestao_processos g ON (g.chave=pub.processo_chave OR g.djen_chave=pub.processo_chave)
      WHERE dp.status='aberto' AND dp.termino IS NOT NULL AND NOT EXISTS (SELECT 1 FROM gestao_tarefas t WHERE t.djen_prazo_id=dp.id)`).all() as { id: number; descricao: string; termino: string; processo_id: number; responsavel_user_id: number | null }[];
    for (const n of novos) {
      db.prepare("INSERT INTO gestao_tarefas(titulo,processo_id,responsavel_user_id,prazo,prazo_fatal,prioridade,origem,djen_prazo_id) VALUES (?,?,?,?,1,'alta','djen',?)")
        .run(txt(n.descricao, 200) || "Prazo do DJEN", n.processo_id, n.responsavel_user_id, n.termino.slice(0, 10), n.id);
      criadas++;
    }
    const mudou = db.prepare(`UPDATE gestao_tarefas SET status='concluida', concluida_em=?, atualizado_em=CURRENT_TIMESTAMP
      WHERE origem='djen' AND status IN ('pendente','em_andamento') AND djen_prazo_id IN (SELECT id FROM djen_prazos WHERE status='concluido')`).run(hojeSaoPaulo());
    atualizadas += mudou.changes;
    const prazos = db.prepare(`UPDATE gestao_tarefas SET prazo=(SELECT substr(termino,1,10) FROM djen_prazos WHERE id=gestao_tarefas.djen_prazo_id)
      WHERE origem='djen' AND status IN ('pendente','em_andamento') AND djen_prazo_id IN (SELECT id FROM djen_prazos WHERE termino IS NOT NULL AND substr(termino,1,10)<>gestao_tarefas.prazo)`).run();
    atualizadas += prazos.changes;
  })();
  return { criadas, atualizadas };
}

export function meuPainel(userId: number) {
  sincronizarPrazosDjen();
  const hoje = hojeSaoPaulo();
  const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { n: number }).n;
  const abertas = "status IN ('pendente','em_andamento')";
  // semana corrente: segunda a domingo
  const dow = (new Date(`${hoje}T12:00:00Z`).getUTCDay() + 6) % 7;
  const segunda = somarDias(hoje, -dow);
  const dias = Array.from({ length: 7 }, (_, i) => somarDias(segunda, i));
  const grafico = dias.map((d) => ({ dia: d,
    atribuidas: n("SELECT COUNT(*) n FROM gestao_tarefas WHERE responsavel_user_id=? AND prazo=?", userId, d),
    concluidas: n("SELECT COUNT(*) n FROM gestao_tarefas WHERE responsavel_user_id=? AND concluida_em=?", userId, d) }));
  const lista = (cond: string, ...p: unknown[]) => (db.prepare(`${SELECT} WHERE t.responsavel_user_id=? AND t.${abertas} AND ${cond} ORDER BY t.prazo, t.id LIMIT 8`).all(userId, ...p) as any[]).map((l) => visao(l, hoje));
  return {
    hoje,
    numeros: {
      atribuidas_semana: grafico.reduce((a, g) => a + g.atribuidas, 0),
      concluidas_semana: grafico.reduce((a, g) => a + g.concluidas, 0),
      atrasadas: n(`SELECT COUNT(*) n FROM gestao_tarefas WHERE responsavel_user_id=? AND ${abertas} AND prazo<?`, userId, hoje),
      prazos_fatais_5_dias: n(`SELECT COUNT(*) n FROM gestao_tarefas WHERE responsavel_user_id=? AND ${abertas} AND prazo_fatal=1 AND prazo BETWEEN ? AND ?`, userId, hoje, somarDias(hoje, 5)),
      sem_responsavel: n(`SELECT COUNT(*) n FROM gestao_tarefas WHERE responsavel_user_id IS NULL AND ${abertas}`),
      processos_sob_responsabilidade: n("SELECT COUNT(*) n FROM gestao_processos WHERE responsavel_user_id=? AND status='ativo'", userId),
    },
    grafico,
    atrasadas: lista("t.prazo<?", hoje),
    hoje_lista: lista("t.prazo=?", hoje),
    proximas: lista("t.prazo>? AND t.prazo<=?", hoje, somarDias(hoje, 7)),
    djen: resumoDjenPericias(),
    mais_atrasadas_no_escritorio: db.prepare(`SELECT titulo, COUNT(*) AS quantidade FROM gestao_tarefas WHERE ${abertas} AND prazo<? GROUP BY titulo ORDER BY quantidade DESC, titulo LIMIT 8`).all(hoje),
  };
}
