import express from "express";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { assinarRequisicao, chaveSso, emitirTokenSso } from "../src/atendimento/assinatura";
import { bancoSupabase, type BancoAtendimento } from "../src/atendimento/banco";
import { chaveDeIdempotencia } from "../src/atendimento/ponteLocal";
import { criarRotaPonte, lerConfigPonteInterna } from "../src/atendimento/rotaPonte";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!";
const ATOR = "11111111-1111-4111-8111-111111111111";
const ORG = "22222222-2222-4222-8222-222222222222";
const DONO = "33333333-3333-4333-8333-333333333333";
const URL_DESK = "https://atendimento.exemplo.com.br";
let agora = 1_800_000_000;

/** Banco falso: guarda as chamadas e devolve o que cada teste configurar. */
function falso() {
  const c = { rpc: [] as [string, any][], criarUsuario: [] as string[], gerarLink: [] as string[] };
  const e = { orgs: {} as Record<string, any>, usuarioExiste: false, membros: new Set<string>(), rpcErro: {} as Record<string, any>, vinculos: [] as { id: string; user_id: string; role: string; revoked_at: string | null }[], emails: {} as Record<string, string>, atualizacoes: [] as any[] };
  const db: BancoAtendimento = {
    async rpc(nome, args: any) {
      c.rpc.push([nome, args]);
      if (e.rpcErro[nome]) return { data: null, error: e.rpcErro[nome] };
      if (nome === "fn_create_tenant_with_owner") { const r = args.p_request; e.orgs[r.slug] = { id: ORG, slug: r.slug, status: "active", display_name: r.display_name }; return { data: { id: ORG, slug: r.slug, created: true }, error: null }; }
      if (nome === "fn_accept_team_invite") { e.membros.add(`${args.p_org}:${args.p_user}`); return { data: { ok: true }, error: null }; }
      if (nome === "fn_suspender_organizacao") { for (const o of Object.values<any>(e.orgs)) if (o.id === args.p_org) o.status = "suspended"; return { data: { changed: true }, error: null }; }
      if (nome === "fn_reativar_organizacao") { for (const o of Object.values<any>(e.orgs)) if (o.id === args.p_org) o.status = "active"; return { data: { changed: true }, error: null }; }
      return { data: null, error: { code: "x" } };
    },
    async uma(tabela, _col, f) {
      if (tabela === "organizations") return { data: e.orgs[f.slug] ?? null, error: null };
      return { data: e.membros.has(`${f.organization_id}:${f.user_id}`) ? { user_id: f.user_id } : null, error: null };
    },
    async lista(tabela, _col, f) {
      if (tabela !== "user_organizations") return { data: [], error: null };
      return { data: e.vinculos.filter((v) => f.revoked_at !== "is.null" || v.revoked_at === null).map(({ id, user_id, role }) => ({ id, user_id, role })), error: null };
    },
    async atualizar(tabela, f, valores) {
      e.atualizacoes.push([tabela, f, valores]);
      const alvo = e.vinculos.find((v) => `eq.${v.id}` === f.id && v.revoked_at === null);
      if (alvo) alvo.revoked_at = String(valores.revoked_at);
      return { count: alvo ? 1 : 0, error: null };
    },
    async emailDoUsuario(id) { return { email: e.emails[id] ?? null, error: null }; },
    async criarUsuario(email) { c.criarUsuario.push(email); return e.usuarioExiste ? { id: null, error: { code: "email_exists", status: 422, message: "exists" } } : { id: DONO, error: null }; },
    async gerarLink(email) { c.gerarLink.push(email); return { userId: DONO, tokenHash: "hash-de-teste", error: null }; },
  };
  return { db, c, e };
}

