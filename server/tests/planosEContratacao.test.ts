import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { abrirBancoPainel } from "../src/painel/banco";
import { lerConfigPainel } from "../src/painel/config";
import type { ProvedorCobranca } from "../src/painel/asaas";
import { ServicoPainel } from "../src/painel/servico";
import { criarAppPainel } from "../src/painel/app";
import { gerarParDeChaves } from "../src/licenca/token";
import { combinarEntitlements, normalizarEntitlements, ENTITLEMENTS, GRUPOS_DE_ENTITLEMENTS } from "../src/licenca/entitlements";
import { PLANOS_PADRAO } from "../src/painel/planosPadrao";
import { moduloExigidoPelaRota } from "../src/routes/gestao";

const par = gerarParDeChaves();
const env = (extra: Record<string, string> = {}) => ({ PAINEL_BASE_DOMAIN: "exemplo.com.br", PAINEL_PUBLIC_URL: "https://painel.exemplo.com.br", ...extra }) as NodeJS.ProcessEnv;
class Falso implements ProvedorCobranca {
  nome = "falso"; configurado() { return false; }
  async criarCliente() { return { id: "c" }; } async criarAssinatura() { return { id: "s", linkFatura: "" }; }
  async atualizarValor() {} async cancelarAssinatura() {}
}

describe("planos de fábrica", () => {
  it("são quatro, do mais barato ao mais caro, com entitlements válidos e todos os módulos cobertos", () => {
    expect(PLANOS_PADRAO).toHaveLength(4);
    const precos = PLANOS_PADRAO.map((p) => p.preco_centavos);
    expect([...precos].sort((a, b) => a - b)).toEqual(precos);
    for (const p of PLANOS_PADRAO) {
      expect(() => normalizarEntitlements(p.entitlements)).not.toThrow();
      for (const k of Object.keys(ENTITLEMENTS)) expect(k in p.entitlements, `${p.id} sem ${k}`).toBe(true);
    }
    // cada plano libera pelo menos o que o anterior liberava (ninguém perde módulo ao subir de plano)
    for (let i = 1; i < PLANOS_PADRAO.length; i++) for (const [k, v] of Object.entries(PLANOS_PADRAO[i - 1].entitlements)) {
      const novo = (PLANOS_PADRAO[i].entitlements as Record<string, unknown>)[k];
      if (typeof v === "boolean") expect(!v || novo === true, `${PLANOS_PADRAO[i].id}/${k}`).toBe(true);
      else if (typeof v === "number") expect(novo === null || (novo as number) >= v, `${PLANOS_PADRAO[i].id}/${k}`).toBe(true);
    }
  });
  it("os grupos da página de contratação cobrem todos os limites e módulos", () => {
    const listados = GRUPOS_DE_ENTITLEMENTS.flatMap((g) => g.chaves).sort();
    expect(listados).toEqual(Object.keys(ENTITLEMENTS).sort());
  });
  it("nascem no banco novo, à venda, e não voltam depois de apagados", () => {
    const db = abrirBancoPainel(":memory:");
    const ids = (db.prepare("SELECT id FROM planos WHERE publico=1 ORDER BY preco_centavos").all() as { id: string }[]).map((r) => r.id);
    expect(ids).toEqual(["essencial", "profissional", "avancado", "ilimitado"]);
    expect(db.prepare("SELECT id FROM planos WHERE id='escritorio'").get()).toBeTruthy(); // plano genérico de sempre
    db.prepare("DELETE FROM planos WHERE id='essencial'").run();
    expect(db.prepare("SELECT 1 FROM config_painel WHERE chave='planos_padrao_v1'").get()).toBeTruthy();
  });
  it("o teste grátis padrão é de 7 dias", () => { expect(lerConfigPainel(env()).testePadraoDias).toBe(7); });
});

describe("módulos da gestão por plano", () => {
  it("cada área exige o módulo certo", () => {
    expect(moduloExigidoPelaRota("/tarefas/1")?.chave).toBe("modulo_tarefas");
    expect(moduloExigidoPelaRota("/meu-painel")?.chave).toBe("modulo_tarefas");
    expect(moduloExigidoPelaRota("/arquivos")?.chave).toBe("modulo_arquivos");
    expect(moduloExigidoPelaRota("/indicadores")?.chave).toBe("modulo_indicadores");
    expect(moduloExigidoPelaRota("/captacao")?.chave).toBe("modulo_captacao");
    expect(moduloExigidoPelaRota("/financeiro/parcelas")?.chave).toBe("modulo_financeiro");
    expect(moduloExigidoPelaRota("/pessoas")).toBeUndefined();
  });
  it("o plano Essencial não inclui financeiro, mas inclui tarefas", () => {
    const e = combinarEntitlements(PLANOS_PADRAO[0].entitlements);
    expect(e.modulo_financeiro).toBe(false);
    expect(e.modulo_tarefas).toBe(true);
    expect(e.max_usuarios).toBe(3);
  });
});

