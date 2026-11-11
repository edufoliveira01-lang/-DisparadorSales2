import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { excluirPessoa, previaDaExclusao } from "../src/services/gestao/pessoas";

const pessoa = (nome: string, telefone: string) => Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,telefone) VALUES (?, 'cliente', ?)").run(nome, telefone).lastInsertRowid);
let seq = 0;
const pericia = (digits: string, status = "ativa") => {
  seq++;
  return Number(db.prepare(
    `INSERT INTO pericias_agendadas(card_id,tipo,tipo_chave,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,data_hora_ms,status)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(`c${seq}`, "Perícia Médica", "pericia medica", "Fulano", "fulano", digits, digits, `P${seq}`, `p${seq}`, "2026-11-22", "09:00", Date.parse("2026-11-22T12:00:00Z") + seq, status).lastInsertRowid);
};
const ativas = () => (db.prepare("SELECT COUNT(*) n FROM pericias_agendadas WHERE status='ativa'").get() as { n: number }).n;

beforeEach(() => { db.exec("DELETE FROM pericias_agendadas; DELETE FROM gestao_partes; DELETE FROM gestao_pessoas;"); });

describe("excluir pessoa e as perícias do telefone dela", () => {
  it("a prévia conta só as perícias ativas do telefone da pessoa", () => {
    const id = pessoa("Eduardo", "(13) 97404-5973");
    pericia("5513974045973"); pericia("5513974045973", "substituida"); pericia("5511988887777");
    const p = previaDaExclusao(id);
    expect(p.pericias).toHaveLength(1);
    expect(p.processos).toBe(0);
  });
  it("excluir sem marcar nada mantém as perícias; marcando, cancela só as do telefone dela", () => {
    const a = pessoa("Eduardo", "13974045973");
    pericia("5513974045973"); pericia("5511988887777");
    expect(excluirPessoa(a)).toMatchObject({ ok: true, pericias_canceladas: 0 });
    expect(ativas()).toBe(2);
    const b = pessoa("Eduardo de novo", "13974045973");
    expect(excluirPessoa(b, { cancelarPericias: true }).pericias_canceladas).toBe(1);
    expect(ativas()).toBe(1);
  });
});
