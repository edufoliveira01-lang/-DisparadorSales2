import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { conferirCobrancasAbertas, sincronizarExtratoAuto, cobrancaDoLancamento, gerarCobranca, processarWebhook, salvarConfigAsaas, sincronizarCobrancasAlteradas, sincronizarExtrato, taxasDoAsaas, tokenDoWebhook, ErroAsaas, cancelarCobranca } from "../src/services/gestao/asaas";
import { historicoDoLancamento } from "../src/services/gestao/financeiro";

const CPF = "52998224725";
const pessoa = (doc = CPF) => Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,documento,telefone,email) VALUES ('Maria Souza','cliente',?, '(13) 99999-1111','maria@x.com')").run(doc).lastInsertRowid);
const lanc = (p: number, valor = 100000, venc = "2999-12-10") => Number(db.prepare("INSERT INTO gestao_lancamentos(tipo,categoria,descricao,valor_centavos,vencimento,pessoa_id) VALUES ('receber','honorarios','Honorários 1/3',?,?,?)").run(valor, venc, p).lastInsertRowid);

type Chamada = { metodo: string; url: string; corpo: Record<string, unknown> | null; chave: string };
function falso(respostas: Record<string, unknown> = {}) {
  const chamadas: Chamada[] = [];
  const http = (async (url: string, init: RequestInit) => {
    const metodo = String(init.method), caminho = String(url).replace(/^https:\/\/[^/]+\/v3/, "");
    chamadas.push({ metodo, url: caminho, corpo: init.body ? JSON.parse(String(init.body)) : null, chave: String((init.headers as Record<string, string>).access_token) });
    const chave = `${metodo} ${caminho.split("?")[0]}`;
    const r = respostas[chave] ?? respostas[`${metodo} *`];
    if (r instanceof Response) return r;
    return new Response(JSON.stringify(r ?? {}), { status: 200 });
  }) as unknown as typeof fetch;
  return { http, chamadas };
}
const padrao = (extra: Record<string, unknown> = {}) => ({
  "GET /customers": { data: [] }, "POST /customers": { id: "cus_1" },
  "POST /payments": { id: "pay_1", status: "PENDING", invoiceUrl: "https://asaas/i/1", bankSlipUrl: "https://asaas/b/1", billingType: "UNDEFINED" },
  "GET /payments/pay_1/pixQrCode": { payload: "000201PIX" }, "GET /payments/pay_1/identificationField": { identificationField: "23793.38128 60000.000003" }, ...extra,
});

beforeEach(() => {
  db.exec("DELETE FROM gestao_asaas_cobrancas; DELETE FROM gestao_asaas_clientes; DELETE FROM gestao_asaas_extrato; DELETE FROM gestao_lancamentos_historico; DELETE FROM gestao_lancamentos; DELETE FROM gestao_pessoas;");
  db.prepare("DELETE FROM settings WHERE chave LIKE 'asaas_%'").run();
  salvarConfigAsaas({ chave: "$aact_chave_de_teste_1234567890abcdef", ambiente: "sandbox" });
});

