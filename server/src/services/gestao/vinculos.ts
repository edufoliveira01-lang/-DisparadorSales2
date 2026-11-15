import { db } from "../../db";
import { hojeSaoPaulo } from "../djen/cache";
import { ErroGestao } from "./erro";

/**
 * Vínculos entre clientes («Ciclano é herdeiro de Fulano») e a perícia ADMINISTRATIVA (INSS).
 * O vínculo é dito sempre do ponto de vista de quem aparece primeiro: A → B. Cada ficha mostra o lado dela (direto ou inverso).
 */
export const TIPOS_DE_VINCULO = {
  herdeiro: { direto: "Herdeiro(a) de", inverso: "Herdeiro(a):", herda: true },
  representante: { direto: "Representante legal de", inverso: "Representado(a) por", herda: true },
  conjuge: { direto: "Cônjuge de", inverso: "Cônjuge de", herda: false },
  familiar: { direto: "Familiar de", inverso: "Familiar de", herda: false },
  outro: { direto: "Vinculado(a) a", inverso: "Vinculado(a) a", herda: false },
} as const;
export type TipoDeVinculo = keyof typeof TIPOS_DE_VINCULO;
const tipoValido = (t: unknown): t is TipoDeVinculo => typeof t === "string" && t in TIPOS_DE_VINCULO;

export interface VinculoDaPessoa {
  id: number; tipo: TipoDeVinculo; direcao: "direto" | "inverso"; rotulo: string; observacao: string;
  outra_id: number; outra_nome: string; processos_da_outra: number; herda_processos: boolean;
}

export function vinculosDaPessoa(pessoaId: number): VinculoDaPessoa[] {
  const linhas = db.prepare(`SELECT v.id,v.tipo,v.observacao,v.pessoa_id,v.relacionada_id,
      (SELECT nome FROM gestao_pessoas WHERE id=CASE WHEN v.pessoa_id=? THEN v.relacionada_id ELSE v.pessoa_id END) AS outra_nome
    FROM gestao_pessoa_vinculos v WHERE v.pessoa_id=? OR v.relacionada_id=? ORDER BY v.id`).all(pessoaId, pessoaId, pessoaId) as { id: number; tipo: TipoDeVinculo; observacao: string; pessoa_id: number; relacionada_id: number; outra_nome: string }[];
  return linhas.map((l) => {
    const direto = l.pessoa_id === pessoaId;
    const outra = direto ? l.relacionada_id : l.pessoa_id;
    const t = TIPOS_DE_VINCULO[l.tipo];
    const n = (db.prepare("SELECT COUNT(DISTINCT processo_id) n FROM gestao_partes WHERE pessoa_id=?").get(outra) as { n: number }).n;
    return { id: l.id, tipo: l.tipo, direcao: direto ? "direto" : "inverso", rotulo: direto ? t.direto : t.inverso, observacao: l.observacao, outra_id: outra, outra_nome: l.outra_nome, processos_da_outra: n, herda_processos: direto && t.herda };
  });
}

/** Pessoas cujos processos esta pessoa acompanha por herança/representação (só o lado «direto»: o herdeiro vê o caso do falecido, não o contrário). */
export function pessoasDeQuemHerda(pessoaId: number): number[] {
  const tipos = Object.entries(TIPOS_DE_VINCULO).filter(([, v]) => v.herda).map(([k]) => k);
  return (db.prepare(`SELECT relacionada_id AS id FROM gestao_pessoa_vinculos WHERE pessoa_id=? AND tipo IN (${tipos.map(() => "?").join(",")})`).all(pessoaId, ...tipos) as { id: number }[]).map((r) => r.id);
}

