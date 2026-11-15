import { db } from "../../db";
import { pessoasDeQuemHerda } from "./vinculos";
import { hojeSaoPaulo } from "../djen/cache";
import { listarPrazosEscritorio } from "../djen/prazosEscritorio";
import { ErroGestao } from "./erro";
import { normalizePhone } from "../../utils/phone";

const somarDias = (dia: string, n: number) => new Date(Date.parse(`${dia}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

interface Pericia { id: number; tipo: string; nome: string; data: string; horario: string | null; local: string | null; profissional_perito: string | null; processo: string | null; processo_chave: string; ultimo_lembrete_em: string | null; passada: boolean }
const colunasPericia = "id,tipo,nome,data,horario,local,profissional_perito,processo,processo_chave,ultimo_lembrete_em";
const comPassada = (rows: Omit<Pericia, "passada">[], hoje: string): Pericia[] => rows.map((r) => ({ ...r, passada: r.data < hoje }));

/** O que o DJEN e a agenda de perícias sabem sobre este processo, sem sair da ficha. */
export function andamentoDoProcesso(id: number) {
  const p = db.prepare("SELECT chave,djen_chave,numero FROM gestao_processos WHERE id=?").get(id) as { chave: string; djen_chave: string | null; numero: string } | undefined;
  if (!p) throw new ErroGestao("Processo não encontrado.", 404);
  const hoje = hojeSaoPaulo();
  const chaves = [...new Set([p.chave, p.djen_chave].filter((c): c is string => Boolean(c)))];
  const marcas = chaves.map(() => "?").join(",");
  const monitorado = chaves.some((c) => db.prepare("SELECT 1 FROM djen_processos WHERE chave=?").get(c));
  const quadro = db.prepare(`SELECT k.nome AS lista, c.modo, c.etapa_evidencia, c.entrou_em FROM djen_kanban_cartoes c JOIN djen_kanban_listas k ON k.id=c.lista_id WHERE c.processo_chave IN (${marcas}) LIMIT 1`).get(...chaves) as { lista: string; modo: string; etapa_evidencia: string | null; entrou_em: string } | undefined;
  const publicacoes = db.prepare(`SELECT id,data_disponibilizacao,tipo_documento,orgao,lida,substr(texto,1,320) AS resumo FROM djen_publicacoes WHERE processo_chave IN (${marcas}) AND cancelada=0 ORDER BY data_disponibilizacao DESC,id DESC LIMIT 5`).all(...chaves);
  const naoLidas = (db.prepare(`SELECT COUNT(*) n FROM djen_publicacoes WHERE processo_chave IN (${marcas}) AND cancelada=0 AND lida=0`).get(...chaves) as { n: number }).n;
  const prazos = db.prepare(`SELECT dp.id,dp.descricao,dp.termino,dp.status FROM djen_prazos dp JOIN djen_publicacoes pub ON pub.id=dp.publicacao_id WHERE pub.processo_chave IN (${marcas}) AND dp.status='aberto' ORDER BY dp.termino IS NULL, dp.termino LIMIT 10`).all(...chaves);
  const pericias = comPassada(db.prepare(`SELECT ${colunasPericia} FROM pericias_agendadas WHERE status='ativa' AND processo_chave IN (${marcas}) ORDER BY data_hora_ms DESC LIMIT 10`).all(...chaves) as Omit<Pericia, "passada">[], hoje);
  return {
    monitorado, quadro: quadro ?? null, publicacoes_nao_lidas: naoLidas,
    ultimas_publicacoes: publicacoes, prazos_abertos: prazos, pericias,
    proxima_pericia: pericias.filter((x) => !x.passada).sort((a, b) => a.data.localeCompare(b.data))[0] ?? null,
  };
}

/** Processos do cliente por DOIS caminhos: o vínculo do cadastro (partes) e o vínculo do Acompanhamento (DJEN → contato do cliente). */
export function processosDaPessoa(pessoaId: number): number[] {
  const ids = new Set<number>();
  // Os próprios + os de quem ela herda/representa («Ciclano é herdeiro de Fulano»: Ciclano acompanha o caso de Fulano).
  const donos = [pessoaId, ...pessoasDeQuemHerda(pessoaId)];
  for (const r of db.prepare(`SELECT processo_id AS id FROM gestao_partes WHERE pessoa_id IN (${donos.map(() => "?").join(",")})`).all(...donos) as { id: number }[]) ids.add(r.id);
  const contatos = db.prepare(`SELECT contact_id AS id FROM gestao_pessoas WHERE id=? AND contact_id IS NOT NULL UNION SELECT id FROM contacts WHERE pessoa_id=?`).all(pessoaId, pessoaId) as { id: number }[];
  if (contatos.length) {
    const marcas = contatos.map(() => "?").join(",");
    for (const r of db.prepare(`SELECT pr.id FROM gestao_processos pr JOIN djen_processos d ON d.chave=pr.chave OR d.chave=pr.djen_chave WHERE d.cliente_id IN (${marcas})`).all(...contatos.map((c) => c.id)) as { id: number }[]) ids.add(r.id);
  }
  return [...ids];
}

/** Perícias/audiências do cliente (pelos processos dele ou pelo telefone) e suas tarefas abertas. */
export function agendaDaPessoa(pessoaId: number) {
  const p = db.prepare("SELECT telefone,telefone2 FROM gestao_pessoas WHERE id=?").get(pessoaId) as { telefone: string; telefone2: string } | undefined;
  if (!p) throw new ErroGestao("Pessoa não encontrada.", 404);
  const hoje = hojeSaoPaulo();
  const idsProc = processosDaPessoa(pessoaId);
  const chaves = ((idsProc.length ? db.prepare(`SELECT DISTINCT chave,djen_chave FROM gestao_processos WHERE id IN (${idsProc.map(() => "?").join(",")})`).all(...idsProc) : []) as { chave: string; djen_chave: string | null }[]).flatMap((r) => [r.chave, r.djen_chave]).filter((c): c is string => Boolean(c));
  const fones = [...new Set([p.telefone, p.telefone2].map((t) => normalizePhone(t)).filter((t) => t.length >= 8))];
  const onde: string[] = []; const par: unknown[] = [];
  if (chaves.length) { onde.push(`processo_chave IN (${chaves.map(() => "?").join(",")})`); par.push(...chaves); }
  if (fones.length) { onde.push(`telefone_digits IN (${fones.map(() => "?").join(",")})`); par.push(...fones); }
  const pericias = onde.length ? comPassada(db.prepare(`SELECT ${colunasPericia} FROM pericias_agendadas WHERE status='ativa' AND (${onde.join(" OR ")}) ORDER BY data_hora_ms DESC LIMIT 30`).all(...par) as Omit<Pericia, "passada">[], hoje) : [];
  const tarefas = db.prepare(`SELECT t.id,t.titulo,t.prazo,t.prazo_fatal,t.status,pr.pasta AS processo_pasta FROM gestao_tarefas t LEFT JOIN gestao_processos pr ON pr.id=t.processo_id
    WHERE t.status IN ('pendente','em_andamento') AND (t.pessoa_id=? OR t.processo_id IN (SELECT processo_id FROM gestao_partes WHERE pessoa_id=?)) ORDER BY t.prazo IS NULL,t.prazo LIMIT 30`).all(pessoaId, pessoaId);
  return { pericias, tarefas };
}

/** Blocos do Meu painel vindos do DJEN e das perícias: tudo no mesmo lugar, com atalho para a tela de origem. */
export function resumoDjenPericias() {
  const hoje = hojeSaoPaulo();
  const n = (sql: string, ...p: unknown[]) => (db.prepare(sql).get(...p) as { v: number }).v;
  let prazos: ReturnType<typeof listarPrazosEscritorio> = [];
  try { prazos = listarPrazosEscritorio(); } catch { /* DJEN ainda sem dados */ }
  const proximas = db.prepare(`SELECT ${colunasPericia} FROM pericias_agendadas WHERE status='ativa' AND data>=? AND data<=? ORDER BY data_hora_ms LIMIT 6`).all(hoje, somarDias(hoje, 7)) as Omit<Pericia, "passada">[];
  return {
    publicacoes_nao_lidas: n("SELECT COUNT(*) v FROM djen_publicacoes WHERE cancelada=0 AND lida=0"),
    pericias_proximas: comPassada(proximas, hoje),
    pericias_proximas_total: n("SELECT COUNT(*) v FROM pericias_agendadas WHERE status='ativa' AND data>=? AND data<=?", hoje, somarDias(hoje, 7)),
    prazos_escritorio: { total: prazos.length, vencidos: prazos.filter((x) => x.urgencia === "vencido").length, lista: prazos.slice(0, 5).map((x) => ({ publicacao_id: x.publicacao_id, processo: x.processo, cliente_nome: x.cliente_nome, descricao: x.descricao, termino: x.termino, urgencia: x.urgencia })) },
  };
}
