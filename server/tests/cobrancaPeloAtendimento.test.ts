import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { salvarConfigAsaas } from "../src/services/gestao/asaas";
import { cobrancaParaOAtendimento, complementoDaCobranca } from "../src/services/gestao/cobrancaPeloAtendimento";
import { ErroGestao } from "../src/services/gestao/erro";
import { descreverFalhaDeRede } from "../src/services/gestao/asaas";

const pessoa = (nome: string, tel: string) => Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,documento,telefone,email) VALUES (?,'cliente','52998224725',?,'a@x.com')").run(nome, tel).lastInsertRowid);
const lanc = (p: number, venc = "2999-12-10", valor = 5000) => Number(db.prepare("INSERT INTO gestao_lancamentos(tipo,categoria,descricao,valor_centavos,vencimento,pessoa_id) VALUES ('receber','honorarios','Honorários 1/3',?,?,?)").run(valor, venc, p).lastInsertRowid);
const PDF = Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(400, 65)]);
function falso() {
  return (async (url: string, init?: RequestInit) => {
    const u = String(url), m = String(init?.method ?? "GET");
    const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
    if (u.includes("/customers") && m === "GET") return j({ data: [] });
    if (u.includes("/customers")) return j({ id: "cus_1" });
    if (u.endsWith("/payments") && m === "POST") return j({ id: "pay_1", status: "PENDING", invoiceUrl: "https://asaas/i/1", bankSlipUrl: "https://www.asaas.com/b/1", billingType: "UNDEFINED" });
    if (u.includes("pixQrCode")) return j({ payload: "000201PIX" });
    if (u.includes("identificationField")) return j({ identificationField: "23793.38128 60000.000003" });
    if (u === "https://www.asaas.com/b/1") return new Response(PDF, { status: 200 });
    return j({});
  }) as unknown as typeof fetch;
}

beforeEach(() => {
  db.exec("DELETE FROM gestao_asaas_cobrancas; DELETE FROM gestao_asaas_clientes; DELETE FROM gestao_lancamentos_historico; DELETE FROM gestao_lancamentos; DELETE FROM gestao_pessoas;");
  db.prepare("DELETE FROM settings WHERE chave LIKE 'asaas_%'").run();
  salvarConfigAsaas({ chave: "$aact_chave_de_teste_1234567890abcdef", ambiente: "sandbox" });
});

