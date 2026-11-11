/**
 * DataJud (base pública do CNJ): traz o que o DJEN não informa — assunto, data de ajuizamento, órgão julgador, classe e o último movimento.
 *
 * Só funciona com a chave pública do CNJ (APIKey), que o escritório cola em Configurações → DataJud. Sem chave, nada é consultado.
 * Nunca troca o que alguém digitou na ficha: só completa o que está em branco.
 */
import { db } from "../../db";
import { getSetting, setSetting } from "../settingsService";
import { tribunalDoCnj } from "../gestao/validacao";

const BASE = "https://api-publica.datajud.cnj.jus.br";
const CHAVE = "datajud_chave";
const CNJ = /^\d{20}$/;
/** Quanto tempo uma consulta vale antes de repetir (movimentos novos aparecem aos poucos). */
export const VALIDADE_DATAJUD_MS = 24 * 60 * 60 * 1000;

db.exec(`CREATE TABLE IF NOT EXISTS gestao_datajud (
  processo_chave TEXT PRIMARY KEY, consultado_em TEXT, status TEXT NOT NULL DEFAULT 'pendente', erro TEXT,
  classe TEXT NOT NULL DEFAULT '', assunto TEXT NOT NULL DEFAULT '', orgao TEXT NOT NULL DEFAULT '', ajuizamento TEXT NOT NULL DEFAULT '',
  grau TEXT NOT NULL DEFAULT '', movimentos INTEGER NOT NULL DEFAULT 0, ultimo_movimento TEXT NOT NULL DEFAULT '', ultimo_movimento_em TEXT NOT NULL DEFAULT ''
)`);

export class ErroDataJud extends Error { constructor(m: string, public status = 502) { super(m); } }

