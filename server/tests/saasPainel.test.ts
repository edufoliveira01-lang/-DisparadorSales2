import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { abrirBancoPainel } from "../src/painel/banco";
import { lerConfigPainel } from "../src/painel/config";
import { AsaasProvider, type ProvedorCobranca, type DadosAssinatura, type DadosCliente } from "../src/painel/asaas";
import { ServicoPainel, ErroPainel } from "../src/painel/servico";
import { criarAppPainel } from "../src/painel/app";
import { garantirAdmin } from "../src/painel/auth";
import { calcularStatus, somarMes, somarDias, fimDoDia } from "../src/painel/status";
import { assinarLicenca, avaliarLicenca, gerarParDeChaves, verificarLicenca, type CargaLicenca } from "../src/licenca/token";
import { combinarEntitlements, excedeLimite, normalizarEntitlements } from "../src/licenca/entitlements";

const par = gerarParDeChaves();
const cfg = lerConfigPainel({ PAINEL_BASE_DOMAIN: "disparazap.exemplo.com.br", PAINEL_PUBLIC_URL: "https://painel.exemplo.com.br", ASAAS_WEBHOOK_TOKEN: "w".repeat(40), PAINEL_ADMIN_PASSWORD: "senha-forte-12345", ASAAS_API_KEY: "chave" } as NodeJS.ProcessEnv);

class ProvedorFalso implements ProvedorCobranca {
  nome = "falso"; ativo = true; chamadas: string[] = []; falhar = false; valores: Record<string, number> = {};
  configurado() { return this.ativo; }
  async criarCliente(d: DadosCliente) { this.chamadas.push(`cliente:${d.referencia}`); if (this.falhar) throw new Error("Asaas fora do ar"); return { id: "cus_1" }; }
  async criarAssinatura(d: DadosAssinatura) { this.chamadas.push(`assinatura:${d.valorCentavos}:${d.proximoVencimento}`); this.valores.sub_1 = d.valorCentavos; return { id: "sub_1", linkFatura: "https://fatura.exemplo/1" }; }
  async atualizarValor(id: string, v: number) { this.chamadas.push(`valor:${id}:${v}`); this.valores[id] = v; }
  async cancelarAssinatura(id: string) { this.chamadas.push(`cancelar:${id}`); }
}

describe("entitlements", () => {
  it("padrão ilimitado, camadas e validação", () => {
    expect(combinarEntitlements({}, {}).max_usuarios).toBeNull();
    expect(combinarEntitlements({ max_usuarios: 5 }, { max_usuarios: 10 }).max_usuarios).toBe(10);
    expect(combinarEntitlements({ max_usuarios: 5 }, { max_usuarios: null }).max_usuarios).toBeNull();
    expect(combinarEntitlements({ ia_habilitada: false }).ia_habilitada).toBe(false);
    expect(excedeLimite({ max_advogados: 2 }, "max_advogados", 2)).toEqual({ excede: true, limite: 2 });
    expect(excedeLimite({ max_advogados: 2 }, "max_advogados", 1).excede).toBe(false);
    expect(excedeLimite({}, "max_advogados", 9999).excede).toBe(false);
    expect(() => normalizarEntitlements({ inexistente: 1 })).toThrow(/desconhecido/);
    expect(() => normalizarEntitlements({ max_usuarios: -1 })).toThrow();
    expect(() => normalizarEntitlements({ ia_habilitada: 1 })).toThrow();
    expect(normalizarEntitlements({ max_usuarios: null, ia_habilitada: false })).toEqual({ max_usuarios: null, ia_habilitada: false });
  });
});

