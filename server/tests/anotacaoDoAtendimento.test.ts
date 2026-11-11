import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { anotacoesDaPessoa, anotarPeloAtendimento, clienteParaAnotar } from "../src/services/gestao/anotacoes";

const pessoa = (nome: string, telefone: string, tipo = "cliente") => Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,telefone) VALUES (?,?,?)").run(nome, tipo, telefone).lastInsertRowid);

beforeEach(() => { db.exec("DELETE FROM gestao_anotacoes_pessoa; DELETE FROM gestao_partes; DELETE FROM gestao_processos; DELETE FROM gestao_pessoas;"); });

describe("anotação pelo atendimento", () => {
  it("acha o cliente pelo telefone, com ou sem 55, parênteses e o 9º dígito", () => {
    const id = pessoa("Maria Souza", "(13) 99999-1111");
    expect(clienteParaAnotar("5513999991111").pessoa?.id).toBe(id);
    expect(clienteParaAnotar("551399991111").pessoa?.id).toBe(id); // sem o 9
    expect(clienteParaAnotar("5511988887777").encontrado).toBe(false);
    expect(clienteParaAnotar("123").encontrado).toBe(false);
  });
  it("grava no cadastro, no nome do atendente, e aparece nas anotações do cliente", () => {
    const id = pessoa("Maria Souza", "13999991111");
    const r = anotarPeloAtendimento({ pessoa_id: id, texto: "Pediu para remarcar a perícia", autor_nome: "Camila", autor_email: "" });
    expect(r.destino).toBe("cadastro");
    const [a] = anotacoesDaPessoa(id);
    expect(a!.texto).toBe("Pediu para remarcar a perícia");
    expect(a!.autor).toBe("Camila (atendimento)");
    expect(clienteParaAnotar("13999991111").recentes?.[0]?.texto).toContain("remarcar");
  });
  it("recusa texto vazio e cliente que não existe", () => {
    const id = pessoa("Ana", "13988887777");
    expect(() => anotarPeloAtendimento({ pessoa_id: id, texto: " " })).toThrow();
    expect(() => anotarPeloAtendimento({ pessoa_id: 99999, texto: "oi tudo bem" })).toThrow();
  });
});
