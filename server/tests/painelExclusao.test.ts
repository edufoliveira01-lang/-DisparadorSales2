import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { abrirBancoPainel } from "../src/painel/banco";
import { lerConfigPainel } from "../src/painel/config";
import type { ProvedorCobranca } from "../src/painel/asaas";
import { ServicoPainel } from "../src/painel/servico";
import { criarAppPainel } from "../src/painel/app";
import { garantirAdmin } from "../src/painel/auth";
import { gerarParDeChaves } from "../src/licenca/token";
import type { Provisionador } from "../src/painel/provisionador";

const par = gerarParDeChaves();
const cfg = lerConfigPainel({ PAINEL_BASE_DOMAIN: "exemplo.com.br", PAINEL_PUBLIC_URL: "https://painel.exemplo.com.br", PAINEL_ADMIN_PASSWORD: "senha-forte-12345" } as NodeJS.ProcessEnv);
const provedor: ProvedorCobranca = { nome: "f", configurado: () => false, criarCliente: async () => ({ id: "c" }), criarAssinatura: async () => ({ id: "s", linkFatura: "" }), atualizarValor: async () => {}, cancelarAssinatura: async () => {} };

describe("painel — exclusão definitiva, reinício e visão geral", () => {
  let db: ReturnType<typeof abrirBancoPainel>; let server: Server; let base: string; let cookie = "";
  const apagadas: string[] = []; const sistemasNoServidor = new Set<string>();
  const prov = {
    ativo: true,
    alocarPorta: () => 3401, portaExistente: () => null, lerMapa: () => new Map(), statusInstancia: async (s: string) => (sistemasNoServidor.has(s) ? "online" : "ausente"),
    criarInstancia: async (slug: string, porta: number) => { sistemasNoServidor.add(slug); return { url: `https://${slug}.exemplo.com.br`, porta, usuarioInicial: "admin", senhaInicial: null, adotada: false, avisos: [] }; },
    excluirDefinitivamente: async (slug: string) => { apagadas.push(slug); sistemasNoServidor.delete(slug); return { pasta_removida: true }; },
    reiniciarVarias: async (slugs: string[]) => slugs.map((slug) => (sistemasNoServidor.has(slug) ? { slug, ok: true } : { slug, ok: true, ignorado: true, erro: "sem instância neste servidor" })),
    reiniciarPainelDepois: () => {},
  } as unknown as Provisionador;
  beforeEach(async () => {
    apagadas.length = 0; sistemasNoServidor.clear();
    db = abrirBancoPainel(":memory:"); await garantirAdmin(db, cfg);
    const servico = new ServicoPainel(db, cfg, provedor, par.privada);
    server = criarAppPainel({ db, cfg, servico, chavePublicaPem: par.publica, versao: "t", webDir: __dirname, provisionador: prov }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const r = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: "admin", senha: "senha-forte-12345" }) });
    cookie = (r.headers.get("set-cookie") || "").split(";")[0];
  });
  afterEach(() => { server.close(); db.close(); });
  const adm = (metodo: string, caminho: string, corpo?: unknown) => fetch(`${base}/api/admin${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", Cookie: cookie, "X-Requested-With": "painel" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const criar = async (slug: string) => (await (await adm("POST", "/escritorios", { nome: "Escritório " + slug, slug, email: `${slug}@x.com.br`, plano_id: "essencial", admin_senha: "senha-bem-forte-1" })).json()).escritorio.id as string;

  it("recusa excluir escritório que não está cancelado", async () => {
    const id = await criar("ativo-um");
    const r = await adm("DELETE", `/escritorios/${id}`, { confirmar: "ativo-um" });
    expect(r.status).toBe(409);
    expect((await r.json()).error).toMatch(/Cancele/);
    expect(apagadas).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) n FROM escritorios").get()).toEqual({ n: 1 });
  });
  it("recusa sem o endereço digitado certo", async () => {
    const id = await criar("cancelar-um"); await adm("POST", `/escritorios/${id}/cancelar`, {});
    expect((await adm("DELETE", `/escritorios/${id}`, { confirmar: "outro" })).status).toBe(400);
    expect((await adm("DELETE", `/escritorios/${id}`, {})).status).toBe(400);
    expect(apagadas).toEqual([]);
  });
  it("cancelado + endereço certo: apaga a instância e todo o cadastro, e registra o fato", async () => {
    const id = await criar("apagar-me"); await adm("POST", `/escritorios/${id}/cancelar`, {});
    const r = await adm("DELETE", `/escritorios/${id}`, { confirmar: "apagar-me" });
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.servidor).toMatchObject({ instancia_e_dados_apagados: true, pasta_removida: true });
    expect(apagadas).toEqual(["apagar-me"]);
    expect(db.prepare("SELECT COUNT(*) n FROM escritorios").get()).toEqual({ n: 0 });
    expect(db.prepare("SELECT COUNT(*) n FROM eventos WHERE escritorio_id=?").get(id)).toEqual({ n: 0 });
    expect(db.prepare("SELECT tipo FROM eventos ORDER BY id DESC LIMIT 1").get()).toEqual({ tipo: "escritorio_excluido" });
    expect((await adm("GET", `/escritorios/${id}`)).status).toBe(404);
  });
  it("reiniciar ignora cancelados e quem não tem sistema no servidor, sem tratar como erro", async () => {
    const a = await criar("tem-sistema"); const b = await criar("sem-sistema"); const c = await criar("cancelado-um");
    sistemasNoServidor.clear(); sistemasNoServidor.add("tem-sistema"); sistemasNoServidor.add("cancelado-um"); // a instância de "sem-sistema" não existe no servidor
    await adm("POST", `/escritorios/${c}/cancelar`, {}); void a; void b;
    const r = await (await adm("POST", "/servidor/reiniciar", { alvo: "escritorios" })).json();
    const slugs = r.escritorios.map((e: { slug: string }) => e.slug);
    expect(slugs).not.toContain("cancelado-um");
    expect(r.escritorios.find((e: { slug: string }) => e.slug === "tem-sistema")).toMatchObject({ ok: true });
    expect(r.escritorios.find((e: { slug: string }) => e.slug === "sem-sistema")).toMatchObject({ ok: true, ignorado: true });
    expect(r.ok).toBe(true);
  });
  it("visão geral: situação, receita prevista, testes acabando e por plano", async () => {
    await criar("novo-teste");
    const id = await criar("pagante"); await adm("POST", `/escritorios/${id}/pagamento-manual`, { ate: "2099-01-01" });
    const r = await (await adm("GET", "/resumo")).json();
    expect(r.total).toBe(2);
    expect(r.situacao.teste).toBe(1); expect(r.situacao.ativa).toBe(1);
    expect(r.pagantes).toBe(1); expect(r.receita_mensal_centavos).toBe(19700);
    expect(r.por_plano[0]).toMatchObject({ plano: "Essencial", ativos: 1 });
  });
  it("atividade geral e estado da contratação", async () => {
    await criar("um-so");
    const ev = await (await adm("GET", "/eventos?limite=5")).json();
    expect(ev.find((e: { tipo: string }) => e.tipo === "escritorio_criado")).toMatchObject({ slug: "um-so" });
    const c = await (await adm("GET", "/contratacao")).json();
    expect(c).toMatchObject({ aberta: false, teste_dias: 7, provisionamento_automatico: true });
    expect(c.planos_a_venda.map((p: { id: string }) => p.id)).toContain("essencial");
  });
});
