import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { anotacoesDaPessoa } from "../src/services/gestao/anotacoes";
import { atualizarCadastroPeloAtendimento, CAMPOS_LIBERADOS } from "../src/services/gestao/cadastroPeloAtendimento";

const cliente = (extra: Record<string, string> = {}, tipo = "cliente") => {
  const id = Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,telefone,documento,rg,email,logradouro,cidade,uf,profissao,estado_civil) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(
    "Maria Souza", tipo, "13999991111", "111.222.333-44", "12.345.678-9", extra.email ?? "antigo@x.com", extra.logradouro ?? "Rua Velha", extra.cidade ?? "Santos", extra.uf ?? "SP", extra.profissao ?? "Costureira", extra.estado_civil ?? "Solteira",
  ).lastInsertRowid);
  return id;
};
const linha = (id: number) => db.prepare("SELECT * FROM gestao_pessoas WHERE id=?").get(id) as Record<string, string>;

beforeEach(() => { db.exec("DELETE FROM gestao_anotacoes_pessoa; DELETE FROM gestao_partes; DELETE FROM gestao_processos; DELETE FROM gestao_pessoas;"); });

describe("atendimento corrige o cadastro do cliente", () => {
  it("troca endereço, e-mail, profissão e estado civil, e deixa o histórico (antes → depois) no cadastro", () => {
    const id = cliente();
    const r = atualizarCadastroPeloAtendimento({ pessoa_id: id, campos: { email: "Novo@X.com", logradouro: "Rua Nova", cep: "11010100", profissao: "Costureira", estado_civil: "Casada" }, autor_nome: "Helena" });
    expect(r.alterados.sort()).toEqual(["cep", "email", "estado_civil", "logradouro"]);
    expect(r.iguais).toEqual(["profissao"]); // já era igual
    const p = linha(id);
    expect(p.email).toBe("novo@x.com");
    expect(p.logradouro).toBe("Rua Nova");
    expect(p.cep).toBe("11010-100"); // 8 dígitos viram 00000-000
    expect(p.estado_civil).toBe("Casada");
    const [a] = anotacoesDaPessoa(id);
    expect(a!.autor).toBe("Helena (atendimento)");
    expect(a!.texto).toContain("rua: Rua Velha → Rua Nova");
    expect(a!.texto).toContain("e-mail: antigo@x.com → novo@x.com");
  });

  it("NÃO troca nome, CPF, RG, telefone nem data de nascimento: ficam como estavam e voltam como ignorados", () => {
    const id = cliente();
    const r = atualizarCadastroPeloAtendimento({ pessoa_id: id, campos: { nome: "Outra Pessoa", documento: "999", cpf: "999", rg: "1", telefone: "1199", data_nascimento: "01/01/1990" } });
    expect(r.alterados).toEqual([]);
    expect(r.ignorados.sort()).toEqual(["cpf", "data_nascimento", "documento", "nome", "rg", "telefone"]);
    const p = linha(id);
    expect([p.nome, p.documento, p.rg, p.telefone]).toEqual(["Maria Souza", "111.222.333-44", "12.345.678-9", "13999991111"]);
    expect(anotacoesDaPessoa(id)).toHaveLength(0);
  });

  it("valor inválido (e-mail sem arroba, CEP curto, UF de 3 letras, texto vazio) é ignorado e nada muda", () => {
    const id = cliente();
    const r = atualizarCadastroPeloAtendimento({ pessoa_id: id, campos: { email: "sem-arroba", cep: "123", uf: "SPX", cidade: "  " } });
    expect(r.alterados).toEqual([]);
    expect(r.ignorados.sort()).toEqual(["cep", "cidade", "email", "uf"]);
    expect(linha(id).email).toBe("antigo@x.com");
  });

  it("só corrige cliente: parte contrária, perito etc. recusam", () => {
    const id = cliente({}, "perito");
    expect(() => atualizarCadastroPeloAtendimento({ pessoa_id: id, campos: { email: "a@b.com" } })).toThrow(/clientes/);
  });

  it("pessoa que não existe ou inativa: 404", () => {
    expect(() => atualizarCadastroPeloAtendimento({ pessoa_id: 99999, campos: { email: "a@b.com" } })).toThrow(/não encontrada/);
    const id = cliente();
    db.prepare("UPDATE gestao_pessoas SET ativo=0 WHERE id=?").run(id);
    expect(() => atualizarCadastroPeloAtendimento({ pessoa_id: id, campos: { email: "a@b.com" } })).toThrow(/não encontrada/);
  });

  it("pedido sem nada novo não anota nem mexe na data de atualização", () => {
    const id = cliente();
    const antes = linha(id).atualizado_em;
    const r = atualizarCadastroPeloAtendimento({ pessoa_id: id, campos: { email: "antigo@x.com" } });
    expect(r.alterados).toEqual([]);
    expect(linha(id).atualizado_em).toBe(antes);
    expect(anotacoesDaPessoa(id)).toHaveLength(0);
  });

  it("o nome da coluna nunca vem do pedido: campo com SQL é só 'ignorado'", () => {
    const id = cliente();
    const r = atualizarCadastroPeloAtendimento({ pessoa_id: id, campos: { "email=1; DROP TABLE gestao_pessoas; --": "x", email: "ok@ok.com" } });
    expect(r.ignorados).toHaveLength(1);
    expect(r.alterados).toEqual(["email"]);
    expect(linha(id).email).toBe("ok@ok.com");
  });

  it("a lista liberada é exatamente a combinada com o dono", () => {
    expect([...CAMPOS_LIBERADOS].sort()).toEqual(["bairro", "cep", "cidade", "complemento", "email", "estado_civil", "logradouro", "numero", "profissao", "uf"]);
  });
});
