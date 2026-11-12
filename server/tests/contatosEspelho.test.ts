import { beforeEach, describe, expect, it } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

import { db } from "../src/db";
import { importarArquivoComoClientes, reconciliarContatos } from "../src/services/gestao/contatosEspelho";
import { listarPessoas } from "../src/services/gestao/pessoas";
import { createContact } from "../src/services/contactsService";

const pessoa = (nome: string, tel = "(13) 99999-1111", tipo = "cliente") => Number(db.prepare("INSERT INTO gestao_pessoas(tipo,nome,telefone) VALUES (?,?,?)").run(tipo, nome, tel).lastInsertRowid);
const processo = (numero: string, pessoaId: number) => { const id = Number(db.prepare("INSERT INTO gestao_processos(chave,numero,pasta) VALUES (?,?,?)").run(numero.replace(/\D/g, ""), numero, `P-${numero.slice(0, 4)}`).lastInsertRowid); db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,'autor',1)").run(id, pessoaId); return id; };
const contatos = () => db.prepare("SELECT nome,telefone,processo,origem,pessoa_id FROM contacts ORDER BY id").all() as { nome: string; telefone: string; processo: string | null; origem: string; pessoa_id: number | null }[];

beforeEach(() => { db.exec("DELETE FROM gestao_partes; DELETE FROM gestao_processos; DELETE FROM contacts; DELETE FROM gestao_pessoas;"); });

describe("Contatos espelhados dos clientes", () => {
  it("cria um contato por processo (formatado), ou um sem processo, e é idempotente", () => {
    const a = pessoa("Maria Souza"); processo("50226768820254036100", a); processo("10043253820238260505", a);
    pessoa("João Lima");
    expect(reconciliarContatos()).toMatchObject({ contatos_criados: 3 });
    expect(contatos().map((c) => c.processo)).toEqual(["5022676-88.2025.4.03.6100", "1004325-38.2023.8.26.0505", null]);
    expect(contatos().every((c) => c.origem === "espelho" && c.pessoa_id)).toBe(true);
    expect(reconciliarContatos()).toMatchObject({ contatos_criados: 0, atualizados: 0, removidos: 0 });
  });
  it("telefone inválido e quem não é cliente não geram contato", () => {
    pessoa("Sem Fone", "123"); pessoa("Perito X", "(13) 98888-0000", "perito");
    expect(reconciliarContatos().contatos_criados).toBe(0); expect(contatos()).toHaveLength(0);
  });
  it("muda nome/telefone no cliente e os contatos acompanham; processo novo aproveita o contato sem processo", () => {
    const a = pessoa("Maria Souza"); reconciliarContatos();
    db.prepare("UPDATE gestao_pessoas SET nome='Maria S. Souza', telefone='(13) 97777-2222' WHERE id=?").run(a);
    processo("50226768820254036100", a); reconciliarContatos();
    expect(contatos()).toEqual([{ nome: "Maria S. Souza", telefone: "5513977772222", processo: "5022676-88.2025.4.03.6100", origem: "espelho", pessoa_id: a }]);
  });
  it("processo desvinculado remove o contato espelho dele", () => {
    const a = pessoa("Maria Souza"); const p1 = processo("50226768820254036100", a); processo("10043253820238260505", a); reconciliarContatos();
    db.prepare("DELETE FROM gestao_partes WHERE processo_id=?").run(p1); reconciliarContatos();
    expect(contatos().map((c) => c.processo)).toEqual(["1004325-38.2023.8.26.0505"]);
  });
  it("contato antigo é adotado pelo cliente de mesmo nome e telefone (sem duplicar) ou vira cliente novo", () => {
    const a = pessoa("Maria Souza", "(13) 99999-1111");
    const antigo = createContact("MARIA SOUZA", "13999991111", "obs", "5022676-88.2025.4.03.6100");
    const solto = createContact("Carlos Dias", "11988887777");
    const r = reconciliarContatos();
    expect(r).toMatchObject({ adotados: 2, pessoas_criadas: 1 });
    expect(contatos().find((c) => c.processo === "5022676-88.2025.4.03.6100")!.pessoa_id).toBe(a);
    expect((db.prepare("SELECT COUNT(*) n FROM gestao_pessoas").get() as { n: number }).n).toBe(2);
    expect(db.prepare("SELECT COUNT(*) n FROM contacts WHERE id=?").get(antigo.id)).toEqual({ n: 1 });
    expect((db.prepare("SELECT tipo FROM gestao_pessoas WHERE nome='Carlos Dias'").get() as { tipo: string }).tipo).toBe("cliente");
    void solto;
  });
  it("cliente apagado leva seus contatos e eles não ressuscitam como cliente", () => {
    const a = pessoa("Maria Souza"); processo("50226768820254036100", a); reconciliarContatos();
    db.prepare("DELETE FROM gestao_partes WHERE pessoa_id=?").run(a); db.prepare("DELETE FROM gestao_pessoas WHERE id=?").run(a);
    expect(reconciliarContatos().removidos).toBe(1);
    expect(contatos()).toHaveLength(0); expect((db.prepare("SELECT COUNT(*) n FROM gestao_pessoas").get() as { n: number }).n).toBe(0);
  });

  it("importar arquivo cria clientes (sem duplicar nome+telefone), guarda o processo para os avisos e informa os números", () => {
    const csv = "Name,Phone 1 - Value,Notes\nMaria Souza,(13) 99999-1111,primeira\nCarlos Dias,(11) 98888-7777,\nSem Fone,,\n";
    const r1 = importarArquivoComoClientes(csv);
    expect(r1).toMatchObject({ total: 2, criados: 2 });
    expect(importarArquivoComoClientes(csv)).toMatchObject({ criados: 0 });
    expect(contatos().map((c) => c.nome).sort()).toEqual(["Carlos Dias", "Maria Souza"]);
    expect((db.prepare("SELECT COUNT(*) n FROM gestao_pessoas WHERE tipo='cliente'").get() as { n: number }).n).toBe(2);
    expect(() => importarArquivoComoClientes("nada aqui")).toThrow();
  });
  it("lista de clientes: filtros e painéis (sem processo, com processo, telefone a conferir)", () => {
    const a = pessoa("Com Processo"); processo("50226768820254036100", a); pessoa("Sem Processo"); pessoa("Fone Ruim", "99");
    const todos = listarPessoas({ tipo: "cliente", ativo: "", limite: 50 });
    expect(todos.resumo).toEqual({ total: 3, sem_processo: 2, com_processo: 1, telefone_conferir: 1 });
    expect(listarPessoas({ tipo: "cliente", filtro: "sem_processo" }).itens.map((p) => p.nome).sort()).toEqual(["Fone Ruim", "Sem Processo"]);
    expect(listarPessoas({ tipo: "cliente", filtro: "telefone_conferir" }).itens.map((p) => p.nome)).toEqual(["Fone Ruim"]);
    expect(listarPessoas({ tipo: "cliente", filtro: "com_processo", busca: "Com" }).total).toBe(1);
    expect(listarPessoas({ tipo: "cliente", filtro: "com_processo", busca: "Com" }).resumo.total).toBe(3);
  });
});
