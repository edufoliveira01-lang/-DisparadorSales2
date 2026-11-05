import { describe, expect, it } from "vitest";
import { abrirBancoPainel } from "../src/painel/banco";
import { lerConfigPainel } from "../src/painel/config";
import { ServicoPainel } from "../src/painel/servico";
import { ClientePonte, ErroPonteAtendimento, lerConfigPonte } from "../src/atendimento/ponte";
import { assinarRequisicao, chaveSso, emitirTokenSso } from "../src/atendimento/assinatura";
import { atendimentoDaInstancia, enderecoDeEntrada } from "../src/atendimento/instancia";
import { gerarParDeChaves, verificarLicenca } from "../src/licenca/token";
import { ENTITLEMENTS, combinarEntitlements } from "../src/licenca/entitlements";
import { AsaasProvider } from "../src/painel/asaas";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!";
const par = gerarParDeChaves();

describe("assinatura compatível com a ponte", () => {
  it("gera exatamente o vetor fixo que a ponte (LexSync) confere", () => {
    expect(assinarRequisicao("k", { metodo: "POST", caminho: "/v1/offices", corpo: "{}" }, 1700000000)).toBe("322b08ae3db4fa420707ca15fce80779bedf4c91c4887e525e00eae2c1bd0d1b");
  });
  it("chave de entrada é por escritório e o token tem 60 s", () => {
    expect(chaveSso(SEGREDO, "alfa")).not.toBe(chaveSso(SEGREDO, "beta"));
    const t = emitirTokenSso(chaveSso(SEGREDO, "alfa"), { slug: "alfa", email: "a@b.com" }, 1000);
    const dados = JSON.parse(Buffer.from(t.split(".")[0], "base64url").toString("utf8"));
    expect(dados).toMatchObject({ slug: "alfa", email: "a@b.com", exp: 1060 });
  });
  it("o módulo é opcional: desligado por padrão e ligável por plano", () => {
    expect(ENTITLEMENTS.modulo_atendimento.padrao).toBe(false);
    expect(combinarEntitlements({}).modulo_atendimento).toBe(false);
    expect(combinarEntitlements({ modulo_atendimento: true }, {}).modulo_atendimento).toBe(true);
  });
});

