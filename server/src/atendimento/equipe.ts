import { db } from "../db";
import type { Role } from "../services/accessService";

/** Papéis do sistema → papéis do atendimento (DeskcommCRM: viewer, agent, manager, admin). */
export const PAPEL_NO_ATENDIMENTO: Record<Role, "admin" | "manager" | "agent" | "viewer"> = {
  administrador: "admin", gestor: "manager", advogado: "agent", atendimento: "agent", consulta: "viewer",
};

export interface MembroAtendimento { email: string; name: string; role: "admin" | "manager" | "agent" | "viewer" }
export interface RelatorioEquipe { enviados: number; ok: number; resultados: { email: string; ok: boolean; role?: string; erro?: string }[]; semEmail: string[] }

/** Pessoas ativas com e-mail (o e-mail é a chave de entrada no atendimento); as sem e-mail são devolvidas para o aviso. */
export function equipeParaAtendimento(): { membros: MembroAtendimento[]; semEmail: string[] } {
  const linhas = db.prepare("SELECT username, display_name, email, role FROM users WHERE active=1 ORDER BY id").all() as { username: string; display_name: string | null; email: string | null; role: Role }[];
  const membros: MembroAtendimento[] = []; const semEmail: string[] = []; const vistos = new Set<string>();
  for (const u of linhas) {
    const email = (u.email || "").trim().toLowerCase();
    if (!email) { semEmail.push(u.display_name || u.username); continue; }
    if (vistos.has(email)) continue;
    vistos.add(email);
    membros.push({ email, name: u.display_name || u.username, role: PAPEL_NO_ATENDIMENTO[u.role] ?? "agent" });
  }
  return { membros, semEmail };
}

export class ErroEquipe extends Error { constructor(m: string, public status = 502) { super(m); } }

/** Envia a equipe ao painel (que valida a licença e repassa à ponte). Só para escritórios licenciados. */
export async function sincronizarEquipe(env: NodeJS.ProcessEnv = process.env, http: typeof fetch = fetch): Promise<RelatorioEquipe> {
  const url = (env.LICENSE_SERVER_URL || "").trim().replace(/\/+$/, ""), chave = (env.LICENSE_KEY || "").trim();
  if (!url || !chave) throw new ErroEquipe("A equipe só é enviada automaticamente em escritórios com licença. Em instalação própria, adicione as pessoas no próprio atendimento.", 409);
  const { membros, semEmail } = equipeParaAtendimento();
  if (!membros.length) throw new ErroEquipe("Nenhuma pessoa ativa tem e-mail cadastrado. Cadastre o e-mail em Equipe e acessos.", 400);
  let r: Response;
  try {
    r = await http(`${url}/api/v1/atendimento/equipe`, { method: "POST", headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" }, body: JSON.stringify({ membros }), signal: AbortSignal.timeout(60_000) });
  } catch (e) { throw new ErroEquipe(`Sem conexão com o painel: ${(e as Error).message}`); }
  const dados = (await r.json().catch(() => ({}))) as { error?: string; resultados?: RelatorioEquipe["resultados"] };
  if (!r.ok) throw new ErroEquipe(dados.error || `O painel respondeu HTTP ${r.status}.`, r.status === 409 || r.status === 401 ? r.status : 502);
  const resultados = dados.resultados ?? [];
  return { enviados: membros.length, ok: resultados.filter((x) => x.ok).length, resultados, semEmail };
}
