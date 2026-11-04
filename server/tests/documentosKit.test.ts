import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, describe, expect, it } from "vitest";
import { db } from "../src/db";
import { authRouter } from "../src/routes/auth";
import { gestaoRouter } from "../src/routes/gestao";
import { authenticatedApi } from "../src/middleware/access";
import { hashPassword } from "../src/services/authService";
import { numeroPorExtenso } from "../src/services/gestao/documentos";
import { dimensoesDaImagem } from "../src/services/gestao/docx";
import { crc32 } from "../src/services/gestao/zip";

const app = express();
app.use(cookieParser(), express.json());
app.use("/api/auth", authRouter);
app.use("/api", authenticatedApi);
app.use("/api/gestao", gestaoRouter);
const server = createServer(app);
const ready = new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
async function entrar(role: string, perms?: string[]) {
  const nome = `d_${role}_${Math.random().toString(36).slice(2, 8)}`;
  db.prepare("INSERT INTO users (username, display_name, role, permissions_json, password_hash) VALUES (?, ?, ?, ?, ?)").run(nome, `Pessoa ${nome}`, role, perms ? JSON.stringify(perms) : null, hashPassword("senha-bem-segura-1"));
  const r = await fetch(`${await ready}/api/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: nome, password: "senha-bem-segura-1" }) });
  return (r.headers.get("set-cookie") || "").split(";")[0];
}
async function chamar(p: string, method = "GET", body?: unknown, cookie = "") {
  const r = await fetch(`${await ready}/api/gestao${p}`, { method, headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const tipo = r.headers.get("content-type") || "";
  return { status: r.status, tipo, json: tipo.includes("json") ? ((await r.json()) as any) : null, buf: tipo.includes("json") ? Buffer.alloc(0) : Buffer.from(await r.arrayBuffer()) };
}
/** CPF válido e único a cada execução (o banco de testes pode ser compartilhado entre arquivos). */
function cpfNovo() {
  const n = Array.from({ length: 9 }, () => Math.floor(Math.random() * 10));
  const dv = (a: number[]) => { const s = a.reduce((x, d, i) => x + d * (a.length + 1 - i), 0) % 11; return s < 2 ? 0 : 11 - s; };
  const d1 = dv(n), d2 = dv([...n, d1]);
  const todos = [...n, d1, d2].join("");
  return /^(\d)\1+$/.test(todos) ? cpfNovo() : todos;
}
/** Número CNJ válido (calcula o dígito verificador). */
function cnjNovo() {
  const seq = String(Math.floor(Math.random() * 9_000_000) + 1_000_000), resto = "202480026" + "0100";
  const dv = String(98n - (BigInt(`${seq}${resto}00`) % 97n)).padStart(2, "0");
  return `${seq}${dv}${resto}`;
}
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
const ESCRITORIO = {
  nome: "Silva & Associados Advocacia", razao_social: "Maria Silva Sociedade Individual de Advocacia", oab_sociedade: "12.345", cnpj: "00.000.000/0001-00", uf: "SP", cidade: "Santos",
  endereco: "Rua das Flores, 100, Sala 2, Centro, Santos/SP, CEP 11000-000", telefones: ["(13) 3333-0000", "(13) 99999-0000"], email: "contato@exemplo.com.br",
  advogados: [{ tratamento: "Dra.", nome: "Maria Silva", nacionalidade: "brasileira", oab: "OAB/SP nº 111.111", cpf: "111.111.111-11" }, { tratamento: "Dr.", nome: "João Souza", nacionalidade: "brasileiro", oab: "OAB/SP nº 222.222", cpf: "222.222.222-22" }],
  testemunhas: [{ nome: "Ana Testemunha", cpf: "333.333.333-33" }, { nome: "Beto Testemunha", cpf: "444.444.444-44" }],
};

describe("kit de documentos", () => {
  it("números por extenso, tamanho da imagem e CRC", () => {
    expect(numeroPorExtenso(3)).toBe("três");
    expect(numeroPorExtenso(30)).toBe("trinta");
    expect(numeroPorExtenso(25)).toBe("vinte e cinco");
    expect(numeroPorExtenso(100)).toBe("cem");
    expect(dimensoesDaImagem(PNG)).toEqual({ w: 1, h: 1 });
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("monta o kit comum, a rogo e representado; gera HTML e Word; aplica permissões", async () => {
    const admin = await entrar("administrador");
    // sem nada preenchido o kit ainda sai (com linhas em branco) e avisa o que falta
    const CPF = cpfNovo();
    const pessoa = (await chamar("/pessoas", "POST", { nome: "Jussara Exemplo", documento: CPF, rg: "19.761.318", estado_civil: "solteira", logradouro: "Rua A", numero: "41", bairro: "Centro", cidade: "Santos", uf: "SP", cep: "11000000" }, admin)).json;
    const base = { pessoa_id: pessoa.id, documentos: ["procuracao", "hipossuficiencia", "contrato", "declaracao_honorarios", "termo_ciencia"], data: "hoje" };
    const vazio = await chamar("/documentos/preparar", "POST", { ...base, variante: "comum" }, admin);
    expect(vazio.status).toBe(200);
    expect(vazio.json.faltando).toContain("escritorio.razao_social");

    expect((await chamar("/escritorio", "PUT", ESCRITORIO, admin)).status).toBe(200);
    const logoBytes = process.env.KIT_LOGO ? fs.readFileSync(process.env.KIT_LOGO) : PNG;
    expect((await fetch(`${await ready}/api/gestao/ficha/logo`, { method: "POST", headers: { "Content-Type": "application/octet-stream", Cookie: admin }, body: logoBytes })).status).toBe(200);

    // comum
    const prep = await chamar("/documentos/preparar", "POST", { ...base, variante: "comum", honorarios: { beneficios: 2, percentual: 20 } }, admin);
    expect(prep.status).toBe(200);
    expect(prep.json.faltando).toEqual([]);
    const html = (await chamar(`/documentos/kit/${prep.json.token}`, "GET", undefined, admin)).buf.toString("utf8");
    expect(html).toContain("PROCURAÇÃO");
    expect(html).toContain("<b>Jussara Exemplo</b>");
    expect(html).toContain("<b>Dra. MARIA SILVA</b>, brasileira, inscrita na OAB/SP nº 111.111");
    expect(html).toContain("o primeiro sócio, os demais associados");
    expect(html).toContain("2 (dois) benefícios");
    expect(html).toContain("20% (vinte por cento)");
    expect(html).toContain("Santos, ");
    expect(html).toContain("Testemunha 1: <b>ANA TESTEMUNHA</b>");
    expect(html).toContain("Rua das Flores, 100");
    expect(html).not.toContain("<script"); // sem imprimir=1 não há script

    // a rogo exige quem assina e leva testemunhas + digital
    expect((await chamar("/documentos/preparar", "POST", { ...base, variante: "rogo" }, admin)).status).toBe(400);
    const rogo = await chamar("/documentos/preparar", "POST", { ...base, variante: "rogo", a_rogo: { nome: "Carlos Confiança", rg: "1", cpf: "2", endereco: "Rua B" }, data: "branco" }, admin);
    expect(rogo.status).toBe(200);
    const htmlRogo = (await chamar(`/documentos/kit/${rogo.json.token}?imprimir=1`, "GET", undefined, admin)).buf.toString("utf8");
    expect(htmlRogo).toContain("procuração a rogo");
    expect(htmlRogo).toContain("CARLOS CONFIANÇA");
    expect(htmlRogo).toContain("TESTEMUNHAS A ROGO:");
    expect(htmlRogo).toContain("Polegar direito do outorgante");
    expect(htmlRogo).toContain("Polegar direito do contratante");
    expect(htmlRogo).toContain("______ de ________________ de 20____");
    expect(htmlRogo).toContain("window.print");

    // representado
    expect((await chamar("/documentos/preparar", "POST", { ...base, variante: "representado" }, admin)).status).toBe(400);
    const repr = await chamar("/documentos/preparar", "POST", { ...base, documentos: ["procuracao"], variante: "representado", representante: { nome: "Paula Mãe", qualidade: "genitora", cpf: "5" } }, admin);
    const htmlRep = (await chamar(`/documentos/kit/${repr.json.token}`, "GET", undefined, admin)).buf.toString("utf8");
    expect(htmlRep).toContain("neste ato representado(a) por <b>Paula Mãe</b>");
    expect(htmlRep).toContain("na qualidade de genitora");

    // texto de usuário nunca vira HTML
    const hostil = await chamar("/documentos/preparar", "POST", { ...base, documentos: ["termo_ciencia"], variante: "representado", representante: { nome: "<img src=x onerror=alert(1)>" } }, admin);
    const htmlHostil = (await chamar(`/documentos/kit/${hostil.json.token}`, "GET", undefined, admin)).buf.toString("utf8");
    expect(htmlHostil).not.toContain("<img src=x");
    expect(htmlHostil).toContain("&lt;img src=x");

    // Word de verdade: zip íntegro com cabeçalho, rodapé e as 5 páginas
    const docx = await chamar(`/documentos/kit/${rogo.json.token}?formato=docx`, "GET", undefined, admin);
    expect(docx.tipo).toContain("wordprocessingml");
    expect(docx.buf.subarray(0, 2).toString()).toBe("PK");
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kitdocx-"));
    try {
      const arq = path.join(tmp, "kit.docx"); fs.writeFileSync(arq, docx.buf);
      try {
        execFileSync("unzip", ["-tq", arq]);
        const xml = execFileSync("unzip", ["-p", arq, "word/document.xml"]).toString("utf8");
        expect(xml).toContain("PROCURAÇÃO");
        expect(xml.match(/pageBreakBefore/g)?.length).toBe(4);
        expect(execFileSync("unzip", ["-p", arq, "word/footer1.xml"]).toString("utf8")).toContain("Rua das Flores");
      } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
      if (process.env.KIT_SAIDA) { for (const [nome, t] of [["comum", prep], ["rogo", rogo], ["repr", repr]] as const) { fs.writeFileSync(path.join(process.env.KIT_SAIDA, `${nome}.docx`), (await chamar(`/documentos/kit/${t.json.token}?formato=docx`, "GET", undefined, admin)).buf); fs.writeFileSync(path.join(process.env.KIT_SAIDA, `${nome}.html`), (await chamar(`/documentos/kit/${t.json.token}`, "GET", undefined, admin)).buf); } }
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

    // outro usuário não abre o kit de alguém; token inventado não existe
    const outro = await entrar("administrador");
    expect((await chamar(`/documentos/kit/${prep.json.token}`, "GET", undefined, outro)).status).toBe(404);
    expect((await chamar("/documentos/kit/inventado", "GET", undefined, admin)).status).toBe(404);

    // permissões: quem só visualiza não gera nem altera
    const leitor = await entrar("visualizador", ["gestao.view"]);
    expect((await chamar("/escritorio", "GET", undefined, leitor)).status).toBe(200);
    expect((await chamar("/escritorio", "PUT", ESCRITORIO, leitor)).status).toBe(403);
    expect((await chamar("/documentos/preparar", "POST", { ...base, variante: "comum" }, leitor)).status).toBe(403);
    expect((await chamar("/documentos/previa?variante=rogo&doc=procuracao", "GET", undefined, leitor)).status).toBe(200);
  });

  it("imagens do escritório: cabeçalho e rodapé dos documentos, logotipo da ficha e ícone público", async () => {
    const admin = await entrar("administrador");
    const subir = async (caminho: string, corpo: Buffer, cookie = admin) => fetch(`${await ready}/api/gestao${caminho}`, { method: "POST", headers: { "Content-Type": "application/octet-stream", Cookie: cookie }, body: corpo });
    expect((await subir("/imagens/inexistente", PNG)).status).toBe(404);
    expect((await subir("/imagens/cabecalho", Buffer.from("<svg onload=alert(1)>"))).status).toBe(400);
    expect((await subir("/imagens/favicon", Buffer.alloc(600 * 1024, 1))).status).toBe(413);
    expect((await subir("/imagens/cabecalho", PNG)).status).toBe(200);
    expect((await subir("/imagens/rodape", PNG)).status).toBe(200);
    const ICO = Buffer.concat([Buffer.from([0, 0, 1, 0, 1, 0]), Buffer.alloc(30)]);
    expect((await subir("/imagens/cabecalho", ICO)).status).toBe(400); // ICO só vale para o ícone
    expect((await subir("/imagens/favicon", ICO)).status).toBe(200);
    // o ícone e o nome são públicos (aba do navegador e tela de login); as demais imagens exigem acesso
    const semLogin = await fetch(`${await ready}/api/auth/identidade`);
    const ident = (await semLogin.json()) as any;
    expect(ident.favicon_url).toContain("/api/auth/favicon");
    const fav = await fetch(`${await ready}${ident.favicon_url}`);
    expect(fav.status).toBe(200);
    expect(fav.headers.get("content-type")).toBe("image/x-icon");
    expect((await fetch(`${await ready}/api/gestao/imagens/cabecalho`)).status).toBe(401);
    // alinhamentos
    expect((await chamar("/escritorio", "PUT", { ...ESCRITORIO, cabecalho_alinhamento: "right", rodape_alinhamento: "left" }, admin)).json.escritorio.cabecalho_alinhamento).toBe("right");
    expect((await chamar("/escritorio", "PUT", { cabecalho_alinhamento: "diagonal" }, admin)).json.escritorio.cabecalho_alinhamento).toBe("center");
    await chamar("/escritorio", "PUT", { cabecalho_alinhamento: "right", rodape_alinhamento: "left" }, admin);
    const pessoa = (await chamar("/pessoas", "POST", { nome: "Cliente Imagem", documento: cpfNovo() }, admin)).json;
    const prep = await chamar("/documentos/preparar", "POST", { pessoa_id: pessoa.id, documentos: ["termo_ciencia"], variante: "comum" }, admin);
    const html = (await chamar(`/documentos/kit/${prep.json.token}`, "GET", undefined, admin)).buf.toString("utf8");
    expect(html).toContain('class="cab" style="text-align:right"');
    expect(html).toContain('class="rodape" style="text-align:left"');
    expect(html).toContain('class="img-rodape"');
    const docx = (await chamar(`/documentos/kit/${prep.json.token}?formato=docx`, "GET", undefined, admin)).buf;
    try {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "kitimg-")); const arq = path.join(tmp, "k.docx"); fs.writeFileSync(arq, docx);
      const lista = execFileSync("unzip", ["-l", arq]).toString();
      expect(lista).toContain("word/media/logo.png"); expect(lista).toContain("word/media/rodape.png"); expect(lista).toContain("word/_rels/footer1.xml.rels");
      expect(execFileSync("unzip", ["-p", arq, "word/header1.xml"]).toString()).toContain('w:jc w:val="right"');
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
    // ficha: usa o cabeçalho dos documentos ou imagem própria, com alinhamento
    await chamar("/ficha/config", "PUT", { logo_modo: "mesma", logo_alinhamento: "right" }, admin);
    const ficha = await fetch(`${await ready}/api/gestao/ficha/previa`, { headers: { Cookie: admin } });
    const htmlFicha = await ficha.text();
    expect(htmlFicha).toContain('alt="Logotipo"');
    const cfg = (await chamar("/ficha/config", "GET", undefined, admin)).json;
    expect(cfg.config.logo_modo).toBe("mesma"); expect(cfg.config.logo_alinhamento).toBe("right"); expect(cfg.tem_cabecalho).toBe(true);
    // remove
    expect((await chamar("/imagens/favicon", "DELETE", undefined, admin)).status).toBe(200);
    expect((await fetch(`${await ready}/api/auth/favicon`)).status).toBe(404);
  });

  it("documento próprio entra no kit (com assinatura ou sem), edita e exclui", async () => {
    const admin = await entrar("administrador");
    expect((await chamar("/documentos/proprios", "POST", { nome: "x", texto: "curto" }, admin)).status).toBe(400);
    const criado = await chamar("/documentos/proprios", "POST", { nome: "Termo de renúncia", texto: "{{outorgante.qualificacao}} declara que renuncia ao valor excedente.", pt: 12 }, admin);
    expect(criado.status).toBe(201);
    const id = criado.json.documento.id as string;
    expect(id).toMatch(/^x_[a-f0-9]{10}$/);
    const lista = (await chamar("/documentos/config", "GET", undefined, admin)).json;
    expect(lista.documentos.find((d: any) => d.id === id)).toMatchObject({ nome: "Termo de renúncia", proprio: true });
    const pessoa = (await chamar("/pessoas", "POST", { nome: "Cliente Próprio", documento: cpfNovo() }, admin)).json;
    const gerar = async (variante: string, extra: any = {}) => {
      const p = await chamar("/documentos/preparar", "POST", { pessoa_id: pessoa.id, documentos: [id], variante, data: "hoje", ...extra }, admin);
      expect(p.status).toBe(200);
      return (await chamar(`/documentos/kit/${p.json.token}`, "GET", undefined, admin)).buf.toString("utf8");
    };
    const html = await gerar("comum");
    expect(html).toContain("TERMO DE RENÚNCIA".length ? "Termo de renúncia" : "");
    expect(html).toContain("<b>Cliente Próprio</b>");
    expect(html).toContain("renuncia ao valor excedente");
    expect(html).toContain('class="assina"');
    expect((await gerar("rogo", { a_rogo: { nome: "Fulano" } }))).toContain("TESTEMUNHAS A ROGO:");
    expect((await chamar(`/documentos/proprios/${id}`, "PUT", { assinatura: false }, admin)).status).toBe(200);
    expect(await gerar("comum")).not.toContain('class="assina"');
    expect((await chamar("/documentos/proprios/x_naoexiste1", "DELETE", undefined, admin)).status).toBe(404);
    expect((await chamar(`/documentos/proprios/${id}`, "DELETE", undefined, admin)).status).toBe(200);
    expect((await chamar("/documentos/preparar", "POST", { pessoa_id: pessoa.id, documentos: [id], variante: "comum" }, admin)).status).toBe(400);
    const leitor = await entrar("visualizador", ["gestao.view"]);
    expect((await chamar("/documentos/proprios", "POST", { nome: "Meu documento", texto: "texto do documento" }, leitor)).status).toBe(403);
  });

  it("anotação rápida: no cadastro do cliente ou em um processo dele", async () => {
    const admin = await entrar("administrador");
    const pessoa = (await chamar("/pessoas", "POST", { nome: "Cliente Anotação", documento: cpfNovo() }, admin)).json;
    const outra = (await chamar("/pessoas", "POST", { nome: "Outra Pessoa", documento: cpfNovo() }, admin)).json;
    expect((await chamar("/anotacao-rapida", "POST", { pessoa_id: pessoa.id, texto: "a" }, admin)).status).toBe(400);
    expect((await chamar("/anotacao-rapida", "POST", { texto: "sem cliente" }, admin)).status).toBe(400);
    const sem = await chamar("/anotacao-rapida", "POST", { pessoa_id: pessoa.id, texto: "Ligou pedindo retorno sobre o laudo." }, admin);
    expect(sem.status).toBe(201); expect(sem.json.destino).toBe("cadastro");
    const proc = await chamar("/processos", "POST", { numero: cnjNovo(), titulo: "Ação teste", partes: [{ pessoa_id: pessoa.id, papel: "autor", principal: true }] }, admin);
    expect(proc.status).toBe(201);
    {
      const com = await chamar("/anotacao-rapida", "POST", { pessoa_id: pessoa.id, processo_id: proc.json.id, texto: "Anotação dentro do processo." }, admin);
      expect(com.json.destino).toBe("processo");
      expect((await chamar("/anotacao-rapida", "POST", { pessoa_id: outra.id, processo_id: proc.json.id, texto: "não é dela" }, admin)).status).toBe(400);
    }
    const lista = (await chamar(`/pessoas/${pessoa.id}/anotacoes`, "GET", undefined, admin)).json.itens as any[];
    expect(lista.some((a) => a.origem === "cadastro" && a.texto.includes("laudo"))).toBe(true);
    expect(lista.some((a) => a.origem === "processo" && a.processo_rotulo)).toBe(true);
    const outro = await entrar("gestor", ["gestao.view", "gestao.manage"]);
    const id = lista.find((a) => a.origem === "cadastro").id;
    expect((await chamar(`/pessoas/${pessoa.id}/anotacoes/${id}`, "DELETE", undefined, outro)).status).toBe(403);
    expect((await chamar(`/pessoas/${pessoa.id}/anotacoes/${id}`, "DELETE", undefined, admin)).status).toBe(200);
    const leitor = await entrar("visualizador", ["gestao.view"]);
    expect((await chamar(`/pessoas/${pessoa.id}/anotacoes`, "GET", undefined, leitor)).status).toBe(200);
    expect((await chamar("/anotacao-rapida", "POST", { pessoa_id: pessoa.id, texto: "tentativa sem permissão" }, leitor)).status).toBe(403);
  });

  it("textos editáveis: salva, volta ao padrão e rejeita vazio", async () => {
    const admin = await entrar("administrador");
    const antes = (await chamar("/documentos/config", "GET", undefined, admin)).json;
    expect(antes.textos.contrato.comum).toContain("CONTRATO DE PRESTAÇÃO DE SERVIÇOS ADVOCATÍCIOS");
    expect((await chamar("/documentos/config", "PUT", { textos: { termo_ciencia: { comum: "  " } } }, admin)).status).toBe(400);
    const novo = (await chamar("/documentos/config", "PUT", { textos: { termo_ciencia: { comum: "# TERMO PRÓPRIO\n\n{{cliente.nome}} está ciente." } }, tamanhos: { termo_ciencia: 12 } }, admin)).json;
    expect(novo.personalizados.termo_ciencia).toEqual(["comum"]);
    expect(novo.tamanhos.termo_ciencia).toBe(12);
    const pessoa = (await chamar("/pessoas", "POST", { nome: "Cliente Texto" }, admin)).json;
    const p = await chamar("/documentos/preparar", "POST", { pessoa_id: pessoa.id, documentos: ["termo_ciencia"], variante: "comum" }, admin);
    expect((await chamar(`/documentos/kit/${p.json.token}`, "GET", undefined, admin)).buf.toString("utf8")).toContain("TERMO PRÓPRIO");
    const volta = (await chamar("/documentos/config/restaurar", "POST", { documento: "termo_ciencia", variante: "comum" }, admin)).json;
    expect(volta.personalizados.termo_ciencia).toEqual([]);
    expect(volta.textos.termo_ciencia.comum).toContain("TERMO DE CIÊNCIA E RESPONSABILIDADE");
  });
});