describe("cliente da ponte", () => {
  it("assina a chamada e traduz erros", async () => {
    const vistas: { url: string; init: any }[] = [];
    const http = (async (url: string, init: any) => { vistas.push({ url, init }); return url.endsWith("/v1/offices") ? new Response(JSON.stringify({ org_id: "o1", slug: "alfa", created: true }), { status: 201 }) : new Response(JSON.stringify({ error: "Empresa não encontrada no atendimento.", codigo: "nao_encontrada" }), { status: 404 }); }) as unknown as typeof fetch;
    const c = new ClientePonte({ url: "https://ponte.exemplo.com.br", segredo: SEGREDO }, http, () => 1700000000);
    const r = await c.provisionar({ slug: "alfa", display_name: "Alfa", owner_email: "a@b.com" });
    expect(r.org_id).toBe("o1");
    const h = vistas[0].init.headers;
    expect(h["X-Sales-Timestamp"]).toBe("1700000000");
    expect(h["X-Sales-Signature"]).toBe(assinarRequisicao(SEGREDO, { metodo: "POST", caminho: "/v1/offices", corpo: vistas[0].init.body }, 1700000000));
    await expect(c.status("zzz")).rejects.toMatchObject({ status: 404, codigo: "nao_encontrada" });
    const offline = new ClientePonte({ url: "http://x", segredo: SEGREDO }, (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch);
    await expect(offline.status("a")).rejects.toBeInstanceOf(ErroPonteAtendimento);
  });
  it("configuração: exige segredo forte e é opcional", () => {
    expect(lerConfigPonte({})).toBeNull();
    expect(() => lerConfigPonte({ ATENDIMENTO_PONTE_URL: "https://p", ATENDIMENTO_SEGREDO: "curto" })).toThrow(/32/);
    expect(lerConfigPonte({ ATENDIMENTO_PONTE_URL: "https://p/", ATENDIMENTO_SEGREDO: SEGREDO, ATENDIMENTO_URL: "https://a.exemplo/" })).toMatchObject({ url: "https://p", urlPublica: "https://a.exemplo" });
  });
});

/** Ponte falsa: guarda o estado de cada empresa. */
function ponteFalsa() {
  const empresas = new Map<string, "ativo" | "suspenso">(); const log: string[] = []; let falhar = false;
  const ponte = {
    provisionar: async (d: any) => { if (falhar) throw new Error("ponte fora do ar"); log.push(`criar:${d.slug}:${d.owner_email}`); empresas.set(d.slug, "ativo"); return { org_id: "o_" + d.slug, slug: d.slug, created: true }; },
    suspender: async (s: string, m: string) => { if (falhar) throw new Error("ponte fora do ar"); log.push(`suspender:${s}`); empresas.set(s, "suspenso"); return {}; },
    reativar: async (s: string) => { log.push(`reativar:${s}`); empresas.set(s, "ativo"); return {}; },
    status: async () => ({ org_id: "x", status: "active" }),
  } as unknown as ClientePonte;
  return { ponte, empresas, log, falha: (v: boolean) => { falhar = v; } };
}
function painel(configurado = true) {
  const f = ponteFalsa();
  const cfg = lerConfigPainel({ PAINEL_BASE_DOMAIN: "disparazap.exemplo.com.br", PAINEL_PUBLIC_URL: "https://painel.exemplo.com.br", ...(configurado ? { ATENDIMENTO_PONTE_URL: "https://ponte.exemplo.com.br", ATENDIMENTO_PONTE_URL_PUBLICA: "https://ponte.publica.com.br", ATENDIMENTO_SEGREDO: SEGREDO, ATENDIMENTO_URL: "https://atendimento.exemplo.com.br" } : {}) } as never);
  let agora = new Date("2026-11-04T12:00:00Z");
  const db = abrirBancoPainel(":memory:");
  const s = new ServicoPainel(db, cfg, new AsaasProvider({ apiKey: "", baseUrl: "http://x" }), par.privada, () => agora, configurado ? f.ponte : null);
  return { s, f, db, avancar: (dias: number) => { agora = new Date(agora.getTime() + dias * 86_400_000); } };
}
const espera = () => new Promise((r) => setTimeout(r, 10));

describe("painel ↔ atendimento", () => {
  it("só cria a empresa quando o plano inclui o módulo, com o e-mail do escritório", async () => {
    const { s, f } = painel();
    const sem = await s.criarEscritorio({ slug: "alfa", nome: "Alfa Advocacia", email: "dono@alfa.com.br", teste_dias: 14 });
    await espera();
    expect(f.log).toEqual([]);
    expect(sem.escritorio.atendimento_disponivel).toBe(false);
    await s.atualizarEscritorio(sem.escritorio.id, { entitlements: { modulo_atendimento: true } });
    await espera();
    expect(f.log).toEqual(["criar:alfa:dono@alfa.com.br"]);
    expect(s.obterEscritorio(sem.escritorio.id)).toMatchObject({ atendimento_estado: "ativo", atendimento_erro: null, atendimento_disponivel: true });
  });

  it("suspende e reativa junto com o escritório, e acompanha o vencimento sem evento nenhum", async () => {
    const { s, f, avancar } = painel();
    const { escritorio } = await s.criarEscritorio({ slug: "beta", nome: "Beta Advocacia", email: "b@beta.com.br", teste_dias: 5, entitlements: { modulo_atendimento: true } });
    await espera();
    expect(f.empresas.get("beta")).toBe("ativo");
    s.suspender(escritorio.id, "teste"); await espera();
    expect(f.empresas.get("beta")).toBe("suspenso");
    s.reativar(escritorio.id); await espera();
    expect(f.empresas.get("beta")).toBe("ativo");
    expect(f.log).toEqual(["criar:beta:b@beta.com.br", "suspender:beta", "reativar:beta"]);
    avancar(30); // teste e carência vencidos
    expect(await s.reconciliarAtendimento()).toBe(1);
    expect(f.empresas.get("beta")).toBe("suspenso");
    s.registrarPagamentoManual(escritorio.id, "2027-01-31"); await espera();
    expect(f.empresas.get("beta")).toBe("ativo");
  });

  it("retirar o módulo do plano suspende o atendimento", async () => {
    const { s, f } = painel();
    const { escritorio } = await s.criarEscritorio({ slug: "gama", nome: "Gama Advocacia", email: "g@gama.com.br", entitlements: { modulo_atendimento: true } });
    await espera();
    await s.atualizarEscritorio(escritorio.id, { entitlements: { modulo_atendimento: false } }); await espera();
    expect(f.empresas.get("gama")).toBe("suspenso");
  });

  it("falha da ponte fica registrada e o ciclo periódico tenta de novo", async () => {
    const { s, f } = painel();
    f.falha(true);
    const { escritorio } = await s.criarEscritorio({ slug: "delta", nome: "Delta Advocacia", email: "d@delta.com.br", entitlements: { modulo_atendimento: true } });
    await espera();
    expect(s.obterEscritorio(escritorio.id)).toMatchObject({ atendimento_estado: null, atendimento_erro: "ponte fora do ar" });
    await expect(s.sincronizarAtendimento(escritorio.id)).rejects.toThrow(/fora do ar/);
    f.falha(false);
    expect(await s.reconciliarAtendimento()).toBe(1);
    expect(s.obterEscritorio(escritorio.id)).toMatchObject({ atendimento_estado: "ativo", atendimento_erro: null });
  });

  it("sem ponte configurada nada acontece e sincronizar explica o motivo", async () => {
    const { s } = painel(false);
    const { escritorio } = await s.criarEscritorio({ slug: "zeta", nome: "Zeta Advocacia", email: "e@zeta.com.br", entitlements: { modulo_atendimento: true } });
    expect(escritorio.atendimento_disponivel).toBe(false);
    await expect(s.sincronizarAtendimento(escritorio.id)).rejects.toThrow(/não está configurado/);
    expect(await s.reconciliarAtendimento()).toBe(0);
  });

  it("a licença só leva a chave de entrada depois que a empresa existe no atendimento, e a chave é a do escritório", async () => {
    const { s } = painel();
    const { escritorio, chave } = await s.criarEscritorio({ slug: "teta", nome: "Teta Advocacia", email: "t@teta.com.br", entitlements: { modulo_atendimento: true } });
    await espera();
    const l = s.emitirLicenca(chave)!;
    const carga = verificarLicenca(l.token, par.publica)!;
    expect(carga.entitlements.modulo_atendimento).toBe(true);
    expect(carga.atendimento).toEqual({ slug: "teta", url: "https://atendimento.exemplo.com.br", ponte_url: "https://ponte.publica.com.br", chave_sso: chaveSso(SEGREDO, "teta") });
    // outro escritório, sem o módulo: nada de atendimento na licença
    const outro = await s.criarEscritorio({ slug: "iota", nome: "Iota Advocacia", email: "i@iota.com.br" });
    await espera();
    expect(verificarLicenca(s.emitirLicenca(outro.chave)!.token, par.publica)!.atendimento ?? null).toBeNull();
  });
});

describe("instância: entrada direta", () => {
  it("instalação própria usa as variáveis; endereço de entrada leva token válido por 60 s", () => {
    const env = { ATENDIMENTO_PONTE_URL: "https://ponte.exemplo.com.br/", ATENDIMENTO_SEGREDO: SEGREDO, ATENDIMENTO_SLUG: "sales", ATENDIMENTO_URL: "https://atendimento.exemplo.com.br" };
    const a = atendimentoDaInstancia(env)!;
    expect(a).toMatchObject({ slug: "sales", ponteUrl: "https://ponte.exemplo.com.br", chaveSso: chaveSso(SEGREDO, "sales") });
    const url = new URL(enderecoDeEntrada(a, "  Pessoa@Escritorio.com.br "));
    expect(url.origin + url.pathname).toBe("https://ponte.exemplo.com.br/sso");
    const dados = JSON.parse(Buffer.from(url.searchParams.get("t")!.split(".")[0], "base64url").toString("utf8"));
    expect(dados).toMatchObject({ slug: "sales", email: "pessoa@escritorio.com.br" });
    expect(atendimentoDaInstancia({ ...env, ATENDIMENTO_SEGREDO: "curto" })).toBeNull();
    expect(atendimentoDaInstancia({})).toBeNull();
  });
});
