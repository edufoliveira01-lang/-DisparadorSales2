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

import { definirLicencaParaTestes } from "../src/licenca/cliente";
async function bruto(path: string, corpo: Buffer | string, cookie: string, tipo = "application/octet-stream") {
  const r = await fetch(`${await ready}/api/gestao${path}`, { method: "POST", headers: { "Content-Type": tipo, Cookie: cookie }, body: corpo as any });
  return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
}
async function baixar(path: string, cookie: string) {
  const r = await fetch(`${await ready}/api/gestao${path}`, { headers: { Cookie: cookie } });
  return { status: r.status, headers: r.headers, texto: await r.text() };
}

describe("arquivos e modelos (fase 2)", () => {
  it("envia, versiona, baixa com segurança, bloqueia tipos perigosos e apaga", async () => {
    const { cookie } = await entrar("administrador");
    const proc = (await req("/processos", "POST", { numero: cnj(8000001) }, cookie)).json;
    const a1 = await bruto(`/processos/${proc.id}/arquivos?nome=${encodeURIComponent("Petição inicial.pdf")}&categoria=Peças`, Buffer.from("%PDF-1.4 v1"), cookie);
    expect(a1.status).toBe(201);
    expect(a1.json).toMatchObject({ nome: "Petição inicial.pdf", versao: 1, tamanho: 11, mime: "application/pdf" });
    expect(a1.json.armazenado).toBeUndefined();
    const a2 = await bruto(`/processos/${proc.id}/arquivos?nome=${encodeURIComponent("petição inicial.PDF")}`, Buffer.from("%PDF-1.4 versao dois"), cookie);
    expect(a2.json.versao).toBe(2);
    const lista = (await req(`/processos/${proc.id}/arquivos`, "GET", undefined, cookie)).json;
    expect(lista).toHaveLength(1);
    expect(lista[0]).toMatchObject({ id: a2.json.id, versao: 2, exibivel: true });
    expect(lista[0].versoes.map((v: any) => v.versao)).toEqual([1]);

    const d = await baixar(`/arquivos/${a2.json.id}/baixar`, cookie);
    expect(d.texto).toBe("%PDF-1.4 versao dois");
    expect(d.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''/);
    expect(d.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await baixar(`/arquivos/${a2.json.id}/baixar?inline=1`, cookie)).headers.get("content-disposition")).toMatch(/^inline/);

    expect((await bruto(`/processos/${proc.id}/arquivos?nome=virus.exe`, Buffer.from("MZ"), cookie)).status).toBe(400);
    expect((await bruto(`/processos/${proc.id}/arquivos?nome=pagina.html`, Buffer.from("<script>"), cookie)).status).toBe(400);
    expect((await bruto(`/processos/${proc.id}/arquivos?nome=${encodeURIComponent("../../etc/passwd.txt")}`, Buffer.from("x"), cookie)).json).toMatchObject({ nome: "passwd.txt" });
    expect((await bruto(`/processos/${proc.id}/arquivos?nome=vazio.txt`, Buffer.alloc(0), cookie)).status).toBe(400);
    expect((await bruto(`/processos/999999/arquivos?nome=a.txt`, Buffer.from("x"), cookie)).status).toBe(404);

    const pessoa = (await req("/pessoas", "POST", { nome: "Cliente Com Arquivo" }, cookie)).json;
    expect((await bruto(`/pessoas/${pessoa.id}/arquivos?nome=rg.png`, Buffer.from("png"), cookie)).status).toBe(201);
    expect((await req(`/pessoas/${pessoa.id}/arquivos`, "GET", undefined, cookie)).json).toHaveLength(1);
    expect((await req(`/arquivos/${a2.json.id}`, "DELETE", undefined, cookie)).status).toBe(200);
    expect((await baixar(`/arquivos/${a2.json.id}/baixar`, cookie)).status).toBe(404);
  });

  it("respeita a cota de armazenamento e os módulos do plano", async () => {
    const { cookie } = await entrar("administrador");
    const proc = (await req("/processos", "POST", { numero: cnj(8000002) }, cookie)).json;
    const fake = (entitlements: Record<string, unknown>) => definirLicencaParaTestes({ estado: () => ({ restrito: false, entitlements }) } as any);
    try {
      fake({ max_armazenamento_mb: 0 });
      const cheio = await bruto(`/processos/${proc.id}/arquivos?nome=a.txt`, Buffer.from("conteudo"), cookie);
      expect(cheio.status).toBe(402);
      expect(cheio.json.error).toMatch(/espaço acabou/);
      fake({ modulo_gestao: false });
      const sem = await req("/pessoas", "GET", undefined, cookie);
      expect(sem.status).toBe(403);
      expect(sem.json.codigo).toBe("modulo_nao_contratado");
      fake({ modulo_financeiro: false });
      expect((await req("/pessoas", "GET", undefined, cookie)).status).toBe(200);
      expect((await req("/financeiro/resumo", "GET", undefined, cookie)).status).toBe(403);
    } finally { definirLicencaParaTestes(null); }
  });

  it("gera documentos a partir de modelos, avisa o que falta e salva na pasta", async () => {
    const { cookie } = await entrar("administrador");
    const lista = (await req("/modelos", "GET", undefined, cookie)).json;
    expect(lista.modelos.length).toBeGreaterThanOrEqual(3);
    expect(lista.variaveis).toContain("cliente.nome");
    const procuracao = lista.modelos.find((m: any) => m.nome.startsWith("Procuração"));
    const pessoa = (await req("/pessoas", "POST", { nome: "João da Silva & Filhos", documento: "11144477735", rg: "12.345.678-9", logradouro: "Rua A", numero: "10", cidade: "Campinas", uf: "SP", profissao: "motorista" }, cookie)).json;
    const proc = (await req("/processos", "POST", { numero: cnj(8000003), titulo: "Ação X", partes: [{ pessoa_id: pessoa.id, papel: "autor", principal: true }] }, cookie)).json;
    const g = await req(`/modelos/${procuracao.id}/gerar`, "POST", { processo_id: proc.id, salvar: true }, cookie);
    expect(g.status).toBe(200);
    expect(g.json.html).toContain("João da Silva &amp; Filhos"); // escapado
    expect(g.json.html).toContain("111.444.777-35");
    expect(g.json.html).toContain("Rua A, 10, Campinas/SP");
    expect(g.json.faltando).toEqual(expect.arrayContaining(["cliente.estado_civil"]));
    expect(g.json.documento.startsWith("<html")).toBe(true);
    expect(g.json.arquivo).toMatchObject({ categoria: "Documento gerado", processo_id: proc.id });
    expect((await req(`/processos/${proc.id}/arquivos`, "GET", undefined, cookie)).json.map((a: any) => a.nome)).toContain(`${procuracao.nome}.doc`);
    const novo = await req("/modelos", "POST", { nome: "Modelo meu", conteudo: "# Título\n\nOlá {{cliente.nome}}, processo {{processo.numero}} {{variavel.inexistente}}" }, cookie);
    expect(novo.status).toBe(201);
    expect((await req(`/modelos/${novo.json.id}/gerar`, "POST", { processo_id: proc.id }, cookie)).json.faltando).toEqual(["variavel.inexistente"]);
    expect((await req("/modelos", "POST", { nome: "x", conteudo: "curto" }, cookie)).status).toBe(400);
    expect((await req(`/modelos/${novo.json.id}`, "DELETE", undefined, cookie)).status).toBe(200);
  });
});