describe("Asaas — cobrança", () => {
  it("cria o cliente (com CPF), a cobrança com valor/data da parcela e guarda link, linha digitável e PIX", async () => {
    const id = lanc(pessoa());
    const f = falso(padrao());
    const c = await gerarCobranca(id, "boleto_pix", { id: null, nome: "Camila" }, f.http);
    expect(c).toMatchObject({ payment_id: "pay_1", invoice_url: "https://asaas/i/1", linha_digitavel: "23793.38128 60000.000003", pix_payload: "000201PIX", valor_centavos: 100000, status: "PENDING" });
    const pagamento = f.chamadas.find((x) => x.metodo === "POST" && x.url === "/payments")!;
    expect(pagamento.corpo).toMatchObject({ customer: "cus_1", billingType: "UNDEFINED", value: 1000, dueDate: "2999-12-10", externalReference: `lanc_${id}` });
    expect(f.chamadas.find((x) => x.url === "/customers" && x.metodo === "POST")!.corpo).toMatchObject({ cpfCnpj: CPF, notificationDisabled: true, mobilePhone: "13999991111" });
    expect(f.chamadas.every((x) => x.chave === "$aact_chave_de_teste_1234567890abcdef")).toBe(true);
    expect(historicoDoLancamento(id)[0]).toMatchObject({ acao: "cobranca_gerada" });
    // segunda chamada devolve a mesma cobrança, sem criar outra
    const f2 = falso(padrao());
    expect((await gerarCobranca(id, "pix", undefined, f2.http)).payment_id).toBe("pay_1");
    expect(f2.chamadas).toHaveLength(0);
  });
  it("recusa sem CPF/CNPJ, sem cliente, vencida ou já paga", async () => {
    await expect(gerarCobranca(lanc(pessoa("")), "pix", undefined, falso(padrao()).http)).rejects.toThrow(/CPF ou CNPJ/);
    await expect(gerarCobranca(lanc(pessoa(), 1000, "2020-01-10"), "pix", undefined, falso(padrao()).http)).rejects.toThrow(/Nova data/);
    const pago = lanc(pessoa()); db.prepare("UPDATE gestao_lancamentos SET pago_em='2026-01-01' WHERE id=?").run(pago);
    await expect(gerarCobranca(pago, "pix", undefined, falso(padrao()).http)).rejects.toThrow(/em aberto/);
  });
  it("chave recusada e erro do Asaas viram mensagem clara", async () => {
    const id = lanc(pessoa());
    await expect(gerarCobranca(id, "pix", undefined, falso({ "GET /customers": new Response("{}", { status: 401 }) }).http)).rejects.toThrow(/recusou a chave/);
    await expect(gerarCobranca(id, "pix", undefined, falso({ ...padrao(), "POST /payments": new Response(JSON.stringify({ errors: [{ description: "Valor mínimo é R$ 5,00" }] }), { status: 400 }) }).http)).rejects.toThrow(/Valor mínimo/);
  });
});

describe("Asaas — aviso de pagamento (webhook)", () => {
  it("token errado é recusado; pagamento dá baixa na parcela, guarda a taxa e repetir não duplica", async () => {
    const id = lanc(pessoa()); await gerarCobranca(id, "boleto_pix", undefined, falso(padrao()).http);
    const evento = { event: "PAYMENT_RECEIVED", payment: { id: "pay_1", status: "RECEIVED", value: 1000, netValue: 998.01, billingType: "PIX", paymentDate: "2026-11-10", externalReference: `lanc_${id}` } };
    expect(() => processarWebhook("errado", evento)).toThrow(ErroAsaas);
    expect(processarWebhook(tokenDoWebhook(), evento)).toEqual({ ok: true, tratado: true });
    const l = db.prepare("SELECT pago_em,valor_pago_centavos,forma_pagamento FROM gestao_lancamentos WHERE id=?").get(id);
    expect(l).toEqual({ pago_em: "2026-11-10", valor_pago_centavos: 100000, forma_pagamento: "PIX" });
    expect(cobrancaDoLancamento(id)).toMatchObject({ status: "RECEIVED", taxa_centavos: 199, liquido_centavos: 99801, forma_paga: "PIX" });
    expect(processarWebhook(tokenDoWebhook(), evento).tratado).toBe(true);
    expect(historicoDoLancamento(id).filter((h: any) => h.acao === "pago_asaas")).toHaveLength(1); // a baixa só ocorre uma vez, mesmo com o aviso repetido
    expect(db.prepare("SELECT COUNT(*) n FROM gestao_lancamentos").get()).toEqual({ n: 1 });
  });
  it("evento de cobrança desconhecida é aceito sem fazer nada", () => {
    expect(processarWebhook(tokenDoWebhook(), { event: "PAYMENT_RECEIVED", payment: { id: "outra" } })).toEqual({ ok: true, tratado: false });
  });
});