export const chaveDoDataJud = (): string => (getSetting(CHAVE) || process.env.DATAJUD_API_KEY || "").trim();
export function salvarChaveDoDataJud(valor: unknown): void {
  // Aceita a chave pura, "APIKey xxx" ou o cabeçalho inteiro copiado da documentação ("Authorization: APIKey xxx"), com ou sem aspas.
  const v = String(valor ?? "").trim().replace(/^["'`]+|["'`]+$/g, "").replace(/^authorization\s*:\s*/i, "").replace(/^apikey\s+/i, "").trim();
  if (v && !/^[A-Za-z0-9+/=_-]{16,300}$/.test(v)) throw new ErroDataJud("A chave parece inválida. Cole só o texto da chave pública, sem aspas.", 400);
  setSetting(CHAVE, v);
}
export const mascararChave = (c: string) => (c ? `…${c.slice(-4)}` : "");

/** Alias do tribunal na API (api_publica_<alias>): TJSP→tjsp, TRF3→trf3, TRT2→trt2… `null` quando o DataJud não cobre. */
export function aliasDoTribunal(chave: string): string | null {
  const t = tribunalDoCnj(chave)?.toLowerCase() ?? "";
  return /^(tj[a-z]{2}|trf[1-6]|trt\d{1,2}|tre-[a-z]{2}|stj|stm)$/.test(t) ? t : null;
}

export interface DadosDataJud { classe: string; assunto: string; orgao: string; ajuizamento: string; grau: string; movimentos: number; ultimo_movimento: string; ultimo_movimento_em: string }

/** "2025-09-01T00:00:00.000Z" ou "20250901000000" → "2025-09-01". */
export function diaDoDataJud(v: unknown): string {
  const t = String(v ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  if (/^\d{8}/.test(t)) return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
  return "";
}
const nome = (v: unknown) => String((v as { nome?: unknown } | null)?.nome ?? "").trim();

/** Escolhe o registro mais completo (o processo pode aparecer em mais de um grau) e normaliza. */
export function normalizarDataJud(resposta: unknown): DadosDataJud | null {
  const hits = ((resposta as { hits?: { hits?: { _source?: Record<string, unknown> }[] } } | null)?.hits?.hits ?? []).map((h) => h._source).filter((s): s is Record<string, unknown> => Boolean(s));
  if (hits.length === 0) return null;
  const movs = (s: Record<string, unknown>) => (Array.isArray(s.movimentos) ? (s.movimentos as { nome?: unknown; dataHora?: unknown }[]) : []);
  const s = [...hits].sort((a, b) => movs(b).length - movs(a).length)[0]!;
  const todos = hits.flatMap((h) => movs(h)).map((m) => ({ nome: String(m.nome ?? "").trim(), em: String(m.dataHora ?? "") })).filter((m) => m.nome && m.em);
  todos.sort((a, b) => (a.em < b.em ? 1 : a.em > b.em ? -1 : 0));
  const assuntos = (Array.isArray(s.assuntos) ? s.assuntos : []).map(nome).filter(Boolean);
  return {
    classe: nome(s.classe), assunto: [...new Set(assuntos)].slice(0, 3).join("; "), orgao: nome(s.orgaoJulgador),
    ajuizamento: diaDoDataJud(s.dataAjuizamento), grau: String(s.grau ?? ""), movimentos: movs(s).length,
    ultimo_movimento: todos[0]?.nome ?? "", ultimo_movimento_em: todos[0] ? diaDoDataJud(todos[0].em) : "",
  };
}

export async function buscarNoDataJud(chave: string, apiKey: string, http: typeof fetch = fetch): Promise<DadosDataJud | null> {
  const alias = aliasDoTribunal(chave);
  if (!alias) throw new ErroDataJud("O DataJud não cobre o tribunal deste número.", 422);
  let r: Response;
  try {
    r = await http(`${BASE}/api_publica_${alias}/_search`, {
      method: "POST",
      headers: { Authorization: `APIKey ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ size: 5, query: { match: { numeroProcesso: chave } } }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch { throw new ErroDataJud("Não foi possível acessar o DataJud (rede ou demora)."); }
  if (r.status === 401 || r.status === 403) throw new ErroDataJud("O DataJud recusou a chave. Confira, em Configurações → DataJud, se ela é a chave pública vigente do CNJ.", 401);
  if (!r.ok) throw new ErroDataJud(`O DataJud respondeu HTTP ${r.status}.`);
  try { return normalizarDataJud(await r.json()); } catch { throw new ErroDataJud("O DataJud devolveu uma resposta que não consegui ler."); }
}

/** Consulta e grava; completa só os campos em branco da(s) ficha(s). Sem chave configurada, não faz nada. */
export async function atualizarDoDataJud(chave: string, http: typeof fetch = fetch): Promise<"sem_chave" | "ok" | "nao_encontrado" | "falha"> {
  const apiKey = chaveDoDataJud();
  if (!apiKey || !CNJ.test(chave)) return "sem_chave";
  db.prepare("INSERT OR IGNORE INTO gestao_datajud(processo_chave) VALUES (?)").run(chave);
  try {
    const d = await buscarNoDataJud(chave, apiKey, http);
    if (!d) { db.prepare("UPDATE gestao_datajud SET status='nao_encontrado',erro=NULL,consultado_em=CURRENT_TIMESTAMP WHERE processo_chave=?").run(chave); return "nao_encontrado"; }
    db.prepare(`UPDATE gestao_datajud SET status='ok',erro=NULL,consultado_em=CURRENT_TIMESTAMP,classe=?,assunto=?,orgao=?,ajuizamento=?,grau=?,movimentos=?,ultimo_movimento=?,ultimo_movimento_em=? WHERE processo_chave=?`)
      .run(d.classe, d.assunto, d.orgao, d.ajuizamento, d.grau, d.movimentos, d.ultimo_movimento, d.ultimo_movimento_em, chave);
    const fichas = db.prepare("SELECT id,classe,assunto,orgao,data_distribuicao FROM gestao_processos WHERE chave=? OR djen_chave=?").all(chave, chave) as { id: number; classe: string; assunto: string; orgao: string; data_distribuicao: string }[];
    for (const f of fichas) {
      db.prepare("UPDATE gestao_processos SET classe=?,assunto=?,orgao=?,data_distribuicao=?,atualizado_em=CURRENT_TIMESTAMP WHERE id=?")
        .run(f.classe || d.classe, f.assunto || d.assunto, f.orgao || d.orgao, f.data_distribuicao || d.ajuizamento, f.id);
    }
    return "ok";
  } catch (e) {
    db.prepare("UPDATE gestao_datajud SET status='falha',erro=?,consultado_em=CURRENT_TIMESTAMP WHERE processo_chave=?").run(e instanceof Error ? e.message.slice(0, 300) : "Falha ao consultar o DataJud.", chave);
    return "falha";
  }
}

/** A consulta ainda vale? (para não repetir a cada ciclo) */
export function datajudEmDia(chave: string): boolean {
  const r = db.prepare("SELECT status,consultado_em FROM gestao_datajud WHERE processo_chave=?").get(chave) as { status: string; consultado_em: string | null } | undefined;
  if (!r?.consultado_em || r.status === "falha") return false;
  const t = Date.parse(r.consultado_em.replace(" ", "T") + "Z");
  return Number.isFinite(t) && Date.now() - t < VALIDADE_DATAJUD_MS;
}

export function situacaoDoDataJud(chave: string) {
  const r = db.prepare("SELECT status,erro,consultado_em,ultimo_movimento,ultimo_movimento_em,movimentos FROM gestao_datajud WHERE processo_chave=?").get(chave) as
    { status: string; erro: string | null; consultado_em: string | null; ultimo_movimento: string; ultimo_movimento_em: string; movimentos: number } | undefined;
  return { configurado: Boolean(chaveDoDataJud()), ...(r ?? { status: "pendente", erro: null, consultado_em: null, ultimo_movimento: "", ultimo_movimento_em: "", movimentos: 0 }) };
}