describe("licença assinada e avaliação por datas", () => {
  const base = (o: Partial<CargaLicenca> = {}): CargaLicenca => ({ v: 1, escritorio_id: "off_1", slug: "x", nome: "X", plano: "escritorio", status: "ativa", entitlements: {}, vence_em: "2026-12-10T23:59:59-03:00", carencia_ate: "2026-12-17T23:59:59-03:00", emitida_em: "2026-12-01T12:00:00Z", valido_ate: "2026-12-04T12:00:00Z", tolerancia_offline_dias: 14, ...o });
  it("assina, verifica e rejeita adulteração ou outra chave", () => {
    const t = assinarLicenca(base(), par.privada);
    expect(verificarLicenca(t, par.publica)?.escritorio_id).toBe("off_1");
    const [v, corpo, sig] = t.split(".");
    const adulterado = Buffer.from(JSON.stringify({ ...base(), status: "ativa", vence_em: "2099-01-01T00:00:00Z" })).toString("base64url");
    expect(verificarLicenca(`${v}.${adulterado}.${sig}`, par.publica)).toBeNull();
    expect(verificarLicenca(t, gerarParDeChaves().publica)).toBeNull();
    expect(verificarLicenca("lixo", par.publica)).toBeNull();
    expect(verificarLicenca(`${v}.${corpo}`, par.publica)).toBeNull();
  });
  it("ativa → vence em breve → carência → suspensa, sem depender do painel", () => {
    const c = base({ valido_ate: "2027-12-01T00:00:00Z" });
    expect(avaliarLicenca(c, new Date("2026-12-01T12:00:00Z"))).toMatchObject({ status: "ativa", restrito: false, aviso: null });
    expect(avaliarLicenca(c, new Date("2026-12-07T12:00:00Z"))).toMatchObject({ status: "ativa", restrito: false });
    expect(avaliarLicenca(c, new Date("2026-12-07T12:00:00Z")).aviso).toMatch(/vence em/);
    expect(avaliarLicenca(c, new Date("2026-12-12T12:00:00Z"))).toMatchObject({ status: "carencia", restrito: false });
    expect(avaliarLicenca(c, new Date("2026-12-18T12:00:00Z"))).toMatchObject({ status: "suspensa", restrito: true });
  });
  it("teste, cortesia, cancelada, suspensa manual e sem contato", () => {
    expect(avaliarLicenca(base({ status: "teste", valido_ate: "2027-01-01T00:00:00Z" }), new Date("2026-12-05T12:00:00Z")).aviso).toMatch(/teste/i);
    expect(avaliarLicenca(base({ vence_em: null, carencia_ate: null, valido_ate: "2027-01-01T00:00:00Z" }), new Date("2026-12-05T12:00:00Z"))).toMatchObject({ status: "ativa", restrito: false });
    expect(avaliarLicenca(base({ status: "cancelada", valido_ate: "2027-01-01T00:00:00Z" }), new Date("2026-12-05T12:00:00Z")).restrito).toBe(true);
    expect(avaliarLicenca(base({ status: "suspensa", valido_ate: "2027-01-01T00:00:00Z" }), new Date("2026-12-05T12:00:00Z")).restrito).toBe(true);
    // 3 dias de validade + 14 de tolerância = restringe depois de 18 dias sem contato
    expect(avaliarLicenca(base({ vence_em: null, carencia_ate: null }), new Date("2026-12-10T12:00:00Z")).restrito).toBe(false);
    expect(avaliarLicenca(base({ vence_em: null, carencia_ate: null }), new Date("2026-12-25T12:00:00Z"))).toMatchObject({ status: "sem_contato", restrito: true });
  });
});