describe("tarefas e meu painel (fase 3)", () => {
  const hojeBr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const dia = (n: number) => new Date(Date.parse(`${hojeBr()}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

  it("cria, filtra, conclui e reabre tarefas; mostra atrasadas e prazos fatais no painel", async () => {
    const { cookie, id } = await entrar("administrador");
    const proc = (await req("/processos", "POST", { numero: cnj(9000001), responsavel_user_id: id }, cookie)).json;
    expect((await req("/tarefas", "POST", { titulo: "ab" }, cookie)).status).toBe(400);
    expect((await req("/tarefas", "POST", { titulo: "Prazo inválido", prazo: "31/12/2026" }, cookie)).status).toBe(400);
    expect((await req("/tarefas", "POST", { titulo: "Prioridade ruim", prioridade: "x" }, cookie)).status).toBe(400);
    const atrasada = (await req("/tarefas", "POST", { titulo: "Juntar procuração", prazo: dia(-3), responsavel_user_id: id, processo_id: proc.id, prioridade: "alta" }, cookie)).json;
    const fatal = (await req("/tarefas", "POST", { titulo: "Contestação", prazo: dia(2), prazo_fatal: true, responsavel_user_id: id, processo_id: proc.id }, cookie)).json;
    const hoje = (await req("/tarefas", "POST", { titulo: "Ligar para o cliente", prazo: dia(0), responsavel_user_id: id }, cookie)).json;
    const semResp = (await req("/tarefas", "POST", { titulo: "Organizar arquivo morto" }, cookie)).json;
    expect(atrasada).toMatchObject({ atrasada: true, aberta: true, processo_pasta: proc.pasta });

    const minhas = (await req("/tarefas?responsavel=eu", "GET", undefined, cookie)).json;
    expect(minhas.itens.map((t: any) => t.id)).toEqual([atrasada.id, hoje.id, fatal.id]); // por prazo
    expect((await req("/tarefas?periodo=atrasadas&responsavel=eu", "GET", undefined, cookie)).json.itens.map((t: any) => t.id)).toEqual([atrasada.id]);
    expect((await req("/tarefas?responsavel=sem", "GET", undefined, cookie)).json.itens.map((t: any) => t.id)).toContain(semResp.id);
    expect((await req(`/tarefas?processo=${proc.id}`, "GET", undefined, cookie)).json.total).toBe(2);

    const painel = (await req("/meu-painel", "GET", undefined, cookie)).json;
    expect(painel.numeros).toMatchObject({ atrasadas: 1, prazos_fatais_5_dias: 1, processos_sob_responsabilidade: 1 });
    expect(painel.atrasadas[0].id).toBe(atrasada.id);
    expect(painel.hoje_lista.map((t: any) => t.id)).toEqual([hoje.id]);
    expect(painel.grafico).toHaveLength(7);
    expect(painel.mais_atrasadas_no_escritorio[0]).toMatchObject({ titulo: "Juntar procuração", quantidade: 1 });

    const feita = (await req(`/tarefas/${atrasada.id}/concluir`, "POST", {}, cookie)).json;
    expect(feita).toMatchObject({ status: "concluida", aberta: false, atrasada: false, concluida_em: hojeBr() });
    expect((await req("/meu-painel", "GET", undefined, cookie)).json.numeros.atrasadas).toBe(0);
    expect((await req(`/tarefas/${atrasada.id}/concluir`, "POST", { concluida: false }, cookie)).json.status).toBe("pendente");
    expect((await req(`/tarefas/${hoje.id}`, "PUT", { titulo: "Ligar de novo", prioridade: "urgente", status: "em_andamento" }, cookie)).json).toMatchObject({ titulo: "Ligar de novo", prioridade: "urgente", status: "em_andamento" });
    expect((await req(`/tarefas/${semResp.id}`, "DELETE", undefined, cookie)).status).toBe(200);
    expect((await req(`/tarefas/${semResp.id}`, "GET", undefined, cookie)).status).toBe(404);
  });

  it("prazos do DJEN viram tarefas e ficam sincronizados nos dois sentidos", async () => {
    const { cookie, id } = await entrar("administrador");
    const numero = cnj(9000002);
    const proc = (await req("/processos", "POST", { numero, responsavel_user_id: id }, cookie)).json;
    db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(numero, numero);
    const pub = db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(`tar-${numero}`, numero, "TJSP", "Vara", "Classe", "Despacho", "Intimação", dia(-1), "Manifeste-se em 5 dias.");
    const prazo = db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,termino,status) VALUES (?,?,?,'aberto')").run(pub.lastInsertRowid, "Manifestação sobre o laudo", dia(4));
    const s1 = (await req("/tarefas/sincronizar-djen", "POST", {}, cookie)).json;
    expect(s1.criadas).toBeGreaterThanOrEqual(1);
    const t = (await req(`/tarefas?processo=${proc.id}`, "GET", undefined, cookie)).json.itens[0];
    expect(t).toMatchObject({ titulo: "Manifestação sobre o laudo", origem: "djen", prazo: dia(4), prazo_fatal: true, responsavel_user_id: id });
    expect((await req("/tarefas/sincronizar-djen", "POST", {}, cookie)).json.criadas).toBe(0); // não duplica

    // concluir a tarefa conclui o prazo no DJEN
    await req(`/tarefas/${t.id}/concluir`, "POST", {}, cookie);
    expect((db.prepare("SELECT status FROM djen_prazos WHERE id=?").get(prazo.lastInsertRowid) as { status: string }).status).toBe("concluido");
    await req(`/tarefas/${t.id}/concluir`, "POST", { concluida: false }, cookie);
    expect((db.prepare("SELECT status FROM djen_prazos WHERE id=?").get(prazo.lastInsertRowid) as { status: string }).status).toBe("aberto");
    // concluir o prazo no DJEN conclui a tarefa na próxima sincronização
    db.prepare("UPDATE djen_prazos SET status='concluido' WHERE id=?").run(prazo.lastInsertRowid);
    expect((await req("/tarefas/sincronizar-djen", "POST", {}, cookie)).json.atualizadas).toBeGreaterThanOrEqual(1);
    expect((await req(`/tarefas/${t.id}`, "GET", undefined, cookie)).json.status).toBe("concluida");
  });
});

describe("financeiro (fase 4)", () => {
  const hojeBr = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  const dia = (n: number) => new Date(Date.parse(`${hojeBr()}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);

  it("gera parcelas de um contrato, baixa, estorna e quita; centavos sobram na última parcela", async () => {
    const { cookie } = await entrar("administrador");
    const cliente = (await req("/pessoas", "POST", { nome: "Cliente Financeiro Um" }, cookie)).json;
    expect((await req("/financeiro/contratos", "POST", { descricao: "Honorários", valor_total: "1000,00", parcelas: 3, primeiro_vencimento: "2026-01-31" }, cookie)).status).toBe(400); // sem cliente
    expect((await req("/financeiro/contratos", "POST", { pessoa_id: cliente.id, descricao: "Honorários", tipo: "exito", valor_total: "" }, cookie)).status).toBe(400); // êxito sem percentual
    expect((await req("/financeiro/contratos", "POST", { pessoa_id: cliente.id, descricao: "Honorários", valor_total: "0", parcelas: 3, primeiro_vencimento: "2026-01-31" }, cookie)).status).toBe(400);
    const c = await req("/financeiro/contratos", "POST", { pessoa_id: cliente.id, descricao: "Ação previdenciária", valor_total: "1.000,00", parcelas: 3, primeiro_vencimento: "2026-01-31" }, cookie);
    expect(c.status).toBe(201);
    expect(c.json.lancamentos.map((l: any) => l.valor_centavos)).toEqual([33333, 33333, 33334]);
    expect(c.json.lancamentos.map((l: any) => l.vencimento)).toEqual(["2026-01-31", "2026-02-28", "2026-03-31"]); // fim de mês preservado
    expect(c.json.lancamentos[0]).toMatchObject({ descricao: "Honorários — Ação previdenciária (1/3)", parcela_numero: 1, parcela_total: 3, tipo: "receber", categoria: "honorarios", status: "atrasado" });
    expect(c.json).toMatchObject({ valor_total_centavos: 100000, recebido_centavos: 0, em_aberto_centavos: 100000, status: "ativo", parcelas_atrasadas: 3 });

    const [p1, p2, p3] = c.json.lancamentos;
    expect((await req(`/financeiro/lancamentos/${p1.id}/baixar`, "POST", { pago_em: dia(5) }, cookie)).status).toBe(400); // futura
    const baixa = await req(`/financeiro/lancamentos/${p1.id}/baixar`, "POST", { pago_em: dia(-1), valor_pago: "333,00", forma_pagamento: "PIX" }, cookie);
    expect(baixa.json).toMatchObject({ status: "pago", valor_pago_centavos: 33300, forma_pagamento: "PIX" });
    expect((await req(`/financeiro/lancamentos/${p1.id}/baixar`, "POST", {}, cookie)).status).toBe(409);
    expect((await req(`/financeiro/lancamentos/${p1.id}`, "PUT", { descricao: "Mudou" }, cookie)).status).toBe(409); // baixado não edita
    expect((await req(`/financeiro/lancamentos/${p1.id}`, "DELETE", undefined, cookie)).status).toBe(409);
    expect((await req(`/financeiro/contratos/${c.json.id}`, "GET", undefined, cookie)).json).toMatchObject({ recebido_centavos: 33300, em_aberto_centavos: 66667, parcelas_atrasadas: 2 });

    await req(`/financeiro/lancamentos/${p2.id}/baixar`, "POST", {}, cookie);
    await req(`/financeiro/lancamentos/${p3.id}/baixar`, "POST", {}, cookie);
    expect((await req(`/financeiro/contratos/${c.json.id}`, "GET", undefined, cookie)).json.status).toBe("quitado");
    await req(`/financeiro/lancamentos/${p3.id}/estornar`, "POST", {}, cookie);
    expect((await req(`/financeiro/contratos/${c.json.id}`, "GET", undefined, cookie)).json.status).toBe("ativo");
    expect((await req(`/financeiro/lancamentos/${p3.id}/cancelar`, "POST", {}, cookie)).json.status).toBe("cancelado");
    expect((await req(`/financeiro/contratos/${c.json.id}`, "GET", undefined, cookie)).json.status).toBe("quitado"); // sem parcelas em aberto
  });

  it("lançamentos avulsos: validações, filtros, custas, comissões e resumo do mês", async () => {
    const { cookie, id } = await entrar("administrador");
    expect((await req("/financeiro/lancamentos", "POST", { tipo: "x", descricao: "Teste", valor: "10", vencimento: dia(1) }, cookie)).status).toBe(400);
    expect((await req("/financeiro/lancamentos", "POST", { tipo: "pagar", descricao: "ab", valor: "10", vencimento: dia(1) }, cookie)).status).toBe(400);
    expect((await req("/financeiro/lancamentos", "POST", { tipo: "pagar", descricao: "Conta de luz", valor: "-5", vencimento: dia(1) }, cookie)).status).toBe(400);
    expect((await req("/financeiro/lancamentos", "POST", { tipo: "pagar", descricao: "Conta de luz", valor: "50", vencimento: "amanhã" }, cookie)).status).toBe(400);
    const proc = (await req("/processos", "POST", { numero: cnj(9100001) }, cookie)).json;
    const mes = hojeBr().slice(0, 7);
    const custas = (await req("/financeiro/lancamentos", "POST", { tipo: "pagar", categoria: "custas", descricao: "Custas iniciais", valor: "250,00", vencimento: `${mes}-01`, processo_id: proc.id, reembolsavel: true }, cookie)).json[0];
    const comissao = (await req("/financeiro/lancamentos", "POST", { tipo: "pagar", categoria: "comissao", descricao: "Comissão captação", valor: "400,00", vencimento: dia(3), beneficiario_user_id: id }, cookie)).json[0];
    const honor = (await req("/financeiro/lancamentos", "POST", { tipo: "receber", descricao: "Consulta avulsa", valor: "300,00", vencimento: dia(-10) }, cookie)).json[0];
    expect(honor.status).toBe("atrasado");
    await req(`/financeiro/lancamentos/${custas.id}/baixar`, "POST", { pago_em: hojeBr() }, cookie);

    expect((await req("/financeiro/lancamentos?status=atrasado&tipo=receber", "GET", undefined, cookie)).json.itens.map((l: any) => l.id)).toContain(honor.id);
    expect((await req(`/financeiro/lancamentos?processo=${proc.id}`, "GET", undefined, cookie)).json).toMatchObject({ total: 1, soma_centavos: 25000 });
    expect((await req("/financeiro/lancamentos?categoria=comissao&status=aberto", "GET", undefined, cookie)).json.itens[0]).toMatchObject({ id: comissao.id, beneficiario: expect.any(String) });
    expect((await req("/financeiro/lancamentos?busca=Comiss", "GET", undefined, cookie)).json.total).toBeGreaterThanOrEqual(1);

    const r = (await req(`/financeiro/resumo?mes=${mes}`, "GET", undefined, cookie)).json;
    expect(r.pago_centavos).toBeGreaterThanOrEqual(25000);
    expect(r.custas_reembolsaveis_centavos).toBeGreaterThanOrEqual(25000);
    expect(r.inadimplencia_centavos).toBeGreaterThanOrEqual(30000);
    expect(r.comissoes_e_repasses.some((c: any) => c.categoria === "comissao" && c.previsto_centavos >= 40000)).toBe(true);
    expect(r.por_categoria.length).toBeGreaterThan(0);
    const fluxo = (await req("/financeiro/fluxo?meses=3", "GET", undefined, cookie)).json;
    expect(fluxo).toHaveLength(9); // 5 passados + atual + 3 futuros
    expect(fluxo.map((m: any) => m.mes)).toContain(mes);
    expect((await req("/financeiro/resumo?mes=lixo", "GET", undefined, cookie)).json.mes).toBe(mes);
  });

  it("financeiro exige permissão própria: gestor vê, advogado e atendimento não", async () => {
    const gestor = await entrar("gestor"), advogado = await entrar("advogado"), atendimento = await entrar("atendimento");
    expect((await req("/financeiro/resumo", "GET", undefined, gestor.cookie)).status).toBe(200);
    expect((await req("/financeiro/lancamentos", "GET", undefined, advogado.cookie)).status).toBe(403);
    expect((await req("/financeiro/resumo", "GET", undefined, atendimento.cookie)).status).toBe(403);
    expect((await req("/financeiro/lancamentos", "POST", { tipo: "receber", descricao: "Tentativa", valor: "10", vencimento: "2026-12-01" }, advogado.cookie)).status).toBe(403);
    const leitor = await entrar("consulta", ["gestao.view", "financeiro.view"]);
    expect((await req("/financeiro/lancamentos", "GET", undefined, leitor.cookie)).status).toBe(200);
    expect((await req("/financeiro/lancamentos", "POST", { tipo: "receber", descricao: "Tentativa", valor: "10", vencimento: "2026-12-01" }, leitor.cookie)).status).toBe(403);
  });
});

describe("indicadores (fase 5)", () => {
  it("produtividade, estoque e prospecção para a gestão; receita só para quem vê o financeiro", async () => {
    const admin = await entrar("administrador");
    const adv = await entrar("advogado");
    const mes = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()).slice(0, 7);
    const proc = (await req("/processos", "POST", { numero: cnj(9200001), area: "previdenciario", responsavel_user_id: adv.id }, admin.cookie)).json;
    db.prepare("UPDATE gestao_processos SET criado_em='2020-01-01 10:00:00' WHERE id=?").run(proc.id); // processo antigo e sem movimento
    const t = (await req("/tarefas", "POST", { titulo: "Indicador", prazo: `${mes}-28`, responsavel_user_id: adv.id }, admin.cookie)).json;
    await req(`/tarefas/${t.id}/concluir`, "POST", {}, admin.cookie);
    await req("/pessoas", "POST", { nome: "Cliente Indicador", origem: "Indicação de cliente" }, admin.cookie);
    const lanc = (await req("/financeiro/lancamentos", "POST", { tipo: "receber", descricao: "Honorários do indicador", valor: "1000", vencimento: `${mes}-01`, processo_id: proc.id }, admin.cookie)).json[0];
    await req(`/financeiro/lancamentos/${lanc.id}/baixar`, "POST", { pago_em: `${mes}-01` }, admin.cookie);

    const ind = (await req(`/indicadores?mes=${mes}`, "GET", undefined, admin.cookie)).json;
    const eu = ind.produtividade.find((p: any) => p.usuario_id === adv.id);
    expect(eu).toMatchObject({ concluidas: 1, atribuidas: 1, processos_ativos: 1 });
    expect(eu.no_prazo_percentual).toBe(100);
    expect(ind.tarefas.concluidas).toBeGreaterThanOrEqual(1);
    expect(ind.estoque.por_area.find((a: any) => a.area === "previdenciario").quantidade).toBeGreaterThanOrEqual(1);
    expect(ind.estoque.parados.map((p: any) => p.id)).toContain(proc.id);
    expect(ind.estoque.sem_movimentacao_60_dias).toBeGreaterThanOrEqual(1);
    expect(ind.prospeccao.por_origem.map((o: any) => o.origem)).toContain("Indicação de cliente");
    expect(ind.prospeccao.novos_clientes_por_mes).toHaveLength(6);
    expect(ind.receita.recebido_no_mes_centavos).toBeGreaterThanOrEqual(100000);
    expect(ind.receita.por_area.find((a: any) => a.area === "previdenciario").centavos).toBeGreaterThanOrEqual(100000);
    // quem não vê o financeiro não recebe a parte de receita
    expect((await req(`/indicadores?mes=${mes}`, "GET", undefined, adv.cookie)).json.receita).toBeNull();
    expect((await req("/indicadores?mes=lixo", "GET", undefined, admin.cookie)).json.mes).toBe(mes);
  });
});

describe("módulos do plano (fase 6)", () => {
  it("o menu e as permissões acompanham os módulos contratados", async () => {
    const { cookie } = await entrar("administrador");
    const permissoes = async () => ((await (await fetch(`${await ready}/api/auth/me`, { headers: { Cookie: cookie } })).json()) as { user: { permissions: string[] } }).user.permissions;
    const fake = (entitlements: Record<string, unknown>) => definirLicencaParaTestes({ estado: () => ({ restrito: false, entitlements }) } as any);
    try {
      expect(await permissoes()).toEqual(expect.arrayContaining(["gestao.view", "gestao.manage", "financeiro.view", "financeiro.manage"])); // padrão: tudo liberado
      fake({ modulo_financeiro: false });
      const semFin = await permissoes();
      expect(semFin).toContain("gestao.view");
      expect(semFin.some((p) => p.startsWith("financeiro."))).toBe(false);
      fake({ modulo_gestao: false });
      expect((await permissoes()).some((p) => p.startsWith("gestao.") || p.startsWith("financeiro."))).toBe(false);
      expect(await permissoes()).toContain("team.manage"); // o resto do sistema não muda
    } finally { definirLicencaParaTestes(null); }
  });
});