export function criarVinculo(pessoaId: number, d: { relacionada_id?: unknown; tipo?: unknown; observacao?: unknown }, quem?: { id: number }) {
  const outra = Number(d.relacionada_id);
  if (!Number.isSafeInteger(outra) || outra <= 0) throw new ErroGestao("Escolha o cliente a vincular.", 400);
  if (outra === pessoaId) throw new ErroGestao("Não dá para vincular o cadastro a ele mesmo.", 400);
  if (!tipoValido(d.tipo)) throw new ErroGestao("Escolha o tipo do vínculo.", 400);
  for (const p of [pessoaId, outra]) if (!db.prepare("SELECT 1 FROM gestao_pessoas WHERE id=?").get(p)) throw new ErroGestao("Cadastro não encontrado.", 404);
  const repetido = db.prepare("SELECT 1 FROM gestao_pessoa_vinculos WHERE tipo=? AND ((pessoa_id=? AND relacionada_id=?) OR (pessoa_id=? AND relacionada_id=? AND ? IN ('conjuge','familiar','outro')))").get(d.tipo, pessoaId, outra, outra, pessoaId, d.tipo);
  if (repetido) throw new ErroGestao("Esses cadastros já estão vinculados desse jeito.", 409);
  db.prepare("INSERT INTO gestao_pessoa_vinculos(pessoa_id,relacionada_id,tipo,observacao,criado_por) VALUES (?,?,?,?,?)").run(pessoaId, outra, d.tipo, String(d.observacao ?? "").trim().slice(0, 500), quem?.id ?? null);
  return vinculosDaPessoa(pessoaId);
}

export function removerVinculo(pessoaId: number, vinculoId: number) {
  const r = db.prepare("DELETE FROM gestao_pessoa_vinculos WHERE id=? AND (pessoa_id=? OR relacionada_id=?)").run(vinculoId, pessoaId, pessoaId);
  if (!r.changes) throw new ErroGestao("Vínculo não encontrado.", 404);
  return vinculosDaPessoa(pessoaId);
}

// ---------- perícia administrativa (INSS) ----------
export const TIPOS_PERICIA_INSS = { medica: "Perícia médica", social: "Avaliação social", reabilitacao: "Reabilitação profissional", outra: "Outra (INSS)" } as const;
export const STATUS_PERICIA_INSS = { agendada: "Agendada", realizada: "Realizada", remarcada: "Remarcada", faltou: "Não compareceu", cancelada: "Cancelada" } as const;
export const RESULTADOS_PERICIA_INSS = { "": "Aguardando", favoravel: "Favorável", desfavoravel: "Desfavorável" } as const;
export interface PericiaInss {
  id: number; pessoa_id: number; tipo: string; data: string; horario: string; agencia: string; protocolo: string; beneficio: string;
  status: string; resultado: string; observacoes: string; pessoa_nome?: string; passada?: boolean;
}
const COLUNAS = "p.id,p.pessoa_id,p.tipo,p.data,p.horario,p.agencia,p.protocolo,p.beneficio,p.status,p.resultado,p.observacoes";

function normalizar(d: Record<string, unknown>, atual?: PericiaInss) {
  const txt = (k: string, max: number, ant = "") => (d[k] === undefined ? ant : String(d[k] ?? "").trim().slice(0, max));
  const tipo = d.tipo === undefined ? atual?.tipo ?? "medica" : String(d.tipo);
  if (!(tipo in TIPOS_PERICIA_INSS)) throw new ErroGestao("Tipo de perícia inválido.", 400);
  const status = d.status === undefined ? atual?.status ?? "agendada" : String(d.status);
  if (!(status in STATUS_PERICIA_INSS)) throw new ErroGestao("Situação inválida.", 400);
  const resultado = d.resultado === undefined ? atual?.resultado ?? "" : String(d.resultado);
  if (!(resultado in RESULTADOS_PERICIA_INSS)) throw new ErroGestao("Resultado inválido.", 400);
  const data = txt("data", 10, atual?.data);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new ErroGestao("Informe a data da perícia.", 400);
  const horario = txt("horario", 5, atual?.horario);
  if (horario && !/^\d{2}:\d{2}$/.test(horario)) throw new ErroGestao("Horário inválido (use HH:MM).", 400);
  return { tipo, status, resultado, data, horario, agencia: txt("agencia", 160, atual?.agencia), protocolo: txt("protocolo", 40, atual?.protocolo), beneficio: txt("beneficio", 120, atual?.beneficio), observacoes: txt("observacoes", 2000, atual?.observacoes) };
}