describe("cobrança pedida pelo atendimento", () => {
  it("acha o cliente pelo telefone e gera boleto+PIX da parcela PEDIDA (aqui, pelo vencimento), devolvendo link, PIX, linha e PDF", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973");
    lanc(a, "2999-12-10"); const segunda = lanc(a, "2999-12-20");
    const r = await cobrancaParaOAtendimento({ telefone: "5513974045973", vencimento: "2999-12-20" }, falso());
    expect(r).toMatchObject({ lancamento_id: segunda, valor_centavos: 5000, link: "https://asaas/i/1", pix: "000201PIX", linha_digitavel: "23793.38128 60000.000003", outras_em_aberto: 1 });
    expect(r.boleto_pdf_base64).toBeTruthy();
  });
  it("com mais de uma parcela em aberto e sem dizer qual, NÃO escolhe: lista as opções para o atendimento perguntar (e nada é gerado)", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973");
    lanc(a, "2999-12-10", 5000); lanc(a, "2999-12-20", 1000);
    await expect(cobrancaParaOAtendimento({ telefone: "5513974045973" }, falso())).rejects.toThrow(/2 parcelas em aberto: R\$\s?50,00 \(venc\. 10\/12\/2999\); R\$\s?10,00 \(venc\. 20\/12\/2999\)\. Pergunte/);
    expect(Number((db.prepare("SELECT COUNT(*) n FROM gestao_asaas_cobrancas").get() as { n: number }).n)).toBe(0);
  });
  it("o cliente pediu a de R$ 10: gera ESSA e não a de R$ 50 (o caso da conversa de teste)", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973");
    lanc(a, "2020-01-10", 5000); const dez = lanc(a, "2999-12-20", 1000);
    db.prepare("INSERT INTO gestao_asaas_cobrancas(lancamento_id,payment_id,billing_type,status,invoice_url,valor_centavos,vencimento) VALUES (1,'pay_velha','UNDEFINED','OVERDUE','https://sandbox.asaas.com/i/velha',5000,'2020-01-10')").run();
    const r = await cobrancaParaOAtendimento({ telefone: "5513974045973", valor_centavos: 1000 }, falso());
    expect(r.lancamento_id).toBe(dez);
    expect(r.valor_centavos).toBe(1000);
  });
  it("valor ou data que não batem com nenhuma parcela: recusa listando o que existe; data inválida também", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973");
    lanc(a, "2999-12-10", 5000); lanc(a, "2999-12-20", 1000);
    await expect(cobrancaParaOAtendimento({ telefone: "5513974045973", valor_centavos: 7777 }, falso())).rejects.toThrow(/Não achei parcela.*Em aberto: R\$\s?50,00/);
    await expect(cobrancaParaOAtendimento({ telefone: "5513974045973", vencimento: "amanhã" }, falso())).rejects.toThrow(/inválida/);
  });
  it("duas parcelas do mesmo valor: pede o vencimento; com o vencimento (dd/mm) resolve", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973");
    const ano = new Date().getFullYear() + 1; // vencimento futuro, para poder gerar
    const v1 = `${ano}-03-10`, v2 = `${ano}-04-10`;
    lanc(a, v1, 5000); const segunda = lanc(a, v2, 5000);
    await expect(cobrancaParaOAtendimento({ telefone: "5513974045973", valor_centavos: 5000 }, falso())).rejects.toThrow(/Mais de uma parcela combina/);
    const r = await cobrancaParaOAtendimento({ telefone: "5513974045973", valor_centavos: 5000, vencimento: `10/04/${ano}` }, falso());
    expect(r.lancamento_id).toBe(segunda);
  });
  it("não gera cobrança para parcela de outro cliente nem sem cadastro; vencida pede a equipe", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973"), b = pessoa("OUTRO", "(11) 98888-0000");
    const dele = lanc(b);
    await expect(cobrancaParaOAtendimento({ telefone: "5513974045973", lancamento_id: dele }, falso())).rejects.toThrow(/não é deste cliente|em aberto/);
    await expect(cobrancaParaOAtendimento({ telefone: "5599900000000" }, falso())).rejects.toBeInstanceOf(ErroGestao);
    lanc(a, "2020-01-10");
    await expect(cobrancaParaOAtendimento({ telefone: "5513974045973" }, falso())).rejects.toThrow(/vencida/);
  });
  it("sem Asaas configurado, recusa com mensagem clara", async () => {
    db.prepare("DELETE FROM settings WHERE chave LIKE 'asaas_%'").run();
    pessoa("EDUARDO", "(13) 97404-5973");
    await expect(cobrancaParaOAtendimento({ telefone: "5513974045973" }, falso())).rejects.toThrow(/não está configurada/);
  });
  it("acha o cliente mesmo com telefone gravado sem o 55 e sem o 9º dígito, e com dois cadastros de mesmo número", async () => {
    pessoa("EDUARDO", "(13) 7404-5973"); const b = pessoa("EDUARDO DUPLICADO", "(13) 97404-5973");
    const id = lanc(b);
    const r = await cobrancaParaOAtendimento({ telefone: "+5513974045973" }, falso());
    expect(r.lancamento_id).toBe(id);
  });
  it("cliente sem CPF no cadastro: usa o CPF que ele informou no atendimento (se válido e livre) e gera a cobrança", async () => {
    const a = Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,documento,telefone,email) VALUES ('EDUARDO','cliente','','(13) 97404-5973','a@x.com')").run().lastInsertRowid);
    lanc(a);
    await expect(cobrancaParaOAtendimento({ telefone: "5513974045973" }, falso())).rejects.toThrow(/CPF ou CNPJ/);
    const r = await cobrancaParaOAtendimento({ telefone: "5513974045973", cpf: "529.982.247-25" }, falso());
    expect(r.link).toBe("https://asaas/i/1");
    expect((db.prepare("SELECT documento FROM gestao_pessoas WHERE id=?").get(a) as { documento: string }).documento).toBe("52998224725");
  });
  it("não troca um CPF que já existe nem aceita CPF de outro cadastro ou inválido", async () => {
    const a = pessoa("COM CPF", "(13) 97404-5973");
    lanc(a);
    await cobrancaParaOAtendimento({ telefone: "5513974045973", cpf: "111.444.777-35" }, falso());
    expect((db.prepare("SELECT documento FROM gestao_pessoas WHERE id=?").get(a) as { documento: string }).documento).toBe("52998224725");
    const b = Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,documento,telefone,email) VALUES ('SEM','cliente','','(11) 98888-0000','b@x.com')").run().lastInsertRowid);
    lanc(b);
    await expect(cobrancaParaOAtendimento({ telefone: "5511988880000", cpf: "52998224725" }, falso())).rejects.toThrow(/outro cadastro/);
    await expect(cobrancaParaOAtendimento({ telefone: "5511988880000", cpf: "123" }, falso())).rejects.toThrow(/CPF ou CNPJ/);
  });
  it("sem `bankSlipUrl`: baixa o PDF pelo endereço derivado da página da cobrança e diz o motivo quando não consegue", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973"); lanc(a);
    const http = (async (url: string, init?: RequestInit) => {
      const u = String(url), m = String(init?.method ?? "GET");
      const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (u.includes("/customers") && m === "GET") return j({ data: [] });
      if (u.includes("/customers")) return j({ id: "cus_1" });
      if (u.endsWith("/payments") && m === "POST") return j({ id: "pay_1", status: "PENDING", invoiceUrl: "https://sandbox.asaas.com/i/abc123", billingType: "UNDEFINED" });
      if (/\/payments\/pay_1$/.test(u)) return j({ id: "pay_1" });
      if (u.includes("pixQrCode")) return j({ payload: "000201PIX" });
      if (u.includes("identificationField")) return j({ identificationField: "23793" });
      if (u === "https://sandbox.asaas.com/b/pdf/abc123") return new Response(PDF, { status: 200 });
      return j({});
    }) as unknown as typeof fetch;
    const r = await cobrancaParaOAtendimento({ telefone: "5513974045973" }, http, { esperaMs: 0 });
    expect(r.boleto_pdf_base64).toBeTruthy();
    expect(r.boleto_pdf_motivo).toBeNull();
  });
  it("modo rápido devolve o link na hora e marca `pendente` quando falta PIX/PDF; o modo paciente completa depois, sem criar outra cobrança", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973"); lanc(a);
    let pronto = false; let pagamentos = 0;
    const http = (async (url: string, init?: RequestInit) => {
      const u = String(url), m = String(init?.method ?? "GET");
      const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (u.includes("/customers") && m === "GET") return j({ data: [] });
      if (u.includes("/customers")) return j({ id: "cus_1" });
      if (u.endsWith("/payments") && m === "POST") { pagamentos++; return j({ id: "pay_1", status: "PENDING", invoiceUrl: "https://sandbox.asaas.com/i/abc123", bankSlipUrl: "https://sandbox.asaas.com/b/pdf/abc123", billingType: "UNDEFINED" }); }
      if (/\/payments\/pay_1$/.test(u)) return j({ id: "pay_1" });
      if (u.includes("pixQrCode")) return pronto ? j({ payload: "000201PIX" }) : new Response("{}", { status: 404 });
      if (u.includes("identificationField")) return j({ identificationField: "23793" });
      if (u.includes("/b/pdf/")) return pronto ? new Response(PDF, { status: 200 }) : new Response("<html>aguarde</html>", { status: 200 });
      return j({});
    }) as unknown as typeof fetch;
    const r1 = await cobrancaParaOAtendimento({ telefone: "5513974045973" }, http, { esperaMs: 0 });
    expect(r1).toMatchObject({ link: "https://sandbox.asaas.com/i/abc123", linha_digitavel: "23793", pix: "", pendente: true });
    expect(r1.boleto_pdf_base64).toBeNull();
    expect(r1.boleto_pdf_motivo).toMatch(/não devolveu um PDF/);
    pronto = true;
    const r2 = await complementoDaCobranca({ telefone: "5513974045973" }, http, { esperaMs: 0 });
    expect(r2).toMatchObject({ pix: "000201PIX", pendente: false });
    expect(r2.boleto_pdf_base64).toBeTruthy();
    expect(pagamentos).toBe(1); // a cobrança é a MESMA: o complemento não cria outra
  });
  it("o complemento só atende o cliente do telefone e só de cobrança já gerada", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973"), b = Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,documento,telefone,email) VALUES ('OUTRO','cliente','11144477735','(11) 98888-0000','b@x.com')").run().lastInsertRowid);
    lanc(a); const dele = lanc(b);
    await expect(complementoDaCobranca({ telefone: "5513974045973" }, falso())).rejects.toThrow(/ainda não tem cobrança/);
    await expect(complementoDaCobranca({ telefone: "5513974045973", lancamento_id: dele }, falso())).rejects.toThrow(/não é deste cliente/);
    await expect(complementoDaCobranca({ telefone: "5599900000000" }, falso())).rejects.toBeInstanceOf(ErroGestao);
  });
  it("Asaas lento: não passa de ~20 s no total — devolve o link e diz o motivo, em vez de estourar o limite do servidor", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973"); lanc(a);
    const http = (async (url: string, init?: RequestInit) => {
      const u = String(url), m = String(init?.method ?? "GET");
      const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (u.includes("/customers") && m === "GET") return j({ data: [] });
      if (u.includes("/customers")) return j({ id: "cus_1" });
      if (u.endsWith("/payments") && m === "POST") return j({ id: "pay_1", status: "PENDING", invoiceUrl: "https://sandbox.asaas.com/i/abc123", billingType: "UNDEFINED" });
      if (u.includes("pixQrCode") || u.includes("identificationField") || u.includes("/b/pdf/") || /\/payments\/pay_1$/.test(u)) return new Promise<Response>((_, rej) => { init?.signal?.addEventListener("abort", () => rej(new Error("abortado"))); /* nunca responde: só o tempo limite encerra, como num fetch de verdade */ });
      return j({});
    }) as unknown as typeof fetch;
    const t0 = Date.now();
    const r = await cobrancaParaOAtendimento({ telefone: "5513974045973" }, http, { esperaMs: 0, limiteTotalMs: 300, limiteDosDetalhesMs: 100, limitePorConsultaMs: 100 });
    expect(Date.now() - t0).toBeLessThan(3000);
    expect(r.link).toBe("https://sandbox.asaas.com/i/abc123");
    expect(r.boleto_pdf_base64).toBeNull();
    expect(r.boleto_pdf_motivo).toMatch(/demorou|não consegui baixar/);
    expect(r.pix_motivo).toMatch(/Asaas/);
  });
  it("PIX recusado pelo Asaas (conta sem chave PIX): o motivo do Asaas vem escrito, e o PDF sai mesmo assim (buscas em paralelo)", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973"); lanc(a);
    const http = (async (url: string, init?: RequestInit) => {
      const u = String(url), m = String(init?.method ?? "GET");
      const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (u.includes("/customers") && m === "GET") return j({ data: [] });
      if (u.includes("/customers")) return j({ id: "cus_1" });
      if (u.endsWith("/payments") && m === "POST") return j({ id: "pay_1", status: "PENDING", invoiceUrl: "https://sandbox.asaas.com/i/abc123", bankSlipUrl: "https://sandbox.asaas.com/b/pdf/abc123", billingType: "UNDEFINED" });
      if (/\/payments\/pay_1$/.test(u)) return j({ id: "pay_1" });
      if (u.includes("pixQrCode")) return new Response(JSON.stringify({ errors: [{ description: "Você não possui uma chave Pix cadastrada." }] }), { status: 400 });
      if (u.includes("identificationField")) return j({ identificationField: "23793" });
      if (u.includes("/b/pdf/")) return new Response(PDF, { status: 200 });
      return j({});
    }) as unknown as typeof fetch;
    const r = await cobrancaParaOAtendimento({ telefone: "5513974045973" }, http, { esperaMs: 0 });
    expect(r.pix).toBe("");
    expect(r.pix_motivo).toMatch(/chave Pix/);
    expect(r.boleto_pdf_base64).toBeTruthy();
  });
  it("a falha de rede diz a causa: tempo esgotado, código do sistema ou a mensagem", () => {
    expect(descreverFalhaDeRede(Object.assign(new Error("x"), { name: "TimeoutError" }), 10_000)).toBe("sem resposta em 10 s");
    expect(descreverFalhaDeRede(Object.assign(new Error("fetch failed"), { cause: { code: "ENOTFOUND" } }))).toBe("ENOTFOUND");
    expect(descreverFalhaDeRede(new Error("boom"))).toBe("boom");
  });
});
