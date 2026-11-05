import { afterAll, describe, expect, it, vi } from "vitest";
import { db } from "../src/db";
import { agendarSincronizacaoDaEquipe, equipeParaAtendimento, ErroEquipe, lembrarEmailAntigo, PAPEL_NO_ATENDIMENTO, sincronizarEquipe, sincronizarEquipeSePossivel } from "../src/atendimento/equipe";
import { abrirBancoPainel } from "../src/painel/banco";
import { lerConfigPainel } from "../src/painel/config";
import { ServicoPainel } from "../src/painel/servico";
import { AsaasProvider } from "../src/painel/asaas";
import { gerarParDeChaves } from "../src/licenca/token";
import type { ClientePonte } from "../src/atendimento/ponte";

const SEGREDO = "segredo-de-teste-com-mais-de-32-caracteres!!";

describe("equipe do escritório → atendimento (lado do sistema)", () => {
  // O banco de teste é compartilhado entre os arquivos: não deixa pessoas de teste para trás.
  afterAll(() => { db.prepare("DELETE FROM users WHERE username LIKE 'eq\\_%' ESCAPE '\\'").run(); });
  it("traduz papéis, ignora inativos e duplicados e separa quem está sem e-mail", () => {
    expect(PAPEL_NO_ATENDIMENTO).toEqual({ administrador: "admin", gestor: "manager", advogado: "agent", atendimento: "agent", consulta: "viewer" });
    const ins = db.prepare("INSERT INTO users (username, display_name, email, role, permissions_json, active, password_hash, must_change_password) VALUES (?,?,?,?,?,?,?,0)");
    ins.run("eq_ana", "Ana Gestora", "Ana@Equipe.com.br", "gestor", "[]", 1, "x");
    ins.run("eq_ana2", "Ana de novo", "ana@equipe.com.br", "advogado", "[]", 1, "x");
    ins.run("eq_bia", "Bia", "bia@equipe.com.br", "consulta", "[]", 1, "x");
    ins.run("eq_inativo", "Inativo", "inativo@equipe.com.br", "advogado", "[]", 0, "x");
    ins.run("eq_sem", "Sem Email", null, "advogado", "[]", 1, "x");
    const { membros, semEmail, remover } = equipeParaAtendimento();
    const meus = membros.filter((m) => m.email.endsWith("@equipe.com.br"));
    expect(remover).toContain("inativo@equipe.com.br"); // desativada: perde o acesso no atendimento
    expect(remover).not.toContain("ana@equipe.com.br");
    expect(meus).toEqual([{ email: "ana@equipe.com.br", name: "Ana Gestora", role: "manager" }, { email: "bia@equipe.com.br", name: "Bia", role: "viewer" }]);
    expect(semEmail).toContain("Sem Email");
    expect(membros.some((m) => m.email === "inativo@equipe.com.br")).toBe(false);
  });

  it("envia ao painel com a chave de licença e resume o resultado", async () => {
    const vistas: { url: string; init: any }[] = [];
    const http = (async (url: string, init: any) => {
      vistas.push({ url, init });
      const corpo = JSON.parse(init.body) as { membros: { email: string; role: string }[]; remover: string[] };
      return new Response(JSON.stringify({ slug: "x", resultados: corpo.membros.map((m, i) => (i === 0 ? { email: m.email, ok: false, erro: "falhou" } : { email: m.email, ok: true, role: m.role })), removidos: corpo.remover.map((e) => ({ email: e, ok: true, removido: true })) }), { status: 200 });
    }) as unknown as typeof fetch;
    const r = await sincronizarEquipe({ LICENSE_SERVER_URL: "https://painel.exemplo.com.br/", LICENSE_KEY: "dz_chave-de-teste-longa-o-bastante" } as never, http);
    expect(vistas[0].url).toBe("https://painel.exemplo.com.br/api/v1/atendimento/equipe");
    expect(vistas[0].init.headers.Authorization).toBe("Bearer dz_chave-de-teste-longa-o-bastante");
    expect(r.enviados).toBeGreaterThanOrEqual(2);
    expect(r.ok).toBe(r.enviados - 1);
    expect(r.semEmail).toContain("Sem Email");
    expect(JSON.parse(vistas[0].init.body).remover).toContain("inativo@equipe.com.br");
    expect(r.revogados).toBeGreaterThanOrEqual(1);
  });

  it("e-mail trocado: o antigo é revogado uma vez e deixa de ser pendente; e-mail que voltou a ser de alguém ativo não é revogado", async () => {
    lembrarEmailAntigo("Antigo@Equipe.com.br");
    lembrarEmailAntigo("ana@equipe.com.br"); // pertence a uma pessoa ativa: não pode ser revogado
    expect(equipeParaAtendimento().remover).toContain("antigo@equipe.com.br");
    expect(equipeParaAtendimento().remover).not.toContain("ana@equipe.com.br");
    const corpos: any[] = [];
    const http = (async (_u: string, init: any) => { const c = JSON.parse(init.body); corpos.push(c); return new Response(JSON.stringify({ resultados: [], removidos: c.remover.map((e: string) => ({ email: e, ok: true, removido: true })) }), { status: 200 }); }) as unknown as typeof fetch;
    await sincronizarEquipe({ LICENSE_SERVER_URL: "https://p", LICENSE_KEY: "dz_chave-de-teste-longa-o-bastante" } as never, http);
    expect(corpos[0].remover).toContain("antigo@equipe.com.br");
    expect(equipeParaAtendimento().remover).not.toContain("antigo@equipe.com.br"); // já revogado
  });

  it("recusa em instalação própria e traduz erros do painel", async () => {
    await expect(sincronizarEquipe({} as never)).rejects.toMatchObject({ status: 409 });
    const negado = (async () => new Response(JSON.stringify({ error: "O atendimento não está ativo para este escritório." }), { status: 409 })) as unknown as typeof fetch;
    await expect(sincronizarEquipe({ LICENSE_SERVER_URL: "https://p", LICENSE_KEY: "dz_chave-de-teste-longa-o-bastante" } as never, negado)).rejects.toMatchObject({ status: 409, message: /não está ativo/ });
    const fora = (async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch;
    await expect(sincronizarEquipe({ LICENSE_SERVER_URL: "https://p", LICENSE_KEY: "dz_chave-de-teste-longa-o-bastante" } as never, fora)).rejects.toBeInstanceOf(ErroEquipe);
  });
});

describe("sincronização automática", () => {
  it("em instalação sem atendimento liberado não chama o painel e não falha; várias alterações seguidas viram uma só tentativa", async () => {
    const chamadas = vi.fn();
    vi.stubGlobal("fetch", chamadas);
    await expect(sincronizarEquipeSePossivel()).resolves.toBeUndefined();
    vi.useFakeTimers();
    try {
      agendarSincronizacaoDaEquipe(1000); agendarSincronizacaoDaEquipe(1000); agendarSincronizacaoDaEquipe(1000);
      await vi.advanceTimersByTimeAsync(1500);
    } finally { vi.useRealTimers(); vi.unstubAllGlobals(); }
    expect(chamadas).not.toHaveBeenCalled(); // sem licença/atendimento: nada é enviado
  });
});

describe("equipe → atendimento (lado do painel)", () => {
  function painel() {
    const chamadas: [string, unknown, string[]?][] = [];
    const ponte = {
      provisionar: async (d: any) => ({ org_id: "o_" + d.slug, slug: d.slug, created: true }),
      suspender: async () => ({}), reativar: async () => ({}), status: async () => ({ org_id: "x", status: "active" }),
      membros: async (slug: string, m: unknown, rem: string[] = []) => { chamadas.push([slug, m, rem]); return { slug, resultados: (m as { email: string }[]).map((x) => ({ email: x.email, ok: true })), removidos: rem.map((e) => ({ email: e, ok: true, removido: true })) }; },
    } as unknown as ClientePonte;
    const cfg = lerConfigPainel({ PAINEL_BASE_DOMAIN: "disparazap.exemplo.com.br", PAINEL_PUBLIC_URL: "https://painel.exemplo.com.br", ATENDIMENTO_PONTE_URL: "https://ponte.exemplo.com.br", ATENDIMENTO_SEGREDO: SEGREDO, ATENDIMENTO_URL: "https://atendimento.exemplo.com.br" } as never);
    const s = new ServicoPainel(abrirBancoPainel(":memory:"), cfg, new AsaasProvider({ apiKey: "", baseUrl: "http://x" }), gerarParDeChaves().privada, () => new Date("2026-11-04T12:00:00Z"), ponte);
    return { s, chamadas };
  }
  const espera = () => new Promise((r) => setTimeout(r, 10));

  it("só aceita a chave do próprio escritório, com o atendimento ativo, e repassa a lista saneada à ponte", async () => {
    const { s, chamadas } = painel();
    const com = await s.criarEscritorio({ slug: "alfa", nome: "Alfa Advocacia", email: "dono@alfa.com.br", entitlements: { modulo_atendimento: true } });
    const sem = await s.criarEscritorio({ slug: "beta", nome: "Beta Advocacia", email: "b@beta.com.br" });
    await espera();
    const lista = [{ email: "ana@alfa.com.br", name: "Ana", role: "manager", extra: "ignorado" }];
    expect(await s.sincronizarEquipe(com.chave, lista)).toMatchObject({ resultados: [{ email: "ana@alfa.com.br", ok: true }] });
    expect(chamadas).toEqual([["alfa", [{ email: "ana@alfa.com.br", name: "Ana", role: "manager" }], []]]);
    // só remoção (ninguém ativo com e-mail): permitido; e a lista de remoção é saneada
    expect(await s.sincronizarEquipe(com.chave, [], ["saiu@alfa.com.br", 42, ""])).toMatchObject({ removidos: [{ email: "saiu@alfa.com.br", removido: true }] });
    expect(chamadas[1]).toEqual(["alfa", [], ["saiu@alfa.com.br"]]);
    await expect(s.sincronizarEquipe("dz_chave-que-nao-existe-1234567", lista)).rejects.toMatchObject({ status: 401 });
    await expect(s.sincronizarEquipe("curta", lista)).rejects.toMatchObject({ status: 401 });
    await expect(s.sincronizarEquipe(sem.chave, lista)).rejects.toMatchObject({ status: 409 }); // plano sem o módulo
    await expect(s.sincronizarEquipe(com.chave, [])).rejects.toMatchObject({ status: 400 }); // nada a adicionar nem a remover
    await expect(s.sincronizarEquipe(com.chave, "lixo")).rejects.toMatchObject({ status: 400 });
  });
});
