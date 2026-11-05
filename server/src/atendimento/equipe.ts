import { db } from "../db";
import type { Role } from "../services/accessService";
import { atendimentoDaInstancia } from "./instancia";

/** Papéis do sistema → papéis do atendimento (DeskcommCRM: viewer, agent, manager, admin). */
export const PAPEL_NO_ATENDIMENTO: Record<Role, "admin" | "manager" | "agent" | "viewer"> = {
  administrador: "admin", gestor: "manager", advogado: "agent", atendimento: "agent", consulta: "viewer",
};

export interface MembroAtendimento { email: string; name: string; role: "admin" | "manager" | "agent" | "viewer" }
export interface RelatorioEquipe {
  enviados: number; ok: number; revogados: number;
  resultados: { email: string; ok: boolean; role?: string; erro?: string }[];
  removidos: { email: string; ok: boolean; erro?: string; removido?: boolean }[];
  semEmail: string[];
}

/** E-mails que deixaram de pertencer a alguém (e-mail trocado) e ainda precisam perder o acesso no atendimento. */
const pendentesDeRemocao = new Set<string>();
export function lembrarEmailAntigo(email: string | null | undefined) { const e = (email || "").trim().toLowerCase(); if (e) pendentesDeRemocao.add(e); }

/**
 * Pessoas ativas com e-mail (a chave de entrada no atendimento) e quem deve perder o acesso:
 * desativadas com e-mail + e-mails antigos pendentes, descontado o que ainda pertence a alguém ativo.
 */
export function equipeParaAtendimento(): { membros: MembroAtendimento[]; remover: string[]; semEmail: string[] } {
  const linhas = db.prepare("SELECT username, display_name, email, role, active FROM users ORDER BY id").all() as { username: string; display_name: string | null; email: string | null; role: Role; active: number }[];
  const membros: MembroAtendimento[] = []; const semEmail: string[] = []; const vistos = new Set<string>(); const inativos = new Set<string>();
  for (const u of linhas) {
    const email = (u.email || "").trim().toLowerCase();
    if (!u.active) { if (email) inativos.add(email); continue; }
    if (!email) { semEmail.push(u.display_name || u.username); continue; }
    if (vistos.has(email)) continue;
    vistos.add(email);
    membros.push({ email, name: u.display_name || u.username, role: PAPEL_NO_ATENDIMENTO[u.role] ?? "agent" });
  }
  const remover = [...new Set([...inativos, ...pendentesDeRemocao])].filter((e) => !vistos.has(e));
  return { membros, remover, semEmail };
}

export class ErroEquipe extends Error { constructor(m: string, public status = 502) { super(m); } }

/** Envia a equipe ao painel (que valida a licença e repassa à ponte). Só para escritórios licenciados. */
export async function sincronizarEquipe(env: NodeJS.ProcessEnv = process.env, http: typeof fetch = fetch): Promise<RelatorioEquipe> {
  const url = (env.LICENSE_SERVER_URL || "").trim().replace(/\/+$/, ""), chave = (env.LICENSE_KEY || "").trim();
  if (!url || !chave) throw new ErroEquipe("A equipe só é enviada automaticamente em escritórios com licença. Em instalação própria, adicione as pessoas no próprio atendimento.", 409);
  const { membros, remover, semEmail } = equipeParaAtendimento();
  if (!membros.length && !remover.length) throw new ErroEquipe("Nenhuma pessoa ativa tem e-mail cadastrado. Cadastre o e-mail em Equipe e acessos.", 400);
  let r: Response;
  try {
    r = await http(`${url}/api/v1/atendimento/equipe`, { method: "POST", headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" }, body: JSON.stringify({ membros, remover }), signal: AbortSignal.timeout(60_000) });
  } catch (e) { throw new ErroEquipe(`Sem conexão com o painel: ${(e as Error).message}`); }
  const dados = (await r.json().catch(() => ({}))) as { error?: string; resultados?: RelatorioEquipe["resultados"]; removidos?: RelatorioEquipe["removidos"] };
  if (!r.ok) throw new ErroEquipe(dados.error || `O painel respondeu HTTP ${r.status}.`, r.status === 409 || r.status === 401 ? r.status : 502);
  const resultados = dados.resultados ?? [], removidos = dados.removidos ?? [];
  for (const x of removidos) if (x.ok) pendentesDeRemocao.delete(x.email); // revogado (ou já estava fora): não precisa repetir
  return { enviados: membros.length, ok: resultados.filter((x) => x.ok).length, revogados: removidos.filter((x) => x.removido).length, resultados, removidos, semEmail };
}

/** Sincroniza em segundo plano, sem nunca derrubar quem chamou. Só age se o atendimento estiver liberado para este escritório. */
export async function sincronizarEquipeSePossivel(): Promise<void> {
  try {
    if (!atendimentoDaInstancia()) return;
    await sincronizarEquipe();
  } catch (e) {
    if (e instanceof ErroEquipe && e.status === 400) return; // ninguém para enviar
    console.warn("[Atendimento] Não foi possível sincronizar a equipe:", (e as Error).message);
  }
}

let agendado: NodeJS.Timeout | null = null;
/** Junta várias alterações seguidas (cadastrar uma equipe inteira) numa só sincronização, alguns segundos depois. */
export function agendarSincronizacaoDaEquipe(atrasoMs = 5_000) {
  if (agendado) clearTimeout(agendado);
  agendado = setTimeout(() => { agendado = null; void sincronizarEquipeSePossivel(); }, atrasoMs);
  agendado.unref();
}

/** Conferência periódica: corrige qualquer diferença (falha de conexão, alteração feita direto no atendimento). */
export function iniciarSincronizacaoPeriodicaDaEquipe(intervaloMs = 6 * 3_600_000) {
  setTimeout(() => void sincronizarEquipeSePossivel(), 2 * 60_000).unref();
  setInterval(() => void sincronizarEquipeSePossivel(), intervaloMs).unref();
}
