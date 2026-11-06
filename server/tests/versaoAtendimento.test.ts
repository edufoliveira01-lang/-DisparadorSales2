import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { compararVersoes, lerVersaoEmUso, ultimaVersaoDoOriginal, VerificadorDeVersao } from "../src/painel/versaoAtendimento";
import { garantirAdmin } from "../src/painel/auth";
import { abrirBancoPainel } from "../src/painel/banco";
import { criarAppPainel } from "../src/painel/app";
import { lerConfigPainel } from "../src/painel/config";
import { ServicoPainel } from "../src/painel/servico";
import { AsaasProvider } from "../src/painel/asaas";
import { gerarParDeChaves } from "../src/licenca/token";

const texto = (corpo: string, status = 200) => new Response(corpo, { status });
const js = (base: string, imagem: string) => texto(`window.__SALES_VERSAO__={"base":"${base}","imagem":"${imagem}"};\n`);
const tags = (...nomes: string[]) => texto(JSON.stringify(nomes.map((name) => ({ name }))));

describe("versões", () => {
  it("compara por número, não por texto (1.10.0 > 1.9.0)", () => {
    expect(compararVersoes("1.9.0", "1.10.0")).toBe(-1);
    expect(compararVersoes("1.101.0", "1.102.0")).toBe(-1);
    expect(compararVersoes("2.0.0", "1.999.9")).toBe(1);
    expect(compararVersoes("1.2.3", "1.2.3")).toBe(0);
  });

  it("lê a versão em uso do arquivo público da imagem e recusa lixo", async () => {
    expect(await lerVersaoEmUso("https://atendimento.exemplo.com.br/", (async (u: string) => { expect(u).toMatch(/^https:\/\/atendimento\.exemplo\.com\.br\/sales-versao\.js\?t=\d+$/); return js("1.101.0", "1.101.0-sales.5"); }) as never))
      .toEqual({ base: "1.101.0", imagem: "1.101.0-sales.5" });
    for (const ruim of [texto("<html>login</html>"), texto("", 404), js("1.101", "x"), js("1.101.0", "com espaço"), texto('window.__SALES_VERSAO__={"base":"1.101.0"};')]) {
      expect(await lerVersaoEmUso("https://a.exemplo.com.br", (async () => ruim) as never)).toBeNull();
    }
    expect(await lerVersaoEmUso("http://sem-https", (async () => js("1.101.0", "x")) as never)).toBeNull(); // só https
    expect(await lerVersaoEmUso("https://a", (async () => { throw new Error("offline"); }) as never)).toBeNull();
  });

  it("acha a maior tag vX.Y.Z do original e ignora o resto", async () => {
    expect(await ultimaVersaoDoOriginal((async () => tags("v1.9.0", "v1.10.0", "v1.102.0", "v1.101.0", "jmpo/v1.4.0", "v2.0.0-rc1", "nightly")) as never)).toBe("1.102.0");
    expect(await ultimaVersaoDoOriginal((async () => texto("limite", 403)) as never)).toBeNull();
    expect(await ultimaVersaoDoOriginal((async () => texto("não é json")) as never)).toBeNull();
  });

  it("o verificador usa cache, aceita forçar e diz se há atualização", async () => {
    let chamadasUso = 0, chamadasOriginal = 0, relogio = 1_000_000;
    let original = "v1.102.0";
    const http = (async (u: string) => { if (u.includes("sales-versao.js")) { chamadasUso++; return js("1.101.0", "1.101.0-sales.5"); } chamadasOriginal++; return tags(original, "v1.101.0"); }) as never;
    const v = new VerificadorDeVersao("https://atendimento.exemplo.com.br", http, () => relogio);
    const a = await v.obter();
    expect(a).toMatchObject({ em_uso: { base: "1.101.0", imagem: "1.101.0-sales.5" }, original: "1.102.0", atualizacao_disponivel: true, notas_url: "https://github.com/melgarafael/DeskcommCRM/releases/tag/v1.102.0", avisos: [] });
    await v.obter();
    expect([chamadasUso, chamadasOriginal]).toEqual([1, 1]); // cache
    relogio += 11 * 60_000; await v.obter();
    expect([chamadasUso, chamadasOriginal]).toEqual([2, 1]); // a versão em uso expira antes da do original
    original = "v1.101.0"; await v.obter(true);
    expect([chamadasUso, chamadasOriginal]).toEqual([3, 2]); // forçar refaz as duas
    expect((await v.obter()).atualizacao_disponivel).toBe(false);
  });

  it("sem a versão em uso (imagem antiga) ou sem GitHub: não afirma atualização e explica", async () => {
    const semArquivo = new VerificadorDeVersao("https://a.exemplo.com.br", (async (u: string) => (u.includes("sales-versao") ? texto("", 404) : tags("v1.102.0"))) as never);
    const r = await semArquivo.obter();
    expect(r.em_uso).toBeNull(); expect(r.atualizacao_disponivel).toBe(false); expect(r.avisos[0]).toMatch(/sales-versao\.js/);
    const semGithub = new VerificadorDeVersao("https://a.exemplo.com.br", (async (u: string) => (u.includes("sales-versao") ? js("1.101.0", "1.101.0-sales.5") : texto("", 403))) as never);
    const r2 = await semGithub.obter();
    expect(r2.original).toBeNull(); expect(r2.atualizacao_disponivel).toBe(false); expect(r2.avisos[0]).toMatch(/GitHub/);
  });
});