describe("regras de data", () => {
  it("somarMes preserva o dia e respeita fim de mês", () => {
    expect(somarMes("2026-03-10")).toBe("2026-04-10");
    expect(somarMes("2026-01-31")).toBe("2026-02-28");
    expect(somarMes("2028-01-31")).toBe("2028-02-29");
    expect(somarMes("2026-12-15")).toBe("2027-01-15");
    expect(somarDias("2026-02-27", 3)).toBe("2026-03-02");
  });
  it("status efetivo: teste, ativa, carência, suspensa, manual e cortesia", () => {
    const e = { status_manual: null, teste_ate: "2026-03-10", pago_ate: null, carencia_dias: null };
    expect(calcularStatus(e, new Date("2026-03-10T23:00:00-03:00"), 7).status).toBe("teste");
    expect(calcularStatus(e, new Date("2026-03-12T12:00:00-03:00"), 7).status).toBe("carencia");
    expect(calcularStatus(e, new Date("2026-03-18T12:00:00-03:00"), 7).status).toBe("suspensa");
    expect(calcularStatus({ ...e, pago_ate: "2026-04-10" }, new Date("2026-03-20T12:00:00-03:00"), 7).status).toBe("ativa");
    expect(calcularStatus({ ...e, carencia_dias: 0 }, new Date("2026-03-11T12:00:00-03:00"), 7).status).toBe("suspensa");
    expect(calcularStatus({ ...e, status_manual: "suspensa", pago_ate: "2099-01-01" }, new Date("2026-03-01T12:00:00-03:00"), 7).status).toBe("suspensa");
    expect(calcularStatus({ ...e, status_manual: "cancelada" }, new Date("2026-03-01T12:00:00-03:00"), 7).status).toBe("cancelada");
    expect(calcularStatus({ status_manual: null, teste_ate: null, pago_ate: null, carencia_dias: null }, new Date(), 7)).toMatchObject({ status: "ativa", vence_em: null });
    expect(fimDoDia("2026-03-10")).toBe("2026-03-10T23:59:59-03:00");
  });
});

describe("adaptador do Asaas", () => {
  it("envia os pedidos esperados com a chave no cabeçalho e valor em reais", async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => {
      chamadas.push({ url, init });
      if (url.endsWith("/customers")) return new Response(JSON.stringify({ id: "cus_9" }), { status: 200 });
      if (url.endsWith("/subscriptions")) return new Response(JSON.stringify({ id: "sub_9" }), { status: 200 });
      if (url.includes("/payments")) return new Response(JSON.stringify({ data: [{ invoiceUrl: "https://asaas/fatura" }] }), { status: 200 });
      return new Response(JSON.stringify({}), { status: 200 });
    }) as unknown as typeof fetch;
    const p = new AsaasProvider({ apiKey: "ak_teste", baseUrl: "https://api-sandbox.asaas.com/v3" }, http);
    expect((await p.criarCliente({ nome: "Sales & Associados", documento: "12.345.678/0001-90", email: "a@b.com", telefone: "(11) 99999-0000", referencia: "off_1" })).id).toBe("cus_9");
    const ass = await p.criarAssinatura({ clienteId: "cus_9", valorCentavos: 19990, proximoVencimento: "2026-12-10", descricao: "DisparaZap", referencia: "off_1" });
    expect(ass).toEqual({ id: "sub_9", linkFatura: "https://asaas/fatura" });
    await p.atualizarValor("sub_9", 25000); await p.cancelarAssinatura("sub_9");
    const [cli, sub, , upd, del] = chamadas;
    expect((cli.init.headers as Record<string, string>).access_token).toBe("ak_teste");
    expect(JSON.parse(String(cli.init.body))).toMatchObject({ name: "Sales & Associados", cpfCnpj: "12345678000190", mobilePhone: "11999990000", externalReference: "off_1" });
    expect(JSON.parse(String(sub.init.body))).toEqual({ customer: "cus_9", billingType: "UNDEFINED", value: 199.9, nextDueDate: "2026-12-10", cycle: "MONTHLY", description: "DisparaZap", externalReference: "off_1" });
    expect(upd.init.method).toBe("PUT"); expect(JSON.parse(String(upd.init.body))).toMatchObject({ value: 250, updatePendingPayments: true });
    expect(del.init.method).toBe("DELETE");
  });
  it("traduz erros e exige chave configurada", async () => {
    const http = (async () => new Response(JSON.stringify({ errors: [{ description: "CPF/CNPJ inválido" }] }), { status: 400 })) as unknown as typeof fetch;
    await expect(new AsaasProvider({ apiKey: "k", baseUrl: "https://x" }, http).criarCliente({ nome: "A", email: "a@b.com", referencia: "r" })).rejects.toThrow("CPF/CNPJ inválido");
    await expect(new AsaasProvider({ apiKey: "", baseUrl: "https://x" }).criarCliente({ nome: "A", email: "a@b.com", referencia: "r" })).rejects.toThrow(/não configurado/);
  });
});

