import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { atualizarLancamento, baixarLancamento, historicoDoLancamento, listarLancamentos, reprogramarVencimento } from "../src/services/gestao/financeiro";

const pessoa = () => Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo) VALUES ('Cliente','cliente')").run().lastInsertRowid);
const contrato = (p: number) => Number(db.prepare("INSERT INTO gestao_contratos(pessoa_id,descricao,tipo,valor_total_centavos) VALUES (?,?,?,?)").run(p, "Honorários", "fixo", 150000).lastInsertRowid);
const lanc = (p: number, valor: number, venc: string, c: number | null = null, n = 1) =>
  Number(db.prepare("INSERT INTO gestao_lancamentos(tipo,categoria,descricao,valor_centavos,vencimento,pessoa_id,contrato_id,parcela_numero,parcela_total) VALUES ('receber','honorarios','Honorários',?,?,?,?,?,3)").run(valor, venc, p, c, n).lastInsertRowid);
const venc = (id: number) => (db.prepare("SELECT vencimento FROM gestao_lancamentos WHERE id=?").get(id) as { vencimento: string }).vencimento;

beforeEach(() => { db.exec("DELETE FROM gestao_lancamentos_historico; DELETE FROM gestao_lancamentos; DELETE FROM gestao_contratos; DELETE FROM gestao_pessoas;"); });

describe("pagamento parcial", () => {
  it("o cliente paga 500 de 1000: a parcela fecha em 500 e o saldo de 500 vira um lançamento novo no mês seguinte", () => {
    const p = pessoa(); const id = lanc(p, 100000, "2026-11-10");
    const r = baixarLancamento(id, { pago_em: "2026-11-11", valor_pago: "500,00", forma_pagamento: "PIX", restante: "novo" }, { id: null, nome: "Camila" }) as { valor_centavos: number; pago_em: string; saldo: { valor_centavos: number; vencimento: string } };
    expect(r).toMatchObject({ valor_centavos: 50000, pago_em: "2026-11-11", saldo: { valor_centavos: 50000, vencimento: "2026-12-10" } });
    const novo = db.prepare("SELECT * FROM gestao_lancamentos WHERE origem_lancamento_id=?").get(id) as { valor_centavos: number; vencimento: string; pago_em: string | null; pessoa_id: number };
    expect(novo).toMatchObject({ valor_centavos: 50000, vencimento: "2026-12-10", pago_em: null, pessoa_id: p });
    expect(historicoDoLancamento(id)[0]).toMatchObject({ acao: "baixa_parcial", autor: "Camila" });
    expect(listarLancamentos({ status: "pendentes" }).itens).toHaveLength(1);
  });
  it("data do saldo escolhida e opção de só baixar o menor (desconto)", () => {
    const p = pessoa(); const a = lanc(p, 100000, "2026-11-10"); const b = lanc(p, 100000, "2026-11-10");
    baixarLancamento(a, { pago_em: "2026-11-11", valor_pago: "600", restante: "novo", vencimento_restante: "2026-12-30" });
    expect((db.prepare("SELECT vencimento,valor_centavos FROM gestao_lancamentos WHERE origem_lancamento_id=?").get(a))).toEqual({ vencimento: "2026-12-30", valor_centavos: 40000 });
    baixarLancamento(b, { pago_em: "2026-11-11", valor_pago: "800" });
    expect(db.prepare("SELECT COUNT(*) n FROM gestao_lancamentos WHERE origem_lancamento_id=?").get(b)).toEqual({ n: 0 });
  });
  it("pagamento integral continua igual (sem saldo)", () => {
    const p = pessoa(); const id = lanc(p, 100000, "2026-11-10");
    baixarLancamento(id, { pago_em: "2026-11-11" });
    expect(db.prepare("SELECT COUNT(*) n FROM gestao_lancamentos").get()).toEqual({ n: 1 });
  });
});

describe("nova data de vencimento", () => {
  it("muda a data e guarda o motivo no histórico", () => {
    const p = pessoa(); const id = lanc(p, 100000, "2026-11-10");
    reprogramarVencimento(id, { vencimento: "2026-11-25", motivo: "Cliente pediu" }, { id: null, nome: "Camila" });
    expect(venc(id)).toBe("2026-11-25");
    expect(historicoDoLancamento(id)[0]).toMatchObject({ acao: "reprogramado", detalhe: expect.stringContaining("Cliente pediu") });
    expect(() => reprogramarVencimento(id, { vencimento: "2026-11-25" })).toThrow();
  });
  it("com cascata, as parcelas seguintes do contrato andam junto (por mês quando o dia é o mesmo)", () => {
    const p = pessoa(); const c = contrato(p);
    const a = lanc(p, 50000, "2026-11-10", c, 1), b = lanc(p, 50000, "2026-12-10", c, 2), d = lanc(p, 50000, "2027-01-10", c, 3);
    const paga = lanc(p, 1, "2026-10-10", c, 0); baixarLancamento(paga, { pago_em: "2026-10-10" });
    const r = reprogramarVencimento(a, { vencimento: "2026-12-10", cascata: true }) as { parcelas_movidas: number };
    expect(r.parcelas_movidas).toBe(2);
    expect([venc(a), venc(b), venc(d)]).toEqual(["2026-12-10", "2027-01-10", "2027-02-10"]);
  });
  it("sem cascata só a parcela escolhida muda; editar valor/data também fica no histórico", () => {
    const p = pessoa(); const c = contrato(p); const a = lanc(p, 50000, "2026-11-10", c, 1), b = lanc(p, 50000, "2026-12-10", c, 2);
    reprogramarVencimento(a, { vencimento: "2026-11-20" });
    expect(venc(b)).toBe("2026-12-10");
    atualizarLancamento(b, { valor: "600,00", vencimento: "2026-12-15" });
    expect(historicoDoLancamento(b)[0]).toMatchObject({ acao: "alterado", detalhe: expect.stringContaining("valor") });
  });
});