describe("Asaas — mudanças na parcela acompanham a cobrança", () => {
  it("nova data/valor atualiza a cobrança; cancelar a parcela cancela lá", async () => {
    const id = lanc(pessoa()); await gerarCobranca(id, "boleto_pix", undefined, falso(padrao()).http);
    db.prepare("UPDATE gestao_lancamentos SET vencimento='2999-12-20', valor_centavos=90000 WHERE id=?").run(id);
    const f = falso({ "PUT /payments/pay_1": {} });
    expect(await sincronizarCobrancasAlteradas(f.http)).toBe(1);
    expect(f.chamadas[0]).toMatchObject({ metodo: "PUT", url: "/payments/pay_1", corpo: { value: 900, dueDate: "2999-12-20" } });
    expect(cobrancaDoLancamento(id)).toMatchObject({ vencimento: "2999-12-20", valor_centavos: 90000 });
    db.prepare("UPDATE gestao_lancamentos SET cancelado=1 WHERE id=?").run(id);
    const f2 = falso({ "DELETE /payments/pay_1": {} });
    await sincronizarCobrancasAlteradas(f2.http);
    expect(f2.chamadas[0]).toMatchObject({ metodo: "DELETE" });
    expect(cobrancaDoLancamento(id)!.status).toBe("CANCELADA");
    await cancelarCobranca(id, undefined, falso().http); // já cancelada: não faz nada
  });
});

describe("Asaas — taxas", () => {
  it("sincroniza o extrato (com paginação) e separa por tipo de taxa; calcula % do recebido e custo por cobrança", async () => {
    const id = lanc(pessoa()); await gerarCobranca(id, "boleto_pix", undefined, falso(padrao()).http);
    processarWebhook(tokenDoWebhook(), { event: "PAYMENT_RECEIVED", payment: { id: "pay_1", status: "RECEIVED", value: 1000, netValue: 998.01, billingType: "PIX", paymentDate: "2026-11-10" } });
    const pagina1 = { data: [{ id: "t1", value: -1.99, type: "PAYMENT_FEE", date: "2026-11-10", description: "Taxa de PIX", paymentId: "pay_1" }, { id: "t2", value: -0.99, type: "PAYMENT_MESSAGING_NOTIFICATION_FEE", date: "2026-11-11", description: "WhatsApp" }], hasMore: true };
    const pagina2 = { data: [{ id: "t3", value: 998.01, type: "PAYMENT_RECEIVED", date: "2026-11-10", description: "Cobrança recebida" }], hasMore: false };
    let n = 0;
    const http = (async () => new Response(JSON.stringify(n++ === 0 ? pagina1 : pagina2), { status: 200 })) as unknown as typeof fetch;
    expect(await sincronizarExtrato("2026-11-01", "2026-11-30", http)).toEqual({ lidos: 3 });
    const t = taxasDoAsaas("2026-11-01", "2026-11-30");
    expect(t).toMatchObject({ total_centavos: 298, origem: "extrato", cobrancas_pagas: 1, recebido_centavos: 100000, taxa_por_cobranca_centavos: 298 });
    expect(t.percentual_do_recebido).toBe(0.3);
    expect(t.por_tipo.map((x) => [x.tipo, x.total_centavos])).toEqual([["PAYMENT_FEE", 199], ["PAYMENT_MESSAGING_NOTIFICATION_FEE", 99]]);
    expect(t.por_tipo[1]!.rotulo).toMatch(/Notificações/);
    expect(t.por_forma).toEqual([{ forma: "PIX", pagas: 1, recebido_centavos: 100000, taxa_centavos: 199 }]);
    expect(t.linhas).toHaveLength(2);
  });
  it("sem extrato sincronizado, usa a diferença entre o valor cobrado e o líquido de cada cobrança paga", async () => {
    const id = lanc(pessoa()); await gerarCobranca(id, "boleto_pix", undefined, falso(padrao()).http);
    processarWebhook(tokenDoWebhook(), { event: "PAYMENT_RECEIVED", payment: { id: "pay_1", status: "RECEIVED", value: 1000, netValue: 998.01, billingType: "BOLETO", paymentDate: "2026-11-10" } });
    expect(taxasDoAsaas("2026-11-01", "2026-11-30")).toMatchObject({ total_centavos: 199, origem: "cobrancas" });
  });
});

