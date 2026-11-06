import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterAll, describe, expect, it } from "vitest";
import { assinarRequisicao, chaveSso } from "../src/atendimento/assinatura";
import { db } from "../src/db";
import { integracaoContratosRouter } from "../src/routes/integracaoContratos";
import { adicionarDocumentoExtra, consultarDocumento, criarDocumento, ErroZapSign, posicionarAssinaturas, urlBaseDe } from "../src/zapsign/api";
import { posicoesDasAssinaturas, posicoesPorMarcadores } from "../src/zapsign/pdf";
import { envelopesDoContrato, ErroContrato, estadoDoContrato, gerarContrato } from "../src/zapsign/contratos";

const CONFIG = { token: "x".repeat(40), ambiente: "sandbox" as const };

function http(respostas: { status?: number; corpo: unknown }[], chamadas: { url: string; init: RequestInit }[] = []) {
  return (async (url: string, init: RequestInit) => {
    chamadas.push({ url: String(url), init });
    const r = respostas.shift() ?? { corpo: {} };
    return new Response(JSON.stringify(r.corpo), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
}
const doc = (n: number, extra: object = {}) => ({ token: `tok-${n}`, status: "pending", signers: [{ token: `sig-${n}`, sign_url: `https://app.zapsign.com.br/verificar/${n}`, status: "new" }], ...extra });
// 1 criação do envelope + 2 documentos extras
const TRES = () => [{ corpo: doc(1) }, { corpo: { token: "extra-2" } }, { corpo: { token: "extra-3" } }];
const PDF = async () => ({ pdf: Buffer.from("%PDF-1.4 teste"), assinaturas: [] });
const DOC = { token: "tok-1", status: "pending", signers: [{ sign_url: "https://app.zapsign.com.br/verificar/abc", status: "new" }] };

describe("ZapSign — cliente da API", () => {
  it("usa o endereço do ambiente certo", () => {
    expect(urlBaseDe({ token: "t", ambiente: "producao" })).toContain("api.zapsign.com.br");
    expect(urlBaseDe({ token: "t", ambiente: "sandbox" })).toContain("sandbox");
  });
  it("cria o documento com o PDF em base64, o signatário e o e-mail automático", async () => {
    const c: { url: string; init: RequestInit }[] = [];
    const r = await criarDocumento(CONFIG, { nome: "Contrato - Ana", pdfBase64: "UERG", signatario: { nome: "Ana", email: "ana@x.com", telefone: "(13) 97421-2623" }, idExterno: "pessoa-1" }, http([{ corpo: DOC }], c));
    expect(r).toMatchObject({ token: "tok-1", signUrl: "https://app.zapsign.com.br/verificar/abc" });
    expect((c[0].init.headers as Record<string, string>).Authorization).toBe(`Bearer ${CONFIG.token}`);
    const corpo = JSON.parse(String(c[0].init.body));
    expect(corpo).toMatchObject({ name: "Contrato - Ana", base64_pdf: "UERG", lang: "pt-br" });
    expect(corpo.signers[0]).toMatchObject({ name: "Ana", email: "ana@x.com", send_automatic_email: true, phone_country: "55", phone_number: "13974212623" });
  });
  it("sem e-mail, não pede envio automático por e-mail", async () => {
    const c: { url: string; init: RequestInit }[] = [];
    await criarDocumento(CONFIG, { nome: "n", pdfBase64: "x", signatario: { nome: "Ana" } }, http([{ corpo: DOC }], c));
    expect(JSON.parse(String(c[0].init.body)).signers[0].send_automatic_email).toBe(false);
  });
  it("chave recusada vira aviso claro; erro de rede também", async () => {
    await expect(criarDocumento(CONFIG, { nome: "n", pdfBase64: "x", signatario: { nome: "A" } }, http([{ status: 401, corpo: {} }]))).rejects.toThrow(/recusou a chave/);
    await expect(consultarDocumento(CONFIG, "t", (async () => { throw new Error("rede"); }) as unknown as typeof fetch)).rejects.toBeInstanceOf(ErroZapSign);
  });
  it("sem link na resposta é erro, não sucesso vazio", async () => {
    await expect(criarDocumento(CONFIG, { nome: "n", pdfBase64: "x", signatario: { nome: "A" } }, http([{ corpo: { token: "t", status: "pending", signers: [] } }]))).rejects.toThrow(/link de assinatura/);
  });
});

const CLIENTE = { nome: "Maria Aparecida de Souza", cpf: "529.982.247-25", rg: "12.345.678-9", nacionalidade: "brasileira", sexo: "F", estado_civil: "casada", profissao: "costureira", logradouro: "Rua das Flores", numero: "100", complemento: "apto 2", bairro: "Centro", cidade: "Santos", uf: "SP", cep: "11010-000", email: "maria@x.com", telefone: "13974212623", conversa_ref: "conv-1", criado_por: "Ana" };

describe("contrato — gerar e acompanhar", () => {
  it("cadastra o cliente e monta UM envelope: o 1º documento cria, os outros entram como documentos extras do mesmo link", async () => {
    const montados: number[] = [];
    const chamadas: { url: string; init: RequestInit }[] = [];
    const r = await gerarContrato(CLIENTE, "Ana", { config: CONFIG, http: http(TRES(), chamadas), pdf: async (kit) => { montados.push(kit.documentos.length); return { pdf: Buffer.from("%PDF-1.4 teste"), assinaturas: [] }; } });
    expect(montados).toEqual([1, 1, 3]);
    expect(r.documentos).toHaveLength(1);
    expect(r.sign_url).toBe("https://app.zapsign.com.br/verificar/1");
    expect(r).toMatchObject({ status: "enviado", email_enviado: true });
    expect(chamadas.map((c) => c.url.replace(/^.*\/v1/, ""))).toEqual(["/docs/", "/docs/tok-1/upload-extra-doc/", "/docs/tok-1/upload-extra-doc/"]);
    expect(JSON.parse(String(chamadas[1]!.init.body))).toMatchObject({ name: "Declaração de hipossuficiência - Maria Aparecida de Souza", base64_pdf: expect.any(String) });
    expect(JSON.parse(String(chamadas[2]!.init.body)).name).toBe("Contrato e declarações - Maria Aparecida de Souza");
    const pessoa = db.prepare("SELECT nome, documento, sexo, nacionalidade, cidade FROM gestao_pessoas WHERE id=?").get(r.pessoa_id) as Record<string, string>;
    expect(pessoa).toMatchObject({ nome: "Maria Aparecida de Souza", documento: "52998224725", sexo: "F", nacionalidade: "brasileira", cidade: "Santos" });
    expect((db.prepare("SELECT COUNT(*) AS n FROM zapsign_documentos WHERE contrato_id=?").get(r.id) as { n: number }).n).toBe(3);
  });
  it("posiciona a assinatura em cada documento (o principal pelo token dele, cada extra pelo seu)", async () => {
    const chamadas: { url: string; init: RequestInit }[] = [];
    await gerarContrato(CLIENTE, "Ana", { config: CONFIG, http: http([{ corpo: doc(1) }, { corpo: {} }, { corpo: { token: "extra-2" } }, { corpo: {} }, { corpo: { token: "extra-3" } }, { corpo: {} }], chamadas), pdf: async () => ({ pdf: Buffer.from("%PDF"), assinaturas: [{ pagina: 0, esquerda: 10, baixo: 20 }] }) });
    const colocar = chamadas.filter((c) => c.url.includes("/place-signatures/")).map((c) => c.url.replace(/^.*\/docs\//, "").replace("/place-signatures/", ""));
    expect(colocar).toEqual(["tok-1", "extra-2", "extra-3"]);
    const corpo = JSON.parse(String(chamadas.find((c) => c.url.includes("/place-signatures/"))!.init.body));
    expect(corpo.rubricas[0]).toMatchObject({ page: 0, relative_position_left: 10, relative_position_bottom: 20, type: "signature", signer_token: "sig-1" });
  });
  it("mesmo CPF atualiza o cadastro em vez de duplicar", async () => {
    const antes = (db.prepare("SELECT COUNT(*) AS n FROM gestao_pessoas WHERE documento='52998224725'").get() as { n: number }).n;
    await gerarContrato({ ...CLIENTE, profissao: "doméstica" }, "Ana", { config: CONFIG, http: http(TRES()), pdf: PDF });
    const depois = (db.prepare("SELECT COUNT(*) AS n FROM gestao_pessoas WHERE documento='52998224725'").get() as { n: number }).n;
    expect(depois).toBe(Math.max(antes, 1));
    expect((db.prepare("SELECT profissao FROM gestao_pessoas WHERE documento='52998224725'").get() as { profissao: string }).profissao).toBe("doméstica");
  });
  it("recusa dados incompletos e CPF inválido; sem ZapSign configurado, avisa", async () => {
    const dep = { config: CONFIG, http: http([]), pdf: PDF };
    await expect(gerarContrato({ ...CLIENTE, cpf: "111.111.111-11" }, "A", dep)).rejects.toThrow(/CPF/);
    await expect(gerarContrato({ ...CLIENTE, logradouro: "" }, "A", dep)).rejects.toThrow(/endereço/);
    await expect(gerarContrato(CLIENTE, "A", { ...dep, config: null })).rejects.toBeInstanceOf(ErroContrato);
  });
  it("acompanha: assinou o envelope, assinou todos; cada documento vira um arquivo separado, com o seu próprio PDF assinado", async () => {
    const g = await gerarContrato(CLIENTE, "Ana", { config: CONFIG, http: http(TRES()), pdf: PDF });
    let assinou = false;
    const zap = (async (url: string) => {
      const u = String(url);
      if (u.includes("/arquivos/")) return new Response(Buffer.from(`%PDF-1.4 ${u}`), { status: 200 });
      return new Response(JSON.stringify(doc(1, assinou ? { status: "signed", signed_file: "https://x/arquivos/a.pdf", extra_docs: [{ name: "Declaração de hipossuficiência - Maria Aparecida de Souza", signed_file: "https://x/arquivos/b.pdf" }, { name: "Contrato e declarações - Maria Aparecida de Souza", signed_file: "https://x/arquivos/c.pdf" }] } : {})), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await estadoDoContrato(g.id, { config: CONFIG, http: zap })).toMatchObject({ status: "enviado", assinados: 0, total: 3 });
    assinou = true;
    const e = await estadoDoContrato(g.id, { config: CONFIG, http: zap });
    expect(e).toMatchObject({ status: "assinado", assinados: 3, total: 3, arquivo_salvo: true });
    const nomes = (db.prepare("SELECT a.nome, a.categoria FROM gestao_arquivos a JOIN zapsign_documentos d ON d.arquivo_id=a.id WHERE d.contrato_id=? ORDER BY d.id").all(g.id) as { nome: string; categoria: string }[]);
    expect(nomes.map((n) => n.nome.split(" assinado")[0])).toEqual(["Procuração", "Declaração de hipossuficiência", "Contrato e declarações"]);
    expect(nomes.every((n) => n.categoria === "Contrato assinado")).toBe(true);
    expect((await estadoDoContrato(g.id, { config: CONFIG, http: http([]) })).status).toBe("assinado"); // já completo: não consulta de novo
  });
  it("o ZapSign recusando um extra faz o contrato falhar com a mensagem (e nada é gravado)", async () => {
    const antes = (db.prepare("SELECT COUNT(*) AS n FROM zapsign_contratos").get() as { n: number }).n;
    await expect(gerarContrato(CLIENTE, "Ana", { config: CONFIG, http: http([{ corpo: doc(1) }, { status: 400, corpo: {} }]), pdf: PDF })).rejects.toBeInstanceOf(ErroZapSign);
    expect((db.prepare("SELECT COUNT(*) AS n FROM zapsign_contratos").get() as { n: number }).n).toBe(antes);
  });
  it("adicionarDocumentoExtra: só nome e PDF; o resto o ZapSign herda do principal", async () => {
    const c: { url: string; init: RequestInit }[] = [];
    expect(await adicionarDocumentoExtra(CONFIG, "tok-9", { nome: "X", pdfBase64: "QUJD" }, http([{ corpo: { token: "e1" } }], c))).toEqual({ token: "e1" });
    expect(c[0]!.url).toMatch(/\/docs\/tok-9\/upload-extra-doc\/$/);
    expect(JSON.parse(String(c[0]!.init.body))).toEqual({ name: "X", base64_pdf: "QUJD" });
  });
  it("os 3 envelopes: documentos próprios do escritório entram no terceiro", () => {
    expect(envelopesDoContrato(["x_abc123"]).map((e) => e.ids)).toEqual([["procuracao"], ["hipossuficiencia"], ["contrato", "declaracao_honorarios", "termo_ciencia", "x_abc123"]]);
  });
  it("converte a medida da linha de assinatura nas coordenadas do ZapSign (origem embaixo) e pula documento de 2 páginas", () => {
    expect(posicoesDasAssinaturas([{ paginas: 1, esquerda: 9, topo: 60 }, { paginas: 2, esquerda: -1, topo: -1 }, { paginas: 1, esquerda: 9, topo: 50 }]))
      .toEqual([{ pagina: 0, esquerda: 10, baixo: 40.4 }, { pagina: 3, esquerda: 10, baixo: 50.4 }]);
  });
  it("lê do PDF a página e a posição exatas da linha de assinatura, mesmo em documento de várias páginas", () => {
    const link = (n: number, i: number, y: number) => `${n} 0 obj\n<</Type /Annot\n/Subtype /Link\n/Rect [59.5 ${y - 1.5} 238 ${y}]\n/A <</Type /Action\n/S /URI\n/URI (https://sales.invalid/assinatura/${i})>>>>\nendobj\n`;
    const pdf = `%PDF-1.4\n${link(6, 0, 420.945)}${link(9, 1, 200)}<</Type /Page\n/Parent 1 0 R\n>>\n<</Type /Page\n/Annots [6 0 R]\n>>\n<</Type /Page\n>>\n<</Type /Page\n/Annots [9 0 R]\n>>\n<</Type /Pages\n/Kids [2 0 R]>>`;
    const r = posicoesPorMarcadores(Buffer.from(pdf, "latin1"));
    expect(r.get(0)).toMatchObject({ pagina: 1 });
    expect(r.get(0)!.baixo).toBeCloseTo((420.945 / 841.89) * 100 + 0.4, 2);
    expect(r.get(0)!.esquerda).toBeCloseTo((59.5 / 595.28) * 100 + 1, 2);
    expect(r.get(1)).toMatchObject({ pagina: 3 });
    expect(posicoesPorMarcadores(Buffer.from("%PDF-1.4 sem marcas")).size).toBe(0);
  });
  it("se o ZapSign recusar o posicionamento, o contrato segue (a assinatura fica na posição padrão)", async () => {
    expect(await posicionarAssinaturas(CONFIG, "t", "s", [{ pagina: 0, esquerda: 1, baixo: 1 }], http([{ status: 400, corpo: {} }]))).toBe(false);
    expect(await posicionarAssinaturas(CONFIG, "t", "s", [], http([]))).toBe(true);
  });
});

const SEGREDO = "s".repeat(40), SLUG = "alfa";
const app = express();
app.use(express.json({ verify: (req, _res, buf) => { (req as { rawBody?: string }).rawBody = buf.toString("utf8"); } }));
app.use("/api/integracao", integracaoContratosRouter);
const server = createServer(app);
const base = new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

describe("rota de integração — só aceita quem assina com a chave do escritório", () => {
  const antes = { ...process.env };
  afterAll(() => { process.env = antes; });
  async function chamar(metodo: string, caminho: string, corpo: string, assinar: boolean) {
    process.env.ATENDIMENTO_PONTE_URL = "https://painel.example/ponte"; process.env.ATENDIMENTO_SEGREDO = SEGREDO; process.env.ATENDIMENTO_SLUG = SLUG; process.env.ATENDIMENTO_URL = "https://atendimento.example";
    const ts = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (assinar) { headers["x-sales-timestamp"] = String(ts); headers["x-sales-signature"] = assinarRequisicao(chaveSso(SEGREDO, SLUG), { metodo, caminho, corpo }, ts); }
    const r = await fetch(`${await base}${caminho}`, { method: metodo, headers, body: metodo === "GET" ? undefined : corpo });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  }
  it("sem assinatura: 401", async () => { expect((await chamar("POST", "/api/integracao/contratos", "{}", false)).status).toBe(401); });
  it("assinado, mas sem ZapSign configurado: 409 com o motivo (e não 401)", async () => {
    delete process.env.ZAPSIGN_TOKEN;
    const r = await chamar("POST", "/api/integracao/contratos", JSON.stringify(CLIENTE), true);
    expect([409, 422]).toContain(r.status);
    expect(r.status).not.toBe(401);
  });
  it("estado de contrato inexistente: 404", async () => {
    expect((await chamar("GET", "/api/integracao/contratos/999999", "", true)).status).toBe(404);
  });
});

describe("linha de assinatura do kit — configuração", () => {
  it("guarda espaço, largura, alinhamento e posição, e usa valores seguros fora do limite", async () => {
    const { salvarConfigDocumentos, lerConfigDocumentos, kitHtml, montarKit } = await import("../src/services/gestao/documentos");
    expect(lerConfigDocumentos().assinatura).toEqual({ espaco: 12, largura: 90, alinhamento: "left", posicao: "texto" });
    expect(salvarConfigDocumentos({ assinatura: { espaco: 30, largura: 70, alinhamento: "center", posicao: "fim" } }).assinatura).toEqual({ espaco: 30, largura: 70, alinhamento: "center", posicao: "fim" });
    expect(salvarConfigDocumentos({ assinatura: { espaco: 9999, largura: 1, alinhamento: "x", posicao: "y" } }).assinatura).toEqual({ espaco: 12, largura: 90, alinhamento: "left", posicao: "texto" });
    salvarConfigDocumentos({ assinatura: { espaco: 30, largura: 70, alinhamento: "right", posicao: "fim" } });
    const html = kitHtml(montarKit({ variante: "comum", documentos: ["procuracao"], data: "hoje" }, "Teste", true));
    expect(html).toContain('class="fim"');
    expect(html).toContain("width:70mm");
    expect(html).toContain("height:30mm");
    salvarConfigDocumentos({ assinatura: { espaco: 12, largura: 90, alinhamento: "left", posicao: "texto" } });
  });
});
