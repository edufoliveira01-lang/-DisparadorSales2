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

import { vi } from "vitest";
import { limparCacheCep } from "../src/services/gestao/cep";
import { pisValido } from "../src/services/gestao/validacao";

describe("refinos do cadastro: CEP, campos personalizados, ficha, unificação", () => {
  it("valida PIS/NIT", () => {
    expect(pisValido("")).toBe(true);
    expect(pisValido("12345678919")).toBe(true);
    expect(pisValido("12345678910")).toBe(false);
    expect(pisValido("11111111111")).toBe(false);
    expect(pisValido("123")).toBe(false);
  });

  it("busca o endereço pelo CEP (ViaCEP com reserva) e trata CEP inexistente e falha de rede", async () => {
    const { cookie } = await entrar("administrador");
    const original = globalThis.fetch;
    const chamadas: string[] = [];
    const resposta = (corpo: unknown, status = 200) => new Response(JSON.stringify(corpo), { status, headers: { "Content-Type": "application/json" } });
    try {
      limparCacheCep();
      globalThis.fetch = (async (url: any, init?: any) => {
        const u = String(url); if (!u.includes("viacep") && !u.includes("brasilapi")) return original(url, init);
        chamadas.push(u);
        if (u.includes("viacep") && u.includes("01001000")) return resposta({ cep: "01001-000", logradouro: "Praça da Sé", complemento: "lado ímpar", bairro: "Sé", localidade: "São Paulo", uf: "SP" });
        if (u.includes("viacep") && u.includes("99999999")) return resposta({ erro: true });
        if (u.includes("viacep") && u.includes("13010000")) throw new Error("rede fora");
        if (u.includes("brasilapi") && u.includes("13010000")) return resposta({ street: "Rua Barão de Jaguara", neighborhood: "Centro", city: "Campinas", state: "SP" });
        return resposta({}, 500);
      }) as typeof fetch;
      expect((await req("/cep/123", "GET", undefined, cookie)).status).toBe(400);
      const ok = await req("/cep/01001-000", "GET", undefined, cookie);
      expect(ok.json).toMatchObject({ cep: "01001000", logradouro: "Praça da Sé", bairro: "Sé", cidade: "São Paulo", uf: "SP" });
      await req("/cep/01001000", "GET", undefined, cookie);
      expect(chamadas.filter((c) => c.includes("01001000"))).toHaveLength(1); // segunda consulta vem do cache
      const reserva = await req("/cep/13010000", "GET", undefined, cookie);
      expect(reserva.json).toMatchObject({ cidade: "Campinas", logradouro: "Rua Barão de Jaguara" });
      expect((await req("/cep/99999999", "GET", undefined, cookie)).status).toBe(404);
      globalThis.fetch = (async (url: any, init?: any) => { if (/viacep|brasilapi/.test(String(url))) throw new Error("sem internet"); return original(url, init); }) as typeof fetch;
      limparCacheCep();
      const fora = await req("/cep/20040020", "GET", undefined, cookie);
      expect(fora.status).toBe(502);
      expect(fora.json.error).toMatch(/à mão/);
    } finally { globalThis.fetch = original; }
  });

  it("campos personalizados: tipos validados, senha criptografada e revelada só sob pedido auditado", async () => {
    const admin = await entrar("administrador");
    process.env.ENCRYPTION_KEY = "k".repeat(64);
    const c = (corpo: unknown) => req("/campos", "POST", corpo, admin.cookie);
    expect((await c({ entidade: "pessoa", nome: "x", tipo: "texto" })).status).toBe(400);
    expect((await c({ entidade: "pessoa", nome: "Campo ruim", tipo: "inexistente" })).status).toBe(400);
    expect((await c({ entidade: "pessoa", nome: "Lista curta", tipo: "lista", opcoes: ["só uma"] })).status).toBe(400);
    const senha = (await c({ entidade: "pessoa", nome: "Senha GOV", tipo: "senha", grupo: "Acessos" })).json;
    const nasc = (await c({ entidade: "pessoa", nome: "Data de admissão", tipo: "data", grupo: "Trabalho" })).json;
    const lista = (await c({ entidade: "pessoa", nome: "Grau de risco", tipo: "lista", opcoes: ["Baixo", "Médio", "Alto"], grupo: "Trabalho" })).json;
    const site = (await c({ entidade: "pessoa", nome: "Site do empregador", tipo: "link" })).json;
    const sn = (await c({ entidade: "pessoa", nome: "Recebe aviso", tipo: "sim_nao" })).json;
    const dinheiro = (await c({ entidade: "pessoa", nome: "Renda declarada", tipo: "moeda" })).json;
    expect((await c({ entidade: "pessoa", nome: "senha gov", tipo: "texto" })).status).toBe(409); // nome repetido (sem diferenciar maiúsculas)

    const sem = await req("/pessoas", "POST", { nome: "Cliente Com Campos", campos: { [lista.id]: "Altíssimo" } }, admin.cookie);
    expect(sem.status).toBe(400);
    expect(sem.json.error).toMatch(/opções/);
    const p = await req("/pessoas", "POST", { nome: "Cliente Com Campos", escolaridade: "Médio completo", pis: "12345678919", nome_mae: "Maria da Mãe", campos: { [senha.id]: "S3nh@-Gov#2026", [nasc.id]: "2020-03-15", [lista.id]: "Alto", [site.id]: "empresa.com.br/rh", [sn.id]: "sim", [dinheiro.id]: "2.500,50" } }, admin.cookie);
    expect(p.status).toBe(201);
    expect(p.json).toMatchObject({ escolaridade: "Médio completo", pis_formatado: "123.45678.91-9", nome_mae: "Maria da Mãe" });
    const por = (nome: string) => p.json.campos.find((x: any) => x.nome === nome);
    expect(por("Senha GOV")).toMatchObject({ valor: "", preenchido: true }); // a leitura comum nunca traz a senha
    expect(JSON.stringify(p.json)).not.toContain("S3nh@");
    expect(por("Grau de risco").valor).toBe("Alto");
    expect(por("Site do empregador").valor).toBe("https://empresa.com.br/rh");
    expect(por("Renda declarada").valor).toBe("2500.50");
    // no banco a senha está cifrada
    const bruto = (db.prepare("SELECT valor FROM gestao_campos_valores WHERE campo_id=? AND entidade_id=?").get(senha.id, p.json.id) as { valor: string }).valor;
    expect(bruto.startsWith("v1:")).toBe(true);
    expect(bruto).not.toContain("S3nh@");

    expect((await req("/pessoas", "POST", { nome: "PIS ruim", pis: "12345678910" }, admin.cookie)).status).toBe(400);
    expect((await req(`/pessoas/${p.json.id}`, "PUT", { campos: { [nasc.id]: "15/03/2020" } }, admin.cookie)).status).toBe(400);
    expect((await req(`/pessoas/${p.json.id}`, "PUT", { campos: { [site.id]: "javascript:alert(1)" } }, admin.cookie)).status).toBe(400);
    // editar sem mexer na senha preserva; "" limpa
    const mantida = (await req(`/pessoas/${p.json.id}`, "PUT", { telefone: "11999990000", campos: { [sn.id]: "nao" } }, admin.cookie)).json;
    expect(mantida.campos.find((x: any) => x.nome === "Senha GOV").preenchido).toBe(true);

    const leitor = await entrar("consulta");
    expect((await req(`/campos/${senha.id}/revelar/${p.json.id}`, "POST", {}, leitor.cookie)).status).toBe(403);
    const rev = await req(`/campos/${senha.id}/revelar/${p.json.id}`, "POST", {}, admin.cookie);
    expect(rev.json.valor).toBe("S3nh@-Gov#2026");
    expect((db.prepare("SELECT COUNT(*) n FROM access_audit WHERE action='gestao_senha_revelada'").get() as { n: number }).n).toBeGreaterThanOrEqual(1);
    expect((await req(`/campos/${nasc.id}/revelar/${p.json.id}`, "POST", {}, admin.cookie)).status).toBe(400);

    const limpa = (await req(`/pessoas/${p.json.id}`, "PUT", { campos: { [senha.id]: "" } }, admin.cookie)).json;
    expect(limpa.campos.find((x: any) => x.nome === "Senha GOV").preenchido).toBe(false);
    // apagar o campo apaga os valores
    expect((await req(`/campos/${dinheiro.id}`, "DELETE", undefined, admin.cookie)).status).toBe(200);
    expect((db.prepare("SELECT COUNT(*) n FROM gestao_campos_valores WHERE campo_id=?").get(dinheiro.id) as { n: number }).n).toBe(0);

    // sem ENCRYPTION_KEY o sistema recusa guardar senha em vez de guardar às claras
    delete process.env.ENCRYPTION_KEY;
    const semChave = await req(`/pessoas/${p.json.id}`, "PUT", { campos: { [senha.id]: "outra" } }, admin.cookie);
    expect(semChave.status).toBe(503);
    process.env.ENCRYPTION_KEY = "k".repeat(64);
    // modelo previdenciário: acrescenta os campos da ficha uma vez só
    const a = (await req("/campos/previdenciarios", "POST", {}, admin.cookie)).json;
    expect(a.criados).toBe(9);
    expect((await req("/campos/previdenciarios", "POST", {}, admin.cookie)).json.criados).toBe(0);
    expect((await req("/campos?entidade=pessoa", "GET", undefined, admin.cookie)).json.campos.map((x: any) => x.nome)).toEqual(expect.arrayContaining(["Serviço", "UDT", "Meu INSS (senha)"]));
  });

  it("ficha de cadastro para imprimir: dados do modelo, escape, senha só com permissão e auditoria", async () => {
    const admin = await entrar("administrador");
    process.env.ENCRYPTION_KEY = "k".repeat(64);
    await req("/campos/previdenciarios", "POST", {}, admin.cookie);
    const campos = (await req("/campos?entidade=pessoa", "GET", undefined, admin.cookie)).json.campos;
    const id = (nome: string) => campos.find((c: any) => c.nome === nome).id;
    const p = (await req("/pessoas", "POST", { nome: "RENATA <b>ALCANTARA</b>", documento: "39053344705", rg: "59.794.452-0", data_nascimento: "1968-02-15", telefone: "(13) 99718-0040", cep: "11000000", logradouro: "Rua das Flores", numero: "10", uf: "SP",
      campos: { [id("Serviço")]: "Aposentadoria por idade", [id("Meu INSS (senha)")]: "MinhaSenha123" } }, admin.cookie)).json;
    await req("/processos", "POST", { numero: cnj(9300001), partes: [{ pessoa_id: p.id, papel: "autor", principal: true }] }, admin.cookie);

    const ficha = await baixar(`/pessoas/${p.id}/ficha`, admin.cookie);
    expect(ficha.status).toBe(200);
    expect(ficha.headers.get("content-type")).toMatch(/text\/html/);
    expect(ficha.headers.get("content-security-policy")).toContain("default-src 'none'");
    for (const rotulo of ["FICHA PROCESSUAL", "DADOS DE IDENTIFICAÇÃO", "Escolaridade", "Est. civil", "PIS/NIT", "Mãe", "Filiação", "Rua/Av.", "Bairro", "CEP", "DADOS PREVIDENCIÁRIOS", "Serviço", "Meu INSS (senha)", "PROCESSOS VINCULADOS", "OBSERVAÇÕES"]) expect(ficha.texto).toContain(rotulo);
    expect(ficha.texto).toContain("390.533.447-05");
    expect(ficha.texto).toContain("15/02/1968");
    expect(ficha.texto).toContain("11000-000");
    expect(ficha.texto).toContain("RENATA &lt;b&gt;ALCANTARA&lt;/b&gt;"); // sem injeção de HTML
    expect(ficha.texto).not.toContain("<b>ALCANTARA</b>");
    expect(ficha.texto).toContain("Aposentadoria por idade");
    expect(ficha.texto).toContain("••••••••");
    expect(ficha.texto).not.toContain("MinhaSenha123");
    expect(ficha.texto).toContain("window.print()");
    expect((await baixar(`/pessoas/${p.id}/ficha?imprimir=0`, admin.cookie)).texto).not.toContain("window.print()");

    const comSenha = await baixar(`/pessoas/${p.id}/ficha?senhas=1`, admin.cookie);
    expect(comSenha.texto).toContain("MinhaSenha123");
    expect(comSenha.texto).toContain("CONTÉM SENHAS");
    expect((db.prepare("SELECT COUNT(*) n FROM access_audit WHERE action='gestao_ficha_impressa_com_senhas'").get() as { n: number }).n).toBeGreaterThanOrEqual(1);
    const leitor = await entrar("consulta");
    expect((await baixar(`/pessoas/${p.id}/ficha`, leitor.cookie)).status).toBe(200); // ver/imprimir sem senhas: ok
    expect((await baixar(`/pessoas/${p.id}/ficha?senhas=1`, leitor.cookie)).status).toBe(403);
    expect((await baixar(`/pessoas/999999/ficha`, admin.cookie)).status).toBe(404);
  });

  it("cadastro unificado: busca de cliente acha pelo processo; ficha mostra andamento DJEN, perícias, agenda e financeiro", async () => {
    const admin = await entrar("administrador");
    const cliente = (await req("/pessoas", "POST", { nome: "Cliente Unificado Silva", telefone: "(11) 98888-7777" }, admin.cookie)).json;
    const numero = cnj(9400001);
    const proc = (await req("/processos", "POST", { numero, titulo: "Revisão unificada", partes: [{ pessoa_id: cliente.id, papel: "autor", principal: true }] }, admin.cookie)).json;
    // achar o cliente pelo número do processo e ver o processo aninhado
    const busca = (await req(`/pessoas?busca=${numero.slice(0, 10)}`, "GET", undefined, admin.cookie)).json;
    const achado = busca.itens.find((i: any) => i.id === cliente.id);
    expect(achado.processos_lista[0]).toMatchObject({ id: proc.id, pasta: proc.pasta, papel: "autor" });
    expect((await req(`/pessoas?busca=${encodeURIComponent("Revisão unif")}`, "GET", undefined, admin.cookie)).json.itens.map((i: any) => i.id)).toContain(cliente.id);

    // DJEN + quadro + perícia do mesmo processo
    db.prepare("INSERT OR IGNORE INTO djen_processos(chave,numero) VALUES (?,?)").run(numero, numero);
    const pub = db.prepare(`INSERT INTO djen_publicacoes(comunicacao_id,processo_chave,tribunal,orgao,classe,tipo_documento,tipo_comunicacao,data_disponibilizacao,texto) VALUES (?,?,?,?,?,?,?,?,?)`).run(`uni-${numero}`, numero, "TJSP", "2ª Vara", "Classe", "Intimação", "Intimação", "2026-10-30", "Intime-se a parte autora para comparecer à perícia.");
    db.prepare("INSERT INTO djen_prazos(publicacao_id,descricao,termino,status) VALUES (?,?,?,'aberto')").run(pub.lastInsertRowid, "Comparecer à perícia", "2026-12-01");
    const lista = db.prepare("SELECT id FROM djen_kanban_listas ORDER BY posicao LIMIT 1").get() as { id: number } | undefined;
    if (lista) db.prepare("INSERT OR REPLACE INTO djen_kanban_cartoes(processo_chave,lista_id,posicao) VALUES (?,?,0)").run(numero, lista.id);
    const futuro = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    db.prepare(`INSERT INTO pericias_agendadas(card_id,tipo,tipo_chave,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,local,data_hora_ms,status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'ativa')`)
      .run("card-uni", "Perícia médica", "medica", "Cliente Unificado Silva", "cliente unificado silva", "(11) 98888-7777", "11988887777", numero, numero, futuro, "09:30", "Fórum Central", Date.now() + 5 * 86400000);

    const and = (await req(`/processos/${proc.id}/andamento`, "GET", undefined, admin.cookie)).json;
    expect(and.monitorado).toBe(true);
    expect(and.publicacoes_nao_lidas).toBe(1);
    expect(and.ultimas_publicacoes[0]).toMatchObject({ tipo_documento: "Intimação", orgao: "2ª Vara" });
    expect(and.prazos_abertos[0]).toMatchObject({ descricao: "Comparecer à perícia", termino: "2026-12-01" });
    expect(and.proxima_pericia).toMatchObject({ tipo: "Perícia médica", horario: "09:30", local: "Fórum Central", passada: false });
    if (lista) expect(and.quadro.lista).toBeTruthy();
    // processo novo com número CNJ entra sozinho no acompanhamento do DJEN (ainda sem perícia); número fora do padrão CNJ não dá para acompanhar
    const novoCnj = (await req("/processos", "POST", { numero: cnj(9400002) }, admin.cookie)).json;
    expect((await req(`/processos/${novoCnj.id}/andamento`, "GET", undefined, admin.cookie)).json).toMatchObject({ monitorado: true, pericias: [], proxima_pericia: null });
    const naoMonit = (await req("/processos", "POST", { numero: "1234567" }, admin.cookie)).json;
    expect((await req(`/processos/${naoMonit.id}/andamento`, "GET", undefined, admin.cookie)).json).toMatchObject({ monitorado: false, pericias: [], proxima_pericia: null });

    // a agenda do cliente reúne a perícia (pelo processo ou pelo telefone) e as tarefas do processo
    await req("/tarefas", "POST", { titulo: "Preparar cliente para a perícia", processo_id: proc.id }, admin.cookie);
    const ag = (await req(`/pessoas/${cliente.id}/agenda`, "GET", undefined, admin.cookie)).json;
    expect(ag.pericias.map((x: any) => x.tipo)).toContain("Perícia médica");
    expect(ag.tarefas.map((t: any) => t.titulo)).toContain("Preparar cliente para a perícia");

    // Meu painel traz o DJEN e as perícias da semana
    const painel = (await req("/meu-painel", "GET", undefined, admin.cookie)).json;
    expect(painel.djen.publicacoes_nao_lidas).toBeGreaterThanOrEqual(1);
    expect(painel.djen.pericias_proximas.map((x: any) => x.local)).toContain("Fórum Central");

    // financeiro dentro do cadastro da pessoa
    await req("/financeiro/contratos", "POST", { pessoa_id: cliente.id, processo_id: proc.id, descricao: "Honorários unificados", valor_total: "900,00", parcelas: 3, primeiro_vencimento: "2026-01-10" }, admin.cookie);
    const fin = (await req(`/financeiro/pessoas/${cliente.id}`, "GET", undefined, admin.cookie)).json;
    expect(fin.totais).toMatchObject({ contratado_centavos: 90000, recebido_centavos: 0, em_aberto_centavos: 90000, atrasado_centavos: 90000 });
    expect(fin.contratos).toHaveLength(1);
    expect(fin.lancamentos).toHaveLength(3);
    const adv = await entrar("advogado");
    expect((await req(`/financeiro/pessoas/${cliente.id}`, "GET", undefined, adv.cookie)).status).toBe(403); // sem permissão financeira
  });
});

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