describe("Asaas — configuração", () => {
  it("aceita a chave colada com aspas ou com o nome do cabeçalho; recusa lixo; o token do aviso é gerado uma vez", () => {
    salvarConfigAsaas({ chave: 'access_token: "$aact_outra_chave_de_teste_1234567890"' });
    expect(() => salvarConfigAsaas({ chave: "curta" })).toThrow(/inválida/);
    expect(() => salvarConfigAsaas({ ambiente: "qualquer" })).toThrow(/Ambiente/);
    expect(tokenDoWebhook()).toBe(tokenDoWebhook());
    expect(tokenDoWebhook()).toHaveLength(48);
  });
});

describe("Asaas — atualização automática das taxas", () => {
  it("guarda a taxa prevista ao gerar, dá baixa e fixa a taxa efetiva ao conferir, sem ninguém clicar", async () => {
    const id = lanc(pessoa());
    const f = falso(padrao({ "POST /payments": { id: "pay_1", status: "PENDING", invoiceUrl: "https://asaas/i/1", bankSlipUrl: "https://asaas/b/1", billingType: "UNDEFINED", value: 1000, netValue: 999.01 } }));
    await gerarCobranca(id, "boleto_pix", undefined, f.http);
    expect(cobrancaDoLancamento(id)!.taxa_prevista_centavos).toBe(99);
    expect(taxasDoAsaas("2000-01-01", "2999-12-31").previstas).toEqual({ cobrancas: 1, taxa_centavos: 99 });
    // o Asaas passa a cobrar a tarifa padrão no pagamento: vale a efetiva, que vem na própria cobrança
    const f2 = falso({ "GET /payments/pay_1": { id: "pay_1", status: "RECEIVED", value: 1000, netValue: 998.01, billingType: "PIX", paymentDate: "2026-11-10" } });
    expect(await conferirCobrancasAbertas(f2.http)).toBe(1);
    expect(cobrancaDoLancamento(id)).toMatchObject({ status: "RECEIVED", taxa_centavos: 199 });
    expect(db.prepare("SELECT pago_em FROM gestao_lancamentos WHERE id=?").get(id)).toMatchObject({ pago_em: expect.any(String) });
    expect(taxasDoAsaas("2000-01-01", "2999-12-31").previstas.cobrancas).toBe(0);
  });
  it("traz o extrato sozinho e registra quando foi a última busca (e o erro, se houver)", async () => {
    const f = falso({ "GET /financialTransactions": { data: [{ id: "t1", value: -1.99, type: "PAYMENT_FEE", date: "2026-11-10", paymentId: "pay_1" }], hasMore: false } });
    expect(await sincronizarExtratoAuto(f.http)).toEqual({ lidos: 1 });
    expect(taxasDoAsaas("2026-11-01", "2026-11-30").total_centavos).toBe(199);
    expect(taxasDoAsaas("2026-11-01", "2026-11-30").sincronizado_em).toBeTruthy();
    const ruim = falso({ "GET /financialTransactions": new Response("{}", { status: 500 }) });
    expect(await sincronizarExtratoAuto(ruim.http)).toBeNull();
    expect(taxasDoAsaas("2026-11-01", "2026-11-30").sincronizacao_erro).toBeTruthy();
  });
});
