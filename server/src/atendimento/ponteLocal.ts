import { createHash } from "node:crypto";
import type { BancoAtendimento } from "./banco";

export class ErroPonte extends Error {
  constructor(message: string, public status = 400, public codigo = "erro") { super(message); }
}
export interface ConfigPonte { atorId: string; urlPublica: string }
export interface PedidoEmpresa { slug: string; display_name: string; owner_email: string; owner_name?: string; plan?: string; cnpj?: string; legal_name?: string }
const SLUG = /^[a-z0-9-]{2,40}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** UUID estável por escritório: repetir o provisionamento devolve a mesma empresa (idempotência do DeskcommCRM). */
export function chaveDeIdempotencia(slug: string): string {
  const h = createHash("sha256").update(`sales-bridge:${slug}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

type Cliente = BancoAtendimento;

async function empresaPorSlug(db: Cliente, slug: string): Promise<{ id: string; status: string; slug: string; display_name: string }> {
  if (!SLUG.test(slug)) throw new ErroPonte("Identificador do escritório inválido.", 400, "slug_invalido");
  const { data, error } = await db.uma("organizations", "id,slug,status,display_name", { slug });
  if (error) throw new ErroPonte("Não foi possível consultar a empresa.", 502, "consulta_falhou");
  if (!data) throw new ErroPonte("Empresa não encontrada no atendimento.", 404, "nao_encontrada");
  return data as { id: string; status: string; slug: string; display_name: string };
}

/** Descobre o usuário (criando se preciso) sem e-mail de convite: a pessoa entra pela entrada direta. */
async function usuarioDoDono(db: Cliente, email: string, nome?: string): Promise<string> {
  const criado = await db.criarUsuario(email, nome);
  if (!criado.error && criado.id) return criado.id;
  const e = criado.error;
  const existe = e && (e.code === "email_exists" || e.status === 422 || /already.*regist|exists/i.test(e.message ?? ""));
  if (!existe) throw new ErroPonte("Não foi possível criar o usuário administrador no atendimento.", 502, "usuario_falhou");
  const link = await db.gerarLink(email);
  if (link.error || !link.userId) throw new ErroPonte("Não foi possível localizar o usuário administrador.", 502, "usuario_falhou");
  return link.userId;
}

export async function provisionarEmpresa(db: Cliente, cfg: ConfigPonte, p: PedidoEmpresa) {
  if (!SLUG.test(p.slug)) throw new ErroPonte("Identificador do escritório inválido.", 400, "slug_invalido");
  if (!p.display_name || p.display_name.length < 2 || p.display_name.length > 120) throw new ErroPonte("Nome do escritório inválido.", 400, "nome_invalido");
  const email = String(p.owner_email || "").trim().toLowerCase();
  if (!EMAIL.test(email)) throw new ErroPonte("E-mail do administrador inválido.", 400, "email_invalido");
  const pedido = { display_name: p.display_name.trim(), slug: p.slug, ...(p.legal_name ? { legal_name: p.legal_name } : {}), ...(p.cnpj ? { cnpj: p.cnpj } : {}), plan: ["standard", "pro", "enterprise"].includes(p.plan || "") ? p.plan : "standard", owner_email: email };
  const { data, error } = await db.rpc("fn_create_tenant_with_owner", { p_actor: cfg.atorId, p_key: chaveDeIdempotencia(p.slug), p_request: pedido, p_hash: createHash("sha256").update(JSON.stringify(pedido)).digest("hex") });
  if (error) {
    if (error.code === "23505" || error.code === "22023") throw new ErroPonte("Já existe uma empresa com este identificador (ou os dados mudaram).", 409, "conflito");
    if (error.code === "42501") throw new ErroPonte("O administrador da plataforma configurado na ponte não tem permissão.", 500, "ator_sem_permissao");
    throw new ErroPonte("Não foi possível criar a empresa no atendimento.", 502, "criar_falhou");
  }
  const org = data as { id: string; slug: string; created: boolean };
  const donoId = await usuarioDoDono(db, email, p.owner_name);
  const vinculo = await db.rpc("fn_accept_team_invite", { p_user: donoId, p_org: org.id, p_role: "admin", p_invited_by: cfg.atorId, p_issued_at: null, p_invited_at: null, p_interface_settings: { preset: "completa" } });
  if (vinculo.error) throw new ErroPonte("A empresa foi criada, mas o administrador não pôde ser vinculado. Repita o provisionamento.", 502, "vinculo_falhou");
  // Padrão do Sales: a área de mensagem fica travada até o atendente assumir a conversa.
  // Só em escritório recém-criado (não sobrescreve escolha de quem já configurou). Falha aqui não derruba o provisionamento.
  if (org.created) {
    try {
      const { data: atual } = await db.uma("organizations", "interface_settings", { id: `eq.${org.id}` });
      const base = (atual && typeof (atual as any).interface_settings === "object" && (atual as any).interface_settings) || {};
      await db.atualizar("organizations", { id: `eq.${org.id}` }, { interface_settings: { ...base, bloquearAteAssumir: true } });
    } catch { /* o administrador pode ligar em Configurações → Empresa → Inbox */ }
  }
  return { org_id: org.id, slug: org.slug, created: Boolean(org.created), owner_user_id: donoId };
}

export async function statusDaEmpresa(db: Cliente, slug: string) {
  const o = await empresaPorSlug(db, slug);
  return { org_id: o.id, slug: o.slug, status: o.status, display_name: o.display_name };
}
export async function suspenderEmpresa(db: Cliente, cfg: ConfigPonte, slug: string, motivo: string) {
  const o = await empresaPorSlug(db, slug);
  const texto = (motivo || "Escritório suspenso no painel de assinaturas").trim().padEnd(10, ".").slice(0, 500);
  const { data, error } = await db.rpc("fn_suspender_organizacao", { p_org: o.id, p_kind: "administrativa", p_motivo: texto, p_ator: cfg.atorId });
  if (error) throw new ErroPonte(error.code === "40001" ? "Outra operação está em andamento. Tente de novo em instantes." : "Não foi possível suspender a empresa.", error.code === "40001" ? 409 : 502, "suspender_falhou");
  return { slug, ...(data as object) };
}
export async function reativarEmpresa(db: Cliente, cfg: ConfigPonte, slug: string) {
  const o = await empresaPorSlug(db, slug);
  const { data, error } = await db.rpc("fn_reativar_organizacao", { p_org: o.id, p_kind_exigido: "administrativa", p_ator: cfg.atorId });
  if (error) throw new ErroPonte(error.code === "40001" ? "Outra operação está em andamento. Tente de novo em instantes." : "Não foi possível reativar a empresa.", error.code === "40001" ? 409 : 502, "reativar_falhou");
  return { slug, ...(data as object) };
}

/** Entrada direta: só entra quem já é membro da empresa. Devolve o código de uso único que o DeskcommCRM troca por sessão. */
export async function prepararEntrada(db: Cliente, slug: string, email: string): Promise<{ token_hash: string; org_status: string }> {
  if (!EMAIL.test(email)) throw new ErroPonte("E-mail inválido.", 400, "email_invalido");
  const org = await empresaPorSlug(db, slug);
  const link = await db.gerarLink(email.trim().toLowerCase());
  if (link.error || !link.userId || !link.tokenHash || !UUID.test(link.userId)) throw new ErroPonte("Esta pessoa não tem acesso ao atendimento.", 403, "sem_acesso");
  const { data: vinculo } = await db.uma("user_organizations", "user_id", { organization_id: org.id, user_id: link.userId });
  if (!vinculo) throw new ErroPonte("Esta pessoa não tem acesso ao atendimento deste escritório.", 403, "sem_acesso");
  return { token_hash: link.tokenHash, org_status: org.status };
}

export interface MembroPedido { email: string; name?: string; role?: string }
export interface ResultadoMembro { email: string; ok: boolean; role?: string; erro?: string; removido?: boolean }
const PAPEIS = ["viewer", "agent", "manager", "admin"];

/** Coloca pessoas na equipe da empresa no atendimento (cria o usuário sem e-mail de convite se preciso). Falha de uma pessoa não impede as demais. */
export async function adicionarMembros(db: Cliente, cfg: ConfigPonte, slug: string, membros: MembroPedido[]): Promise<{ slug: string; org_id: string; resultados: ResultadoMembro[] }> {
  if (!Array.isArray(membros) || membros.length === 0 || membros.length > 100) throw new ErroPonte("Lista de pessoas inválida (de 1 a 100).", 400, "membros_invalidos");
  const org = await empresaPorSlug(db, slug);
  const resultados: ResultadoMembro[] = [];
  for (const m of membros) {
    const email = String(m?.email || "").trim().toLowerCase();
    const papel = PAPEIS.includes(String(m?.role)) ? String(m.role) : "agent";
    if (!EMAIL.test(email)) { resultados.push({ email, ok: false, erro: "E-mail inválido." }); continue; }
    try {
      const id = await usuarioDoDono(db, email, typeof m.name === "string" ? m.name.slice(0, 120) : undefined);
      const v = await db.rpc("fn_accept_team_invite", { p_user: id, p_org: org.id, p_role: papel, p_invited_by: cfg.atorId, p_issued_at: null, p_invited_at: null, p_interface_settings: { preset: "completa" } });
      resultados.push(v.error ? { email, ok: false, erro: "Não foi possível vincular à empresa." } : { email, ok: true, role: papel });
    } catch (e) { resultados.push({ email, ok: false, erro: e instanceof ErroPonte ? e.message : "Falha inesperada." }); }
  }
  return { slug, org_id: org.id, resultados };
}

/**
 * Tira o acesso de pessoas à empresa (marca o vínculo como revogado, como a tela de equipe do próprio DeskcommCRM faz).
 * Nunca revoga o último administrador. Quem já está sem acesso conta como resolvido.
 */
export async function revogarMembros(db: Cliente, _cfg: ConfigPonte, slug: string, emails: string[]): Promise<{ slug: string; resultados: ResultadoMembro[] }> {
  if (!Array.isArray(emails) || emails.length === 0 || emails.length > 100) throw new ErroPonte("Lista de pessoas inválida (de 1 a 100).", 400, "membros_invalidos");
  const org = await empresaPorSlug(db, slug);
  const alvos = [...new Set(emails.map((e) => String(e || "").trim().toLowerCase()))];
  const { data, error } = await db.lista("user_organizations", "id,user_id,role", { organization_id: `eq.${org.id}`, revoked_at: "is.null" });
  if (error) throw new ErroPonte("Não foi possível consultar a equipe da empresa.", 502, "consulta_falhou");
  const ativos = data.map((v) => ({ id: String(v.id), user_id: String(v.user_id), role: String(v.role) }));
  const emailDe = new Map<string, string>();
  for (const a of ativos) { const r = await db.emailDoUsuario(a.user_id); if (r.email) emailDe.set(a.user_id, r.email.trim().toLowerCase()); }
  let admins = ativos.filter((a) => a.role === "admin").length;
  const resultados: ResultadoMembro[] = [];
  for (const email of alvos) {
    if (!EMAIL.test(email)) { resultados.push({ email, ok: false, erro: "E-mail inválido." }); continue; }
    const v = ativos.find((a) => emailDe.get(a.user_id) === email);
    if (!v) { resultados.push({ email, ok: true, removido: false }); continue; } // já estava sem acesso
    if (v.role === "admin" && admins <= 1) { resultados.push({ email, ok: false, erro: "É o último administrador da empresa; o acesso foi mantido." }); continue; }
    const agora = new Date().toISOString();
    const r = await db.atualizar("user_organizations", { id: `eq.${v.id}`, revoked_at: "is.null" }, { revoked_at: agora, updated_at: agora });
    if (r.error) { resultados.push({ email, ok: false, erro: "Não foi possível revogar o acesso." }); continue; }
    if (v.role === "admin") admins--;
    resultados.push({ email, ok: true, removido: true });
  }
  return { slug, resultados };
}