const comPassada = (l: PericiaInss[]) => { const h = hojeSaoPaulo(); return l.map((x) => ({ ...x, passada: x.data < h })); };

export function periciasInssDaPessoa(pessoaId: number): PericiaInss[] {
  return comPassada(db.prepare(`SELECT ${COLUNAS} FROM gestao_pericias_inss p WHERE p.pessoa_id=? ORDER BY p.data DESC,p.horario DESC`).all(pessoaId) as PericiaInss[]);
}

/** A lista geral (aba «Perícia INSS» da Agenda): por padrão, as que ainda vão acontecer. */
export function listarPericiasInss(f: { situacao?: string; dias?: number } = {}): PericiaInss[] {
  const h = hojeSaoPaulo();
  const onde: string[] = []; const par: unknown[] = [];
  if (f.situacao === "todas") { /* sem filtro */ } else { onde.push("p.status IN ('agendada','remarcada') AND p.data>=?"); par.push(h); }
  if (f.dias && f.dias > 0) { onde.push("p.data<=?"); par.push(new Date(Date.parse(`${h}T12:00:00Z`) + f.dias * 86_400_000).toISOString().slice(0, 10)); }
  return comPassada(db.prepare(`SELECT ${COLUNAS},pe.nome AS pessoa_nome FROM gestao_pericias_inss p JOIN gestao_pessoas pe ON pe.id=p.pessoa_id ${onde.length ? `WHERE ${onde.join(" AND ")}` : ""} ORDER BY p.data,p.horario LIMIT 300`).all(...par) as PericiaInss[]);
}

export function criarPericiaInss(pessoaId: number, d: Record<string, unknown>, quem?: { id: number }) {
  if (!db.prepare("SELECT 1 FROM gestao_pessoas WHERE id=?").get(pessoaId)) throw new ErroGestao("Cadastro não encontrado.", 404);
  const n = normalizar(d);
  db.prepare("INSERT INTO gestao_pericias_inss(pessoa_id,tipo,data,horario,agencia,protocolo,beneficio,status,resultado,observacoes,criado_por) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(pessoaId, n.tipo, n.data, n.horario, n.agencia, n.protocolo, n.beneficio, n.status, n.resultado, n.observacoes, quem?.id ?? null);
  return periciasInssDaPessoa(pessoaId);
}

export function atualizarPericiaInss(pessoaId: number, id: number, d: Record<string, unknown>) {
  const atual = db.prepare(`SELECT ${COLUNAS} FROM gestao_pericias_inss p WHERE p.id=? AND p.pessoa_id=?`).get(id, pessoaId) as PericiaInss | undefined;
  if (!atual) throw new ErroGestao("Perícia não encontrada.", 404);
  const n = normalizar(d, atual);
  db.prepare("UPDATE gestao_pericias_inss SET tipo=?,data=?,horario=?,agencia=?,protocolo=?,beneficio=?,status=?,resultado=?,observacoes=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?")
    .run(n.tipo, n.data, n.horario, n.agencia, n.protocolo, n.beneficio, n.status, n.resultado, n.observacoes, id);
  return periciasInssDaPessoa(pessoaId);
}

export function excluirPericiaInss(pessoaId: number, id: number) {
  if (!db.prepare("DELETE FROM gestao_pericias_inss WHERE id=? AND pessoa_id=?").run(id, pessoaId).changes) throw new ErroGestao("Perícia não encontrada.", 404);
  return periciasInssDaPessoa(pessoaId);
}
