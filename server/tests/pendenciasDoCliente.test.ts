import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { anotacaoRapida, anotacoesDaPessoa, anotarPeloAtendimento, cumprirPeloAtendimento, cumprirPendencia, marcarComoImportante, pendenciasDaPessoa, pendenciasPorTelefone } from "../src/services/gestao/anotacoes";

const pessoa = (nome: string, telefone: string) => Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,telefone) VALUES (?,?,?)").run(nome, "cliente", telefone).lastInsertRowid);
const processo = (pessoaId: number) => {
  const pid = Number(db.prepare("INSERT INTO gestao_processos(chave,pasta,numero,titulo) VALUES (?,?,?,?)").run("0001234562026826000", "P-1", "0001234-56.2026.8.26.0001", "Benefício").lastInsertRowid);
  db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel) VALUES (?,?,?)").run(pid, pessoaId, "autor");
  return pid;
};
const eu = { id: null, nome: "Camila" };

beforeEach(() => { db.exec("DELETE FROM gestao_anotacoes; DELETE FROM gestao_anotacoes_pessoa; DELETE FROM gestao_partes; DELETE FROM gestao_processos; DELETE FROM gestao_pessoas;"); });

describe("anotação importante (pendência)", () => {
  it("anotação comum não vira pendência; a marcada como importante vira", () => {
    const id = pessoa("Maria", "13999991111");
    anotacaoRapida({ pessoa_id: id, texto: "Ligou perguntando do prazo" }, eu);
    expect(pendenciasDaPessoa(id)).toHaveLength(0);
    anotacaoRapida({ pessoa_id: id, texto: "Preciso do comprovante de residência", importante: true }, eu);
    const [p] = pendenciasDaPessoa(id);
    expect(p!.texto).toContain("comprovante");
    expect(p!.importante).toBe(true);
    expect(p!.cumprida_em).toBeNull();
  });
  it("cumprir tira do aviso, mas a anotação continua no histórico (com quem cumpriu)", () => {
    const id = pessoa("Maria", "13999991111");
    anotacaoRapida({ pessoa_id: id, texto: "Preciso do RG", importante: true }, eu);
    const [p] = pendenciasDaPessoa(id);
    cumprirPendencia(p!.origem, p!.id, { id: null, nome: "Bianca" });
    expect(pendenciasDaPessoa(id)).toHaveLength(0);
    const [a] = anotacoesDaPessoa(id);
    expect(a!.importante).toBe(true);
    expect(a!.cumprida_por).toBe("Bianca");
    // reabrir volta o aviso
    cumprirPendencia(p!.origem, p!.id, eu, false);
    expect(pendenciasDaPessoa(id)).toHaveLength(1);
  });
  it("pendência de PROCESSO aparece no cliente, com o rótulo do processo", () => {
    const id = pessoa("Maria", "13999991111");
    const pr = processo(id);
    anotacaoRapida({ pessoa_id: id, processo_id: pr, texto: "Juntar o laudo novo", importante: true }, eu);
    const [p] = pendenciasDaPessoa(id);
    expect(p!.origem).toBe("processo");
    expect(p!.processo_rotulo).toContain("P-1");
    cumprirPendencia("processo", p!.id, eu);
    expect(pendenciasDaPessoa(id)).toHaveLength(0);
  });
  it("só dá para cumprir anotação marcada como importante; marcar depois também funciona", () => {
    const id = pessoa("Maria", "13999991111");
    anotacaoRapida({ pessoa_id: id, texto: "Conversa normal" }, eu);
    const [a] = anotacoesDaPessoa(id);
    expect(() => cumprirPendencia("cadastro", a!.id, eu)).toThrow(/importante/);
    marcarComoImportante("cadastro", a!.id, true);
    expect(pendenciasDaPessoa(id)).toHaveLength(1);
    expect(() => cumprirPendencia("cadastro", 99999, eu)).toThrow(/não encontrada/);
  });
  it("o atendimento (Deskcomm) acha as pendências pelo telefone e as cumpre no nome do atendente", () => {
    const id = pessoa("Maria", "(13) 99999-1111");
    anotarPeloAtendimento({ pessoa_id: id, texto: "Falta a procuração assinada", importante: true, autor_nome: "Camila", autor_email: "" });
    const r = pendenciasPorTelefone("5513999991111");
    expect(r.encontrado).toBe(true);
    expect(r.pendencias).toHaveLength(1);
    cumprirPeloAtendimento({ origem: r.pendencias[0]!.origem, id: r.pendencias[0]!.id, autor_nome: "Bianca", autor_email: "" });
    expect(pendenciasPorTelefone("5513999991111").pendencias).toHaveLength(0);
    expect(anotacoesDaPessoa(id)[0]!.cumprida_por).toBe("Bianca (atendimento)");
    expect(pendenciasPorTelefone("5511900000000").encontrado).toBe(false);
  });
});
