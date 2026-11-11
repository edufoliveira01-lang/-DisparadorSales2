import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { listarLancamentos, resumoFinanceiro } from "../src/services/gestao/financeiro";

const pessoa = (nome: string, tel: string) => Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,telefone) VALUES (?, 'cliente', ?)").run(nome, tel).lastInsertRowid);
const lanc = (pessoaId: number, valor: number, venc: string, extra: { pago?: string; cancelado?: number; tipo?: string } = {}) =>
  db.prepare("INSERT INTO gestao_lancamentos(tipo,categoria,descricao,valor_centavos,vencimento,pessoa_id,pago_em,cancelado) VALUES (?,?,?,?,?,?,?,?)")
    .run(extra.tipo ?? "receber", "honorarios", "Parcela", valor, venc, pessoaId, extra.pago ?? null, extra.cancelado ?? 0);

beforeEach(() => { db.exec("DELETE FROM gestao_lancamentos; DELETE FROM gestao_pessoas;"); });

describe("quem está em atraso", () => {
  it("soma só parcelas a receber vencidas e não pagas, do maior devedor para o menor", () => {
    const a = pessoa("Ana", "13999990001"), b = pessoa("Bruno", "13999990002"), c = pessoa("Carla", "13999990003");
    lanc(a, 10000, "2020-01-10"); lanc(a, 5000, "2020-02-10");           // Ana: 150,00 em 2 parcelas
    lanc(b, 30000, "2020-03-10");                                         // Bruno: 300,00
    lanc(c, 99999, "2020-03-10", { pago: "2020-03-11" });                 // paga: fora
    lanc(c, 99999, "2020-03-10", { cancelado: 1 });                       // cancelada: fora
    lanc(c, 99999, "2020-03-10", { tipo: "pagar" });                      // a pagar: fora
    lanc(c, 99999, "2999-01-01");                                         // não venceu: fora
    const d = resumoFinanceiro("2026-11").maiores_devedores as { nome: string; telefone: string; total_centavos: number; parcelas: number; mais_antigo: string }[];
    expect(d.map((x) => x.nome)).toEqual(["Bruno", "Ana"]);
    expect(d[1]).toMatchObject({ total_centavos: 15000, parcelas: 2, mais_antigo: "2020-01-10", telefone: "13999990001" });
  });
  it("a lista de lançamentos traz o telefone do cliente (para cobrar)", () => {
    const a = pessoa("Ana", "13999990001"); lanc(a, 10000, "2020-01-10");
    expect(listarLancamentos({ status: "atrasado" }).itens[0]).toMatchObject({ pessoa_nome: "Ana", pessoa_telefone: "13999990001", status: "atrasado" });
  });
});