describe("serviço do painel", () => {
  let db: ReturnType<typeof abrirBancoPainel>; let prov: ProvedorFalso; let agora: Date; let s: ServicoPainel;
  beforeEach(() => { db = abrirBancoPainel(":memory:"); prov = new ProvedorFalso(); agora = new Date("2026-12-01T15:00:00Z"); s = new ServicoPainel(db, cfg, prov, par.privada, () => agora); });
  afterEach(() => db.close());
  const novo = (extra: Record<string, unknown> = {}) => s.criarEscritorio({ nome: "Sales & Associados", slug: "sales", email: "contato@sales.com.br", ...extra });
  const comPreco = () => s.atualizarPlano("escritorio", { preco_centavos: 19900 });

  it("cria escritório em teste, com chave própria e sem guardar a chave em claro", async () => {
    const r = await novo();
    expect(r.escritorio).toMatchObject({ slug: "sales", status: "teste", endereco: "https://sales.disparazap.exemplo.com.br" });
    expect(r.escritorio.vence_em).toBe("2026-12-15T23:59:59-03:00");
    expect(r.chave).toMatch(/^dz_[\w-]{32}$/);
    expect(JSON.stringify(db.prepare("SELECT * FROM escritorios").all())).not.toContain(r.chave);
    expect(prov.chamadas).toEqual([]); // plano de preço 0: sem cobrança automática
  });
  it("valida entradas e reserva endereços", async () => {
    await expect(novo({ slug: "AB" })).rejects.toThrow(/endereço/);
    await expect(novo({ slug: "painel" })).rejects.toThrow(/reservado/);
    await expect(novo({ email: "x" })).rejects.toThrow(/e-mail/);
    await expect(novo({ plano_id: "nao-existe" })).rejects.toThrow(/Plano/);
    await expect(novo({ entitlements: { max_usuarios: -5 } })).rejects.toThrow();
    await novo();
    await expect(novo({ email: "outro@sales.com.br" })).rejects.toBeInstanceOf(ErroPainel);
  });
  it("cria cobrança no provedor com o primeiro vencimento no fim do teste; falha do provedor não impede o cadastro", async () => {
    await comPreco();
    const r = await novo();
    expect(prov.chamadas).toEqual(["cliente:" + r.escritorio.id, "assinatura:19900:2026-12-15"]);
    expect(s.obterEscritorio(r.escritorio.id)).toMatchObject({ asaas_subscription_id: "sub_1", link_fatura: "https://fatura.exemplo/1" });
    prov.falhar = true;
    const r2 = await s.criarEscritorio({ nome: "Outro", slug: "outro", email: "o@o.com" });
    expect(r2.aviso).toMatch(/cobrança não foi criada/);
    expect(s.obterEscritorio(r2.escritorio.id).eventos.some((e) => e.tipo === "cobranca_erro")).toBe(true);
  });
  it("sem provedor configurado orienta o pagamento manual", async () => {
    await comPreco(); prov.ativo = false;
    expect((await novo()).aviso).toMatch(/manual|Registrar pagamento/);
  });
  it("licença: reflete plano e ajustes, atualiza o último contato e rejeita chave inválida", async () => {
    await s.atualizarPlano("escritorio", { entitlements: { max_usuarios: 5, ia_habilitada: false } });
    const r = await novo({ entitlements: { max_usuarios: null } });
    const lic = s.emitirLicenca(r.chave, { ip: "1.2.3.4", versao: "2.61.0" })!;
    const carga = verificarLicenca(lic.token, par.publica)!;
    expect(carga).toMatchObject({ slug: "sales", status: "teste" });
    expect(carga.entitlements).toMatchObject({ max_usuarios: null, ia_habilitada: false, max_advogados: null });
    expect(s.obterEscritorio(r.escritorio.id)).toMatchObject({ ultima_versao: "2.61.0", ultimo_ip: "1.2.3.4" });
    expect(s.emitirLicenca("dz_inexistente_inexistente_inexistente")).toBeNull();
    expect(s.emitirLicenca("")).toBeNull();
  });
  it("webhook: pagamento libera por um mês; reentrega é ignorada; atraso vira carência e suspensão", async () => {
    await comPreco();
    const r = await novo(); const id = r.escritorio.id;
    const pagamento = (evento: string, extra = {}) => ({ event: evento, payment: { id: "pay_1", subscription: "sub_1", customer: "cus_1", value: 199, status: "RECEIVED", dueDate: "2026-12-15", paymentDate: "2026-12-14", invoiceUrl: "https://i/1", ...extra } });
    expect(s.processarWebhook(pagamento("PAYMENT_RECEIVED"))).toEqual({ ok: true });
    expect(s.obterEscritorio(id)).toMatchObject({ pago_ate: "2027-01-15", status: "ativa" }); // pago além do teste: ativa
    agora = new Date("2026-12-20T12:00:00Z");
    expect(s.obterEscritorio(id).status).toBe("ativa");
    expect(s.processarWebhook(pagamento("PAYMENT_RECEIVED"))).toMatchObject({ ignorado: "duplicado" });
    expect(s.processarWebhook(pagamento("PAYMENT_CONFIRMED"))).toEqual({ ok: true }); // outro evento do mesmo pagamento é aceito sem recuar a data
    expect(s.obterEscritorio(id).pago_ate).toBe("2027-01-15");
    agora = new Date("2027-01-18T12:00:00Z"); expect(s.obterEscritorio(id).status).toBe("carencia");
    agora = new Date("2027-01-25T12:00:00Z"); expect(s.obterEscritorio(id).status).toBe("suspensa");
    s.processarWebhook({ event: "PAYMENT_RECEIVED", payment: { id: "pay_2", subscription: "sub_1", value: 199, dueDate: "2027-01-15", paymentDate: "2027-01-26" } });
    expect(s.obterEscritorio(id)).toMatchObject({ pago_ate: "2027-02-15", status: "ativa" });
  });
  it("webhook: evento de escritório desconhecido, ruído e estorno", async () => {
    await comPreco(); const r = await novo(); const id = r.escritorio.id;
    expect(s.processarWebhook({ event: "PAYMENT_RECEIVED", payment: { id: "p9", subscription: "sub_x", dueDate: "2026-12-15" } })).toMatchObject({ ignorado: "escritorio_nao_encontrado" });
    expect(s.processarWebhook({})).toMatchObject({ ignorado: "sem_evento" });
    expect(s.processarWebhook({ event: "CHECKOUT_PAID" })).toMatchObject({ ignorado: "evento_nao_tratado" });
    s.processarWebhook({ event: "PAYMENT_OVERDUE", payment: { id: "pay_3", subscription: "sub_1", dueDate: "2026-12-15" } });
    expect(s.obterEscritorio(id).eventos.some((e) => e.tipo === "pagamento_vencido")).toBe(true);
    s.processarWebhook({ event: "PAYMENT_REFUNDED", payment: { id: "pay_4", subscription: "sub_1", dueDate: "2026-12-15" } });
    expect(s.obterEscritorio(id)).toMatchObject({ status: "suspensa", status_manual: "suspensa" });
    expect(s.reativar(id).status).not.toBe("suspensa");
  });
  it("ações do administrador: pagamento manual, suspender, cancelar (cancela a assinatura), nova chave e troca de plano", async () => {
    await comPreco(); const r = await novo(); const id = r.escritorio.id;
    expect(s.registrarPagamentoManual(id, "2027-06-30").pago_ate).toBe("2027-06-30");
    expect(() => s.registrarPagamentoManual(id, "30/06/2027")).toThrow(/AAAA-MM-DD/);
    expect(s.suspender(id, "teste").status).toBe("suspensa");
    expect(s.emitirLicenca(r.chave)!.carga.status).toBe("suspensa");
    s.reativar(id);
    const nova = s.rotacionarChave(id).chave;
    expect(s.emitirLicenca(r.chave)).toBeNull(); expect(s.emitirLicenca(nova)).not.toBeNull();
    const plano = await s.criarPlano({ nome: "Premium", preco_centavos: 29900, entitlements: { max_advogados: 10 } });
    await s.atualizarEscritorio(id, { plano_id: plano.id });
    expect(prov.chamadas).toContain("valor:sub_1:29900");
    await s.cancelar(id);
    expect(prov.chamadas).toContain("cancelar:sub_1");
    expect(s.obterEscritorio(id).status).toBe("cancelada");
    expect(s.emitirLicenca(nova)!.carga.status).toBe("cancelada");
  });
  it("mudar o preço do plano atualiza as assinaturas em aberto", async () => {
    await comPreco(); await novo();
    await s.atualizarPlano("escritorio", { preco_centavos: 24900 });
    expect(prov.chamadas).toContain("valor:sub_1:24900");
  });
  it("provisionamento: nova instância gera chave de dados e não a armazena; rotação só traz as linhas de licença", async () => {
    const r = await novo();
    const p = s.provisionamento(r.escritorio.id, r.chave, { novaInstancia: true, porta: 3411, chavePublicaPem: par.publica });
    expect(p.env).toMatch(/OFFICE_ID=sales/); expect(p.env).toMatch(/PORT=3411/); expect(p.env).toMatch(/ENCRYPTION_KEY=[0-9a-f]{64}/);
    expect(p.env).toContain(`LICENSE_KEY=${r.chave}`); expect(p.env).toContain("APP_URL=https://sales.disparazap.exemplo.com.br");
    expect(Buffer.from(p.env.match(/LICENSE_PUBLIC_KEY_B64=(\S+)/)![1], "base64").toString()).toBe(par.publica);
    expect(p.nginx).toContain("proxy_pass http://127.0.0.1:3411");
    const chaveDados = p.env.match(/ENCRYPTION_KEY=(\w+)/)![1];
    expect(JSON.stringify(db.prepare("SELECT * FROM escritorios").all())).not.toContain(chaveDados);
    const rot = s.provisionamento(r.escritorio.id, r.chave, { novaInstancia: false, chavePublicaPem: par.publica });
    expect(rot.env).not.toMatch(/ENCRYPTION_KEY/); expect(rot.env).toContain("LICENSE_KEY=");
  });
});