describe("rota do painel /api/admin/atendimento/versao", () => {
  let server: Server; let db: ReturnType<typeof abrirBancoPainel>;
  afterEach(() => { server?.close(); db?.close(); });
  async function subir(comAtendimento: boolean) {
    const cfg = lerConfigPainel({ PAINEL_BASE_DOMAIN: "x.exemplo.com.br", PAINEL_PUBLIC_URL: "https://painel.exemplo.com.br", PAINEL_ADMIN_PASSWORD: "senha-forte-12345",
      ...(comAtendimento ? { ATENDIMENTO_PONTE_URL: "https://p.exemplo.com.br", ATENDIMENTO_SEGREDO: "segredo-de-teste-com-mais-de-32-caracteres!!", ATENDIMENTO_URL: "https://atendimento.exemplo.com.br" } : {}) } as never);
    db = abrirBancoPainel(":memory:"); await garantirAdmin(db, cfg);
    const par = gerarParDeChaves();
    const servico = new ServicoPainel(db, cfg, new AsaasProvider({ apiKey: "", baseUrl: "http://x" }), par.privada);
    const fake = new VerificadorDeVersao("https://atendimento.exemplo.com.br", (async (u: string) => (u.includes("sales-versao") ? js("1.101.0", "1.101.0-sales.5") : tags("v1.102.0"))) as never);
    server = criarAppPainel({ db, cfg, servico, chavePublicaPem: par.publica, versao: "test", webDir: __dirname, versaoAtendimento: comAtendimento ? fake : undefined }).listen(0);
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }
  const entrar = async (base: string) => {
    const r = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: "admin", senha: "senha-forte-12345" }) });
    return (r.headers.get("set-cookie") || "").split(";")[0];
  };

  it("exige sessão de administrador e devolve a situação da versão", async () => {
    const base = await subir(true);
    expect((await fetch(`${base}/api/admin/atendimento/versao`)).status).toBe(401);
    const cookie = await entrar(base);
    const r = await fetch(`${base}/api/admin/atendimento/versao`, { headers: { Cookie: cookie } });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ em_uso: { base: "1.101.0" }, original: "1.102.0", atualizacao_disponivel: true });
  });

  it("sem atendimento configurado a rota responde 404 e o painel não mostra a faixa", async () => {
    const base = await subir(false);
    const cookie = await entrar(base);
    expect((await fetch(`${base}/api/admin/atendimento/versao`, { headers: { Cookie: cookie } })).status).toBe(404);
  });
});