const abertos: Array<() => Promise<void>> = [];
afterEach(async () => { while (abertos.length) await abertos.pop()!(); });
async function subir(db: BancoAtendimento) {
  const app = express();
  // o painel real tem estes cabeçalhos/leitor de JSON; a rota precisa funcionar apesar deles
  app.use((_q, r, n) => { r.setHeader("Content-Security-Policy", "default-src 'self'; form-action 'self'"); n(); });
  app.use("/ponte", criarRotaPonte(db, { supabaseUrl: "https://x.supabase.co", chaveServico: "k", atorId: ATOR, urlDeskcomm: URL_DESK, segredo: SEGREDO }, () => agora));
  app.use(express.json());
  const srv = await new Promise<import("node:http").Server>((r) => { const s = app.listen(0, "127.0.0.1", () => r(s)); });
  abertos.push(() => new Promise<void>((r) => srv.close(() => r())));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}/ponte`;
  const req = async (m: string, caminho: string, corpo?: unknown, ts = agora, segredo = SEGREDO) => {
    const txt = corpo === undefined ? "" : JSON.stringify(corpo);
    const r = await fetch(base + caminho, { method: m, headers: { "Content-Type": "application/json", "X-Sales-Timestamp": String(ts), "X-Sales-Signature": assinarRequisicao(segredo, { metodo: m, caminho, corpo: txt }, ts) }, body: txt || undefined });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  return { base, req };
}

describe("ponte embutida no painel", () => {
  it("recusa chamada sem assinatura válida e responde /health", async () => {
    const { base, req } = await subir(falso().db);
    expect((await fetch(`${base}/v1/offices`, { method: "POST", body: "{}" })).status).toBe(401);
    expect((await req("POST", "/v1/offices", { slug: "alfa" }, agora, "segredo-errado-segredo-errado-segredo-errado")).status).toBe(401);
    expect((await req("POST", "/v1/offices", { slug: "alfa" }, agora - 1000)).status).toBe(401);
    expect((await fetch(`${base}/health`)).status).toBe(200);
  });

  it("provisiona a empresa, cria o administrador e o vincula; usuário já existente é reaproveitado", async () => {
    const f = falso(); const { req } = await subir(f.db);
    const r = await req("POST", "/v1/offices", { slug: "alfa", display_name: "Alfa Advocacia", owner_email: "  Dono@Alfa.com.br ", plan: "pro" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ org_id: ORG, slug: "alfa", created: true, owner_user_id: DONO });
    expect(f.c.rpc[0][0]).toBe("fn_create_tenant_with_owner");
    expect(f.c.rpc[0][1]).toMatchObject({ p_actor: ATOR, p_key: chaveDeIdempotencia("alfa"), p_request: { slug: "alfa", owner_email: "dono@alfa.com.br", plan: "pro" } });
    expect(f.c.criarUsuario).toEqual(["dono@alfa.com.br"]);
    expect(f.c.rpc[1]).toMatchObject([ "fn_accept_team_invite", { p_user: DONO, p_org: ORG, p_role: "admin" } ]);
    f.e.usuarioExiste = true;
    expect((await req("POST", "/v1/offices", { slug: "beta", display_name: "Beta", owner_email: "x@beta.com" })).json.owner_user_id).toBe(DONO);
    expect(f.c.gerarLink.length).toBe(1);
    expect((await req("POST", "/v1/offices", { slug: "Ruim Slug", display_name: "X", owner_email: "x@y.com" })).status).toBe(400);
    expect((await req("POST", "/v1/offices", { slug: "ok-slug", display_name: "Ok", owner_email: "sem-arroba" })).status).toBe(400);
    f.e.rpcErro.fn_create_tenant_with_owner = { code: "23505" };
    expect((await req("POST", "/v1/offices", { slug: "alfa", display_name: "Alfa", owner_email: "a@b.com" })).status).toBe(409);
    f.e.rpcErro.fn_create_tenant_with_owner = { code: "42501" };
    expect((await req("POST", "/v1/offices", { slug: "alfa", display_name: "Alfa", owner_email: "a@b.com" })).json.codigo).toBe("ator_sem_permissao");
  });

  it("consulta, suspende e reativa; empresa inexistente dá 404", async () => {
    const f = falso(); const { req } = await subir(f.db);
    expect((await req("GET", "/v1/offices/alfa")).status).toBe(404);
    await req("POST", "/v1/offices", { slug: "alfa", display_name: "Alfa", owner_email: "a@b.com" });
    expect((await req("GET", "/v1/offices/alfa")).json).toMatchObject({ status: "active", org_id: ORG });
    expect((await req("POST", "/v1/offices/alfa/suspend", { reason: "falta de pagamento" })).status).toBe(200);
    expect((await req("GET", "/v1/offices/alfa")).json.status).toBe("suspended");
    expect(f.c.rpc.find(([n]) => n === "fn_suspender_organizacao")![1]).toMatchObject({ p_org: ORG, p_kind: "administrativa", p_motivo: "falta de pagamento", p_ator: ATOR });
    expect((await req("POST", "/v1/offices/alfa/suspend", { reason: "x" })).status).toBe(200);
    expect(f.c.rpc.filter(([n]) => n === "fn_suspender_organizacao")[1][1].p_motivo.length).toBeGreaterThanOrEqual(10);
    expect((await req("POST", "/v1/offices/alfa/reactivate")).status).toBe(200);
    expect((await req("GET", "/v1/offices/alfa")).json.status).toBe("active");
  });

  it("entrada direta: só com token válido, uma vez, para membro de empresa ativa; a página envia ao DeskcommCRM", async () => {
    const f = falso(); const { base } = await subir(f.db);
    f.e.orgs.alfa = { id: ORG, slug: "alfa", status: "active", display_name: "Alfa" };
    const token = (slug = "alfa", email = "dono@alfa.com.br", em = agora) => emitirTokenSso(chaveSso(SEGREDO, slug), { slug, email }, em);
    expect((await fetch(`${base}/sso?t=${token()}`)).status).toBe(403); // sem vínculo
    f.e.membros.add(`${ORG}:${DONO}`);
    const ok = await fetch(`${base}/sso?t=${token()}`);
    expect(ok.status).toBe(200);
    const html = await ok.text();
    expect(html).toContain(`action="${URL_DESK}/auth/confirm"`);
    expect(html).toContain('name="token_hash" value="hash-de-teste"');
    expect(html).toContain('name="type" value="magiclink"');
    expect(ok.headers.get("content-security-policy")).toContain("form-action *"); // sobrescreve a política do painel
    const t = token(); expect((await fetch(`${base}/sso?t=${t}`)).status).toBe(200); expect((await fetch(`${base}/sso?t=${t}`)).status).toBe(400); // uso único
    expect((await fetch(`${base}/sso?t=${emitirTokenSso(chaveSso(SEGREDO, "beta"), { slug: "alfa", email: "x@y.com" }, agora)}`)).status).toBe(400); // forjado
    expect((await fetch(`${base}/sso?t=${token("alfa", "dono@alfa.com.br", agora - 120)}`)).status).toBe(400); // expirado
    f.e.orgs.alfa.status = "suspended";
    expect((await fetch(`${base}/sso?t=${token()}`)).status).toBe(403); // suspensa
  });
});

describe("equipe da empresa no atendimento", () => {
  it("vincula cada pessoa com o papel pedido (agent se vier inválido) e relata falhas sem parar as demais", async () => {
    const f = falso(); const { req } = await subir(f.db);
    await req("POST", "/v1/offices", { slug: "alfa", display_name: "Alfa", owner_email: "dono@alfa.com.br" });
    f.c.rpc.length = 0;
    const r = await req("POST", "/v1/offices/alfa/members", { members: [
      { email: " Ana@Alfa.com.br ", name: "Ana", role: "manager" }, { email: "bia@alfa.com.br", role: "superuser" }, { email: "sem-arroba" }, { email: "cris@alfa.com.br", role: "viewer" },
    ] });
    expect(r.status).toBe(200);
    expect(r.json.resultados).toEqual([
      { email: "ana@alfa.com.br", ok: true, role: "manager" }, { email: "bia@alfa.com.br", ok: true, role: "agent" },
      { email: "sem-arroba", ok: false, erro: "E-mail inválido." }, { email: "cris@alfa.com.br", ok: true, role: "viewer" },
    ]);
    expect(f.c.rpc.map(([n, a]) => [n, a.p_role])).toEqual([["fn_accept_team_invite", "manager"], ["fn_accept_team_invite", "agent"], ["fn_accept_team_invite", "viewer"]]);
    f.e.rpcErro.fn_accept_team_invite = { code: "42501" };
    expect((await req("POST", "/v1/offices/alfa/members", { members: [{ email: "x@alfa.com.br" }] })).json.resultados[0]).toMatchObject({ ok: false });
  });
  it("revoga o acesso de quem saiu, mantém o último administrador e trata quem já estava fora", async () => {
    const f = falso(); const { req } = await subir(f.db);
    await req("POST", "/v1/offices", { slug: "alfa", display_name: "Alfa", owner_email: "dono@alfa.com.br" });
    f.e.vinculos.push({ id: "v1", user_id: "u1", role: "admin", revoked_at: null }, { id: "v2", user_id: "u2", role: "agent", revoked_at: null }, { id: "v3", user_id: "u3", role: "agent", revoked_at: "2026-01-01" });
    f.e.emails = { u1: "Dono@Alfa.com.br", u2: "ana@alfa.com.br", u3: "velho@alfa.com.br" };
    const r = await req("POST", "/v1/offices/alfa/members", { remove: ["ANA@alfa.com.br", "dono@alfa.com.br", "velho@alfa.com.br", "nunca@alfa.com.br", "sem-arroba"] });
    expect(r.status).toBe(200);
    expect(r.json.removidos).toEqual([
      { email: "ana@alfa.com.br", ok: true, removido: true },
      { email: "dono@alfa.com.br", ok: false, erro: "É o último administrador da empresa; o acesso foi mantido." },
      { email: "velho@alfa.com.br", ok: true, removido: false },
      { email: "nunca@alfa.com.br", ok: true, removido: false },
      { email: "sem-arroba", ok: false, erro: "E-mail inválido." },
    ]);
    expect(f.e.atualizacoes.length).toBe(1);
    expect(f.e.atualizacoes[0][1]).toEqual({ id: "eq.v2", revoked_at: "is.null" });
    expect(f.e.vinculos.find((v) => v.id === "v2")!.revoked_at).not.toBeNull();
    expect(f.e.vinculos.find((v) => v.id === "v1")!.revoked_at).toBeNull();
    // adicionar e remover na mesma chamada: o administrador novo entra antes da saída do antigo
    const mista = await req("POST", "/v1/offices/alfa/members", { members: [{ email: "nova@alfa.com.br", role: "admin" }], remove: ["inexistente@alfa.com.br"] });
    expect(mista.json.resultados[0]).toMatchObject({ email: "nova@alfa.com.br", ok: true });
    expect(mista.json.removidos[0]).toMatchObject({ email: "inexistente@alfa.com.br", ok: true });
  });
  it("valida a lista e a empresa", async () => {
    const f = falso(); const { req } = await subir(f.db);
    expect((await req("POST", "/v1/offices/naoexiste/members", { members: [{ email: "a@b.com" }] })).status).toBe(404);
    await req("POST", "/v1/offices", { slug: "alfa", display_name: "Alfa", owner_email: "dono@alfa.com.br" });
    expect((await req("POST", "/v1/offices/alfa/members", { members: [] })).status).toBe(400);
    expect((await req("POST", "/v1/offices/alfa/members", {})).status).toBe(400);
  });
});

describe("acesso ao Supabase por fetch", () => {
  it("chama as rotas certas com a chave de serviço e interpreta as respostas", async () => {
    const chamadas: { url: string; init: any }[] = [];
    const resp = (json: unknown, status = 200) => new Response(JSON.stringify(json), { status, headers: { "Content-Type": "application/json" } });
    const http = (async (url: string, init: any) => {
      chamadas.push({ url, init });
      if (url.includes("/rpc/fn_ok")) return resp({ id: "o1" });
      if (url.includes("/rpc/fn_erro")) return resp({ code: "23505", message: "duplicado" }, 409);
      if (init.method === "PATCH") return resp([{ id: "v2" }]);
      if (url.includes("/auth/v1/admin/users/u2")) return resp({ id: "u2", email: "ana@alfa.com.br" });
      if (url.includes("/rest/v1/user_organizations?select=id%2Cuser_id")) return resp([{ id: "v2", user_id: "u2", role: "agent" }]);
      if (url.includes("/rest/v1/organizations")) return resp([{ id: "o1", status: "active" }]);
      if (url.includes("/rest/v1/user_organizations")) return resp([]);
      if (url.includes("/auth/v1/admin/users")) return resp({ error_code: "email_exists", msg: "já existe" }, 422);
      if (url.includes("/generate_link")) return resp({ id: DONO, hashed_token: "abc", action_link: "x" });
      return resp({}, 404);
    }) as unknown as typeof fetch;
    const db = bancoSupabase("https://p.supabase.co/", "CHAVE", http);
    expect(await db.rpc("fn_ok", { a: 1 })).toEqual({ data: { id: "o1" }, error: null });
    expect((await db.rpc("fn_erro", {})).error).toMatchObject({ code: "23505", status: 409 });
    expect((await db.uma("organizations", "id,status", { slug: "alfa" })).data).toEqual({ id: "o1", status: "active" });
    expect((await db.uma("user_organizations", "user_id", { user_id: "u" })).data).toBeNull();
    expect((await db.criarUsuario("a@b.com")).error).toMatchObject({ code: "email_exists", status: 422 });
    expect(await db.gerarLink("a@b.com")).toEqual({ userId: DONO, tokenHash: "abc", error: null });
    expect((await db.lista("user_organizations", "id,user_id,role", { organization_id: "eq.o1", revoked_at: "is.null" })).data).toEqual([{ id: "v2", user_id: "u2", role: "agent" }]);
    expect(await db.emailDoUsuario("u2")).toEqual({ email: "ana@alfa.com.br", error: null });
    expect(await db.atualizar("user_organizations", { id: "eq.v2", revoked_at: "is.null" }, { revoked_at: "x" })).toEqual({ count: 1, error: null });
    const patch = chamadas.find((c) => c.init.method === "PATCH")!;
    expect(patch.url).toBe("https://p.supabase.co/rest/v1/user_organizations?id=eq.v2&revoked_at=is.null");
    expect(patch.init.headers.Prefer).toBe("return=representation");
    expect(chamadas[0].url).toBe("https://p.supabase.co/rest/v1/rpc/fn_ok");
    expect(chamadas[0].init.headers).toMatchObject({ apikey: "CHAVE", Authorization: "Bearer CHAVE" });
    expect(chamadas[2].url).toBe("https://p.supabase.co/rest/v1/organizations?select=id%2Cstatus&limit=1&slug=eq.alfa");
  });
  it("lê as variáveis do painel e rejeita configuração incompleta ou insegura", () => {
    expect(lerConfigPonteInterna({})).toBeNull();
    const ok = { ATENDIMENTO_SUPABASE_URL: "https://p.supabase.co", ATENDIMENTO_SUPABASE_CHAVE: "k", ATENDIMENTO_ATOR_ID: ATOR, ATENDIMENTO_URL: URL_DESK + "/", ATENDIMENTO_SEGREDO: SEGREDO };
    expect(lerConfigPonteInterna(ok)).toMatchObject({ urlDeskcomm: URL_DESK, atorId: ATOR });
    expect(() => lerConfigPonteInterna({ ...ok, ATENDIMENTO_ATOR_ID: "nao-e-uuid" })).toThrow(/UUID/);
    expect(() => lerConfigPonteInterna({ ...ok, ATENDIMENTO_URL: "http://x" })).toThrow(/https/);
    expect(() => lerConfigPonteInterna({ ...ok, ATENDIMENTO_SEGREDO: "curto" })).toThrow(/32/);
  });
});

describe("configuração do painel com a ponte embutida", () => {
  it("usa os endereços do próprio painel quando não há ATENDIMENTO_PONTE_URL", async () => {
    const { lerConfigPainel } = await import("../src/painel/config");
    const cfg = lerConfigPainel({ PAINEL_PORT: "3340", PAINEL_PUBLIC_URL: "https://painel.exemplo.com.br", ATENDIMENTO_SUPABASE_URL: "https://p.supabase.co", ATENDIMENTO_SEGREDO: SEGREDO, ATENDIMENTO_URL: URL_DESK } as never);
    expect(cfg.atendimento).toMatchObject({ url: "http://127.0.0.1:3340/ponte", urlNavegador: "https://painel.exemplo.com.br/ponte", urlPublica: URL_DESK });
  });
});