describe("modelo da ficha: personalização, logotipo, foto e Word", () => {
  it("personaliza título, cabeçalho, seções, assinatura; logotipo e foto aparecem na ficha", async () => {
    const admin = await entrar("administrador");
    const leitor = await entrar("consulta");
    const cfg0 = (await req("/ficha/config", "GET", undefined, admin.cookie)).json;
    expect(cfg0.config.titulo).toBe("FICHA PROCESSUAL");
    expect(cfg0.config.secoes.endereco).toBe(true);
    expect((await req("/ficha/config", "PUT", { titulo: "X" }, leitor.cookie)).status).toBe(403); // só quem edita

    const salvo = await req("/ficha/config", "PUT", { titulo: "FICHA DE ATENDIMENTO <script>", subtitulo: "Previdenciário", nome_escritorio: "Sales & Associados", cabecalho_linhas: ["Rua A, 10 — Centro", "(11) 3333-0000", "OAB/SP 123.456", "quarta linha descartada"], rodape: "Documento interno", linhas_observacoes: 3, secoes: { endereco: false, processos: false }, assinatura: true, texto_assinatura: "Declaro que os dados são verdadeiros." }, admin.cookie);
    expect(salvo.json.config).toMatchObject({ subtitulo: "Previdenciário", linhas_observacoes: 3, assinatura: true });
    expect(salvo.json.config.cabecalho_linhas).toHaveLength(3);
    expect(salvo.json.config.secoes).toMatchObject({ endereco: false, processos: false, identificacao: true });
    expect((await req("/ficha/config", "PUT", { linhas_observacoes: 999 }, admin.cookie)).json.config.linhas_observacoes).toBe(9); // fora do limite volta ao padrão
    await req("/ficha/config", "PUT", { linhas_observacoes: 3 }, admin.cookie);

    // logotipo: só PNG/JPG/WebP reais
    expect((await bruto("/ficha/logo", Buffer.from("<svg onload=alert(1)>"), admin.cookie)).status).toBe(400);
    expect((await bruto("/ficha/logo", Buffer.concat([PNG, Buffer.alloc(1100 * 1024)]), admin.cookie)).status).toBe(413);
    expect((await bruto("/ficha/logo", PNG, admin.cookie)).status).toBe(200);
    expect((await bruto("/ficha/logo", PNG, leitor.cookie)).status).toBe(403);
    const logoGet = await fetch(`${await ready}/api/gestao/ficha/logo`, { headers: { Cookie: admin.cookie } });
    expect(logoGet.headers.get("content-type")).toBe("image/png");
    expect(logoGet.headers.get("x-content-type-options")).toBe("nosniff");

    const pessoa = (await req("/pessoas", "POST", { nome: "Cliente Com Foto", logradouro: "Rua Escondida" }, admin.cookie)).json;
    expect(pessoa.tem_foto).toBe(false);
    expect((await bruto(`/pessoas/${pessoa.id}/foto`, Buffer.from("não é imagem"), admin.cookie)).status).toBe(400);
    expect((await bruto(`/pessoas/${pessoa.id}/foto`, PNG, admin.cookie)).status).toBe(200);
    expect((await req(`/pessoas/${pessoa.id}`, "GET", undefined, admin.cookie)).json.tem_foto).toBe(true);
    expect((await fetch(`${await ready}/api/gestao/pessoas/${pessoa.id}/foto`, { headers: { Cookie: admin.cookie } })).status).toBe(200);

    const ficha = (await baixar(`/pessoas/${pessoa.id}/ficha?imprimir=0`, admin.cookie)).texto;
    expect(ficha).toContain("FICHA DE ATENDIMENTO &lt;script&gt;"); // título escapado
    expect(ficha).toContain("Sales &amp; Associados");
    expect(ficha).toContain("OAB/SP 123.456");
    expect(ficha).not.toContain("quarta linha descartada");
    expect((ficha.match(/data:image\/png;base64/g) || []).length).toBe(2); // foto do cliente + logotipo
    expect(ficha).not.toContain("ENDEREÇO"); // seção desligada
    expect(ficha).not.toContain("Rua Escondida");
    expect(ficha).toContain("DADOS DE IDENTIFICAÇÃO");
    expect(ficha).toContain("Declaro que os dados são verdadeiros.");
    expect(ficha).toContain("Assinatura do cliente");
    expect(ficha).toContain("Documento interno");
    expect((ficha.match(/class="pauta"/g) || []).length).toBe(3);

    // Word: baixa como arquivo editável
    const doc = await baixar(`/pessoas/${pessoa.id}/ficha?formato=doc`, admin.cookie);
    expect(doc.headers.get("content-type")).toMatch(/application\/msword/);
    expect(doc.headers.get("content-disposition")).toMatch(/^attachment; filename\*=UTF-8''/);
    expect(doc.texto).not.toContain("window.print()");

    // pré-visualização do modelo com cliente de exemplo
    const previa = await baixar("/ficha/previa", admin.cookie);
    expect(previa.texto).toContain("(exemplo)");
    expect(previa.texto).toContain("Pré-visualização");

    expect((await req(`/pessoas/${pessoa.id}/foto`, "DELETE", undefined, admin.cookie)).status).toBe(200);
    expect((await req(`/pessoas/${pessoa.id}`, "GET", undefined, admin.cookie)).json.tem_foto).toBe(false);
    expect((await req("/ficha/logo", "DELETE", undefined, admin.cookie)).status).toBe(200);
    expect((await fetch(`${await ready}/api/gestao/ficha/logo`, { headers: { Cookie: admin.cookie } })).status).toBe(404);
    // volta ao modelo original
    await req("/ficha/config", "PUT", FICHA_PADRAO_TESTE, admin.cookie);
  });
});
const FICHA_PADRAO_TESTE = { titulo: "FICHA PROCESSUAL", subtitulo: "Ficha de cadastro do cliente", nome_escritorio: "", cabecalho_linhas: [], rodape: "", mostrar_foto: true, linhas_observacoes: 9, secoes: { identificacao: true, endereco: true, contato: true, campos: true, processos: true, observacoes: true }, assinatura: false, texto_assinatura: "" };
