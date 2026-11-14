import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { salvarConfigAsaas } from "../src/services/gestao/asaas";
import { cobrancaParaOAtendimento } from "../src/services/gestao/cobrancaPeloAtendimento";
import { ErroGestao } from "../src/services/gestao/erro";

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
  it("acha o cliente pelo telefone, gera boleto+PIX da parcela mais antiga e devolve link, PIX, linha e PDF", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973");
    const id = lanc(a, "2999-12-10"); lanc(a, "2999-12-20");
    const r = await cobrancaParaOAtendimento({ telefone: "5513974045973" }, falso());
    expect(r).toMatchObject({ lancamento_id: id, valor_centavos: 5000, link: "https://asaas/i/1", pix: "000201PIX", linha_digitavel: "23793.38128 60000.000003", outras_em_aberto: 1 });
    expect(r.boleto_pdf_base64).toBeTruthy();
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
  it("PDF indisponível: devolve o motivo em frase; PIX que não veio na criação é buscado de novo", async () => {
    const a = pessoa("EDUARDO", "(13) 97404-5973"); lanc(a);
    let pixCalls = 0;
    const http = (async (url: string, init?: RequestInit) => {
      const u = String(url), m = String(init?.method ?? "GET");
      const j = (o: unknown) => new Response(JSON.stringify(o), { status: 200 });
      if (u.includes("/customers") && m === "GET") return j({ data: [] });
      if (u.includes("/customers")) return j({ id: "cus_1" });
      if (u.endsWith("/payments") && m === "POST") return j({ id: "pay_1", status: "PENDING", invoiceUrl: "https://sandbox.asaas.com/i/abc123", bankSlipUrl: "https://sandbox.asaas.com/b/pdf/abc123", billingType: "UNDEFINED" });
      if (/\/payments\/pay_1$/.test(u)) return j({ id: "pay_1" });
      if (u.includes("pixQrCode")) { pixCalls++; return pixCalls < 3 ? new Response("{}", { status: 404 }) : j({ payload: "000201PIX" }); }
      if (u.includes("identificationField")) return j({ identificationField: "23793" });
      if (u.includes("/b/pdf/")) return new Response("<html>aguarde</html>", { status: 200 });
      return j({});
    }) as unknown as typeof fetch;
    const r = await cobrancaParaOAtendimento({ telefone: "5513974045973" }, http, { esperaMs: 0 });
    expect(r.pix).toBe("000201PIX");
    expect(r.boleto_pdf_base64).toBeNull();
    expect(r.boleto_pdf_motivo).toMatch(/não devolveu um PDF/);
  });
});