describe("API HTTP do painel", () => {
  let db: ReturnType<typeof abrirBancoPainel>; let server: Server; let base: string; let prov: ProvedorFalso;
  beforeEach(async () => {
    db = abrirBancoPainel(":memory:"); prov = new ProvedorFalso();
    await garantirAdmin(db, cfg);
    const servico = new ServicoPainel(db, cfg, prov, par.privada);
    server = criarAppPainel({ db, cfg, servico, chavePublicaPem: par.publica, versao: "test", webDir: __dirname }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => { server.close(); db.close(); });
  const entrar = async () => {
    const r = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: "admin", senha: "senha-forte-12345" }) });
    return { r, cookie: (r.headers.get("set-cookie") || "").split(";")[0] };
  };
  const adm = (cookie: string, metodo: string, caminho: string, corpo?: unknown) => fetch(`${base}/api/admin${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", Cookie: cookie, "X-Requested-With": "painel" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });

  it("exige sessão, rejeita senha errada e cabeçalho anti-CSRF ausente", async () => {
    expect((await fetch(`${base}/api/admin/escritorios`)).status).toBe(401);
    const ruim = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: "admin", senha: "errada" }) });
    expect(ruim.status).toBe(401);
    const { r, cookie } = await entrar();
    expect(r.status).toBe(200); expect(r.headers.get("set-cookie")).toMatch(/HttpOnly/i); expect(r.headers.get("set-cookie")).toMatch(/SameSite=Strict/i);
    expect((await fetch(`${base}/api/admin/escritorios`, { headers: { Cookie: cookie } })).status).toBe(200);
    const semCabecalho = await fetch(`${base}/api/admin/planos`, { method: "POST", headers: { "Content-Type": "application/json", Cookie: cookie }, body: JSON.stringify({ nome: "X", preco_centavos: 0 }) });
    expect(semCabecalho.status).toBe(403);
    await adm(cookie, "POST", "/logout", {});
    expect((await fetch(`${base}/api/admin/escritorios`, { headers: { Cookie: cookie } })).status).toBe(401);
  });
  it("fluxo completo: criar escritório, instância obtém licença, suspensão reflete na próxima verificação", async () => {
    const { cookie } = await entrar();
    const criado = await (await adm(cookie, "POST", "/escritorios", { nome: "Escritório Teste", slug: "teste", email: "t@t.com", porta: 3405 })).json() as { chave: string; provisionamento: { env: string }; escritorio: { id: string } };
    expect(criado.provisionamento.env).toContain("PORT=3405");
    const verificar = (chave: string) => fetch(`${base}/api/v1/licenca/verificar`, { method: "POST", headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" }, body: JSON.stringify({ versao: "2.61.0" }) });
    expect((await verificar("dz_chave_errada_chave_errada_x")).status).toBe(401);
    const ok = await verificar(criado.chave); expect(ok.status).toBe(200);
    const { token } = await ok.json() as { token: string };
    expect(verificarLicenca(token, par.publica)).toMatchObject({ slug: "teste", status: "teste" });
    await adm(cookie, "POST", `/escritorios/${criado.escritorio.id}/suspender`, {});
    const t2 = (await (await verificar(criado.chave)).json() as { token: string }).token;
    expect(avaliarLicenca(verificarLicenca(t2, par.publica)!)).toMatchObject({ status: "suspensa", restrito: true });
    const cfgResp = await (await adm(cookie, "GET", "/config")).json() as { chave_publica: string; webhook_url: string };
    expect(cfgResp.chave_publica).toBe(par.publica); expect(cfgResp.webhook_url).toBe("https://painel.exemplo.com.br/webhooks/asaas");
  });
  it("webhook do Asaas exige o token do cabeçalho e atualiza o pagamento", async () => {
    const { cookie } = await entrar();
    await adm(cookie, "PUT", "/planos/escritorio", { preco_centavos: 19900 });
    const c = await (await adm(cookie, "POST", "/escritorios", { nome: "Cliente", slug: "cliente", email: "c@c.com" })).json() as { escritorio: { id: string } };
    const corpo = JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1", subscription: "sub_1", value: 199, dueDate: "2026-12-15", paymentDate: "2026-12-14" } });
    const chamar = (token?: string) => fetch(`${base}/webhooks/asaas`, { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { "asaas-access-token": token } : {}) }, body: corpo });
    expect((await chamar()).status).toBe(401);
    expect((await chamar("x".repeat(40))).status).toBe(401);
    expect((await chamar("w".repeat(40))).status).toBe(200);
    const e = await (await adm(cookie, "GET", `/escritorios/${c.escritorio.id}`)).json() as { pago_ate: string };
    expect(e.pago_ate).toBe("2027-01-15");
  });
});
