import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { authRouter } from "../src/routes/auth";
import { gestaoRouter } from "../src/routes/gestao";
import { authenticatedApi } from "../src/middleware/access";
import { hashPassword } from "../src/services/authService";
import { cnjValido, cnpjValido, cpfValido, formatarCnj, tribunalDoCnj, documentoValido } from "../src/services/gestao/validacao";

const app = express();
app.use(cookieParser(), express.json());
app.use("/api/auth", authRouter);
app.use("/api", authenticatedApi);
app.use("/api/gestao", gestaoRouter);
const server = createServer(app);
const ready = new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
async function req(path: string, method = "GET", body?: unknown, cookie = "") {
  const r = await fetch(`${await ready}/api/gestao${path}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}
async function entrar(role: string, perms?: string[]) {
  const nome = `g_${role}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare("INSERT INTO users (username, display_name, role, permissions_json, password_hash) VALUES (?, ?, ?, ?, ?)").run(nome, `Pessoa ${nome}`, role, perms ? JSON.stringify(perms) : null, hashPassword("senha-bem-segura-1"));
  const r = await fetch(`${await ready}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: nome, password: "senha-bem-segura-1" }) });
  return { cookie: (r.headers.get("set-cookie") || "").split(";")[0], id: (db.prepare("SELECT id FROM users WHERE username=?").get(nome) as { id: number }).id };
}
/** Gera um número CNJ válido (calcula o dígito verificador). */
function cnj(seq: number, ano = 2024, j = 8, tr = 26, orig = 100) {
  const n = String(seq).padStart(7, "0"), resto = `${ano}${j}${String(tr).padStart(2, "0")}${String(orig).padStart(4, "0")}`;
  const dv = String(98n - (BigInt(`${n}${resto}00`) % 97n)).padStart(2, "0");
  return `${n}${dv}${resto}`;
}

describe("validações", () => {
  it("CPF, CNPJ e número CNJ", () => {
    expect(cpfValido("529.982.247-25")).toBe(true);
    expect(cpfValido("111.111.111-11")).toBe(false);
    expect(cpfValido("529.982.247-24")).toBe(false);
    expect(cnpjValido("11.222.333/0001-81")).toBe(true);
    expect(cnpjValido("11.222.333/0001-80")).toBe(false);
    expect(documentoValido("")).toBe(true);
    expect(documentoValido("123")).toBe(false);
    const n = cnj(1234567);
    expect(cnjValido(n)).toBe(true);
    expect(cnjValido(n.slice(0, 7) + "00" + n.slice(9))).toBe(false);
    expect(formatarCnj(n)).toMatch(/^\d{7}-\d{2}\.2024\.8\.26\.0100$/);
    expect(tribunalDoCnj(n)).toBe("TJSP");
    expect(tribunalDoCnj(cnj(1, 2024, 4, 3))).toBe("TRF3");
    expect(tribunalDoCnj(cnj(1, 2024, 5, 15))).toBe("TRT15");
  });
});

describe("pessoas e processos (API)", () => {
  it("cadastra pessoa com validação, impede duplicidade e exclusão com processo", async () => {
    const { cookie } = await entrar("administrador");
    expect((await req("/pessoas", "POST", { nome: "Maria Silva", documento: "123" }, cookie)).status).toBe(400);
    expect((await req("/pessoas", "POST", { nome: "Maria Silva", email: "x" }, cookie)).status).toBe(400);
    const ok = await req("/pessoas", "POST", { nome: "Maria Silva", documento: "52998224725", telefone: "11999990000", uf: "sp" }, cookie);
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ nome: "Maria Silva", documento_formatado: "529.982.247-25", uf: "SP", tipo: "cliente", pessoa_juridica: false });
    expect((await req("/pessoas", "POST", { nome: "Outra", documento: "529.982.247-25" }, cookie)).status).toBe(409);
    const busca = await req("/pessoas?busca=529982", "GET", undefined, cookie);
    expect(busca.json.itens.map((p: any) => p.nome)).toContain("Maria Silva");
    const empresa = await req("/pessoas", "POST", { nome: "Banco X S.A.", tipo: "parte_contraria", documento: "11222333000181" }, cookie);
    expect(empresa.json.pessoa_juridica).toBe(true);

    const proc = await req("/processos", "POST", { numero: cnj(7654321), titulo: "Aposentadoria", partes: [{ pessoa_id: ok.json.id, papel: "autor", principal: true }, { pessoa_id: empresa.json.id, papel: "reu" }] }, cookie);
    expect(proc.status).toBe(201);
    expect((await req(`/pessoas/${ok.json.id}`, "DELETE", undefined, cookie)).status).toBe(409);
    const inativar = await req(`/pessoas/${ok.json.id}`, "PUT", { ativo: false }, cookie);
    expect(inativar.json.ativo).toBe(false);
  });

  it("cadastra processo com pasta sequencial, tribunal pelo CNJ, partes, anotações e linha do tempo", async () => {
    const { cookie, id: userId } = await entrar("administrador");
    const num = cnj(1111111);
    expect((await req("/processos", "POST", { numero: num.slice(0, 7) + "00" + num.slice(9) }, cookie)).status).toBe(400);
    expect((await req("/processos", "POST", { numero: "12" }, cookie)).status).toBe(400);
    const a = await req("/processos", "POST", { numero: formatarCnj(num), classe: "Procedimento Comum", valor_causa: "1.500,50", responsavel_user_id: userId }, cookie);
    expect(a.status).toBe(201);
    expect(a.json).toMatchObject({ tribunal: "TJSP", valor_causa_centavos: 150050, status: "ativo", responsavel_user_id: userId });
    expect(a.json.pasta).toMatch(/^\d{4}\/\d{4}$/);
    const b = await req("/processos", "POST", { numero: cnj(2222222) }, cookie);
    expect(Number(b.json.pasta.slice(5))).toBe(Number(a.json.pasta.slice(5)) + 1);
    expect((await req("/processos", "POST", { numero: num }, cookie)).status).toBe(409); // mesmo número, outra formatação

    const pessoa = (await req("/pessoas", "POST", { nome: "João Autor" }, cookie)).json;
    const comParte = await req(`/processos/${a.json.id}/partes`, "POST", { pessoa_id: pessoa.id, papel: "autor", principal: true }, cookie);
    expect(comParte.json.partes[0]).toMatchObject({ nome: "João Autor", papel: "autor", principal: 1 });
    expect((await req(`/processos/${a.json.id}/partes`, "POST", { pessoa_id: 999999, papel: "autor" }, cookie)).status).toBe(400);
    expect((await req(`/processos/${a.json.id}/partes`, "POST", { pessoa_id: pessoa.id, papel: "xyz" }, cookie)).status).toBe(400);

    expect((await req(`/processos/${a.json.id}/anotacoes`, "POST", { texto: "Cliente ligou pedindo notícias." }, cookie)).status).toBe(201);
    // publicação do DJEN do mesmo processo aparece na linha do tempo
    db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(num, formatarCnj(num));
    db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(`gest-${num}`, num, "TJSP", "1ª Vara Cível", "Procedimento Comum", "Despacho", "Intimação", "2024-05-10", "Intime-se a parte autora para manifestação em 15 dias.");
    const linha = await req(`/processos/${a.json.id}/linha-do-tempo`, "GET", undefined, cookie);
    const tipos = linha.json.map((e: any) => e.tipo);
    expect(tipos).toEqual(expect.arrayContaining(["publicacao", "anotacao", "cadastro"]));
    expect(linha.json.find((e: any) => e.tipo === "publicacao").titulo).toBe("Despacho");

    const lista = await req(`/processos?busca=${num.slice(0, 7)}&status=ativo`, "GET", undefined, cookie);
    expect(lista.json.itens.map((i: any) => i.id)).toContain(a.json.id);
    expect((await req(`/processos?pessoa=${pessoa.id}`, "GET", undefined, cookie)).json.total).toBe(1);
    const enc = await req(`/processos/${a.json.id}`, "PUT", { status: "encerrado", fase: "Cumprimento" }, cookie);
    expect(enc.json).toMatchObject({ status: "encerrado", fase: "Cumprimento" });
    expect((await req(`/processos/${a.json.id}`, "PUT", { status: "inexistente" }, cookie)).status).toBe(400);
  });

  it("importa contatos e processos monitorados pelo DJEN sem duplicar", async () => {
    const { cookie } = await entrar("administrador");
    const contato = db.prepare("INSERT INTO contacts(nome,telefone) VALUES (?,?)").run("Cliente Antigo Contato", "11988887777");
    const numero = cnj(3333333);
    db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero,cliente_id,area) VALUES (?,?,?,?)").run(numero, formatarCnj(numero), contato.lastInsertRowid, "previdenciario");
    db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(`imp-${numero}`, numero, "TRF3", "JEF Cível", "Procedimento do Juizado Especial Cível", "Sentença", "Intimação", "2024-06-01", "Julgo procedente.");
    expect((await req("/processos/pendentes-importacao", "GET", undefined, cookie)).json.pendentes).toBeGreaterThanOrEqual(1);
    const r = await req("/processos/importar-djen", "POST", {}, cookie);
    expect(r.json.criados).toBeGreaterThanOrEqual(1);
    const achado = (await req(`/processos?busca=${numero}`, "GET", undefined, cookie)).json.itens[0];
    expect(achado).toMatchObject({ tribunal: "TRF3", orgao: "JEF Cível", area: "previdenciario", autores: "Cliente Antigo Contato" });
    expect((await req("/processos/importar-djen", "POST", {}, cookie)).json.criados).toBe(0);
    expect((await req("/pessoas/importar-contatos", "POST", {}, cookie)).status).toBe(200);
    const lista = (await req("/pessoas?busca=Cliente Antigo Contato", "GET", undefined, cookie)).json;
    expect(lista.total).toBe(1); // contato → uma única pessoa, mesmo importando de novo
  });

  it("respeita permissões: consulta só lê; sem permissão não entra", async () => {
    const leitor = await entrar("consulta");
    const admin = await entrar("administrador");
    expect((await req("/pessoas", "GET", undefined, leitor.cookie)).status).toBe(200);
    expect((await req("/pessoas", "POST", { nome: "Fulano de Tal" }, leitor.cookie)).status).toBe(403);
    expect((await req("/processos", "POST", { numero: cnj(4444444) }, leitor.cookie)).status).toBe(403);
    const semAcesso = await entrar("consulta", ["dashboard.view"]);
    expect((await req("/pessoas", "GET", undefined, semAcesso.cookie)).status).toBe(403);
    expect((await req("/resumo", "GET", undefined, admin.cookie)).json).toHaveProperty("processos_ativos");
    // só o autor (ou administrador) apaga a anotação
    const proc = (await req("/processos", "POST", { numero: cnj(5555555) }, admin.cookie)).json;
    const outro = await entrar("atendimento");
    await req(`/processos/${proc.id}/anotacoes`, "POST", { texto: "Nota do atendimento." }, outro.cookie);
    const nid = db.prepare("SELECT id FROM gestao_anotacoes WHERE processo_id=?").get(proc.id) as { id: number };
    const outroAtendimento = await entrar("atendimento");
    expect((await req(`/processos/${proc.id}/anotacoes/${nid.id}`, "DELETE", undefined, outroAtendimento.cookie)).status).toBe(403);
    expect((await req(`/processos/${proc.id}/anotacoes/${nid.id}`, "DELETE", undefined, admin.cookie)).status).toBe(200);
  });
});