describe("página pública de contratação", () => {
  let db: ReturnType<typeof abrirBancoPainel>; let server: Server; let base: string;
  const subir = (extra: Record<string, string>) => {
    db = abrirBancoPainel(":memory:");
    const cfg = lerConfigPainel(env(extra));
    server = criarAppPainel({ db, cfg, servico: new ServicoPainel(db, cfg, new Falso(), par.privada), chavePublicaPem: par.publica, versao: "t", webDir: __dirname }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  };
  afterEach(() => { server?.close(); db?.close(); });
  const post = (corpo: unknown) => fetch(`${base}/api/publico/contratar`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const valido = { plano_id: "profissional", nome: "Silva & Associados", slug: "silva-assoc", email: "a@silva.com.br", admin_usuario: "silva", admin_senha: "senha-bem-forte-1", aceite: true };

  it("lista só os planos à venda, com os itens agrupados, sem expor nada interno", async () => {
    subir({});
    const j = await (await fetch(`${base}/api/publico/planos`)).json();
    expect(j.teste_dias).toBe(7);
    expect(j.contratacao_aberta).toBe(false);
    expect(j.planos.map((p: { id: string }) => p.id)).toEqual(["essencial", "profissional", "avancado", "ilimitado"]);
    const ess = j.planos[0];
    expect(ess.grupos.flatMap((g: { itens: unknown[] }) => g.itens)).toHaveLength(Object.keys(ENTITLEMENTS).length);
    expect(JSON.stringify(j)).not.toMatch(/dz_|hash|entitlements_json/i);
  });
  it("fechada por padrão: não cria nada", async () => {
    subir({});
    expect((await post(valido)).status).toBe(403);
    expect(db.prepare("SELECT COUNT(*) n FROM escritorios").get()).toEqual({ n: 0 });
  });
  it("aberta: cria o escritório em teste de 7 dias no plano escolhido e não devolve a chave de licença", async () => {
    subir({ PAINEL_CONTRATACAO_PUBLICA: "1" });
    const r = await post(valido);
    expect(r.status).toBe(201);
    const j = await r.json();
    expect(j.endereco).toBe("https://silva-assoc.exemplo.com.br");
    expect(JSON.stringify(j)).not.toMatch(/dz_/);
    const e = db.prepare("SELECT plano_id, teste_ate, criado_em FROM escritorios").get() as { plano_id: string; teste_ate: string; criado_em: string };
    expect(e.plano_id).toBe("profissional");
    const dias = Math.round((Date.parse(e.teste_ate) - Date.parse(e.criado_em.slice(0, 10))) / 86_400_000);
    expect(dias).toBeGreaterThanOrEqual(7); expect(dias).toBeLessThanOrEqual(8);
  });
  it("recusa sem aceite, plano fora da venda, senha curta e ignora tentativa de mexer nos limites", async () => {
    subir({ PAINEL_CONTRATACAO_PUBLICA: "1" });
    expect((await post({ ...valido, aceite: false })).status).toBe(400);
    expect((await post({ ...valido, plano_id: "escritorio" })).status).toBe(400);
    expect((await post({ ...valido, admin_senha: "curta" })).status).toBe(400);
    expect((await post({ ...valido, admin_senha: "" })).status).toBe(400);
    const r = await post({ ...valido, entitlements: { max_usuarios: 9999 }, cortesia: true, teste_dias: 365 });
    expect(r.status).toBe(201);
    const e = db.prepare("SELECT entitlements_json, teste_ate FROM escritorios").get() as { entitlements_json: string; teste_ate: string | null };
    expect(e.entitlements_json).toBe("{}");
    expect(e.teste_ate).not.toBeNull();
  });
  it("campo-armadilha preenchido finge sucesso sem criar nada", async () => {
    subir({ PAINEL_CONTRATACAO_PUBLICA: "1" });
    expect((await (await post({ ...valido, site: "http://spam" })).json()).ok).toBe(true);
    expect(db.prepare("SELECT COUNT(*) n FROM escritorios").get()).toEqual({ n: 0 });
  });
  it("limita tentativas por endereço", async () => {
    subir({ PAINEL_CONTRATACAO_PUBLICA: "1" });
    for (let i = 0; i < 5; i++) await post({ ...valido, aceite: false });
    expect((await post(valido)).status).toBe(429);
  });
});
