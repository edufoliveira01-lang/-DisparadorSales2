import { describe, expect, it } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { assinarRequisicao, chaveSso, verificarRequisicao } from "../src/atendimento/assinatura";
import { criarRotaContratos } from "../src/atendimento/rotaContratos";

const DESKCOMM = "d".repeat(40), PONTE = "p".repeat(40);

async function montar(porta: number | null, resposta: { status: number; corpo: unknown }) {
  const vistos: { url: string; init: RequestInit }[] = [];
  const http = (async (url: string, init: RequestInit) => { vistos.push({ url: String(url), init }); return new Response(JSON.stringify(resposta.corpo), { status: resposta.status }); }) as unknown as typeof fetch;
  const app = express();
  app.use("/contratos", criarRotaContratos({ segredoDeskcomm: DESKCOMM, segredoAtendimento: PONTE, porta: () => porta, http }));
  const server = createServer(app);
  const base = await new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  const chamar = async (metodo: string, caminho: string, corpo = "", assinar = true, segredo = DESKCOMM) => {
    const ts = Math.floor(Date.now() / 1000);
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (assinar) { headers["x-sales-timestamp"] = String(ts); headers["x-sales-signature"] = assinarRequisicao(segredo, { metodo, caminho, corpo }, ts); }
    const r = await fetch(`${base}/contratos${caminho}`, { method: metodo, headers, body: metodo === "GET" ? undefined : corpo });
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  return { chamar, vistos, fechar: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("painel — repasse de contratos do atendimento para o escritório", () => {
  it("assinatura errada ou ausente: 401, e nada é repassado", async () => {
    const m = await montar(3401, { status: 200, corpo: {} });
    expect((await m.chamar("POST", "/v1/offices/alfa/contratos", "{}", false)).status).toBe(401);
    expect((await m.chamar("POST", "/v1/offices/alfa/contratos", "{}", true, "outro".repeat(10))).status).toBe(401);
    expect(m.vistos).toHaveLength(0);
    await m.fechar();
  });
  it("repassa para a porta do escritório, assinando com a CHAVE DO ESCRITÓRIO", async () => {
    const m = await montar(3407, { status: 201, corpo: { id: 5, sign_url: "https://x" } });
    const corpo = JSON.stringify({ nome: "Ana" });
    const r = await m.chamar("POST", "/v1/offices/alfa/contratos", corpo);
    expect(r.status).toBe(201);
    expect(r.json.id).toBe(5);
    const v = m.vistos[0];
    expect(v.url).toBe("http://127.0.0.1:3407/api/integracao/contratos");
    const h = v.init.headers as Record<string, string>;
    expect(verificarRequisicao(chaveSso(PONTE, "alfa"), { metodo: "POST", caminho: "/api/integracao/contratos", corpo }, h["x-sales-timestamp"], h["x-sales-signature"])).toBe(true);
    expect(verificarRequisicao(chaveSso(PONTE, "beta"), { metodo: "POST", caminho: "/api/integracao/contratos", corpo }, h["x-sales-timestamp"], h["x-sales-signature"])).toBe(false);
    await m.fechar();
  });
  it("consulta o estado de um contrato; método errado é recusado", async () => {
    const m = await montar(3407, { status: 200, corpo: { status: "assinado" } });
    expect((await m.chamar("GET", "/v1/offices/alfa/contratos/12")).json.status).toBe("assinado");
    expect(m.vistos[0].url).toBe("http://127.0.0.1:3407/api/integracao/contratos/12");
    expect((await m.chamar("GET", "/v1/offices/alfa/contratos/opcoes")).status).toBe(200);
    expect(m.vistos[1].url).toBe("http://127.0.0.1:3407/api/integracao/contratos/opcoes");
    expect((await m.chamar("GET", "/v1/offices/alfa/contratos")).status).toBe(405);
    await m.fechar();
  });
  it("escritório sem instância: 404", async () => {
    const m = await montar(null, { status: 200, corpo: {} });
    expect((await m.chamar("POST", "/v1/offices/alfa/contratos", "{}")).status).toBe(404);
    await m.fechar();
  });
});

describe("painel — repasse de documentos do chat (fase 2 do Dropbox)", () => {
  it("repassa POST /documentos para o escritório, assinando com a chave dele; GET é recusado", async () => {
    const m = await montar(3409, { status: 201, corpo: { situacao: "aguardando_assinatura" } });
    const corpo = JSON.stringify({ origem_ref: "msg-1", tipo: "PARTE MÉDICA", titulo: "Laudo", url: "https://x.example/a" });
    const r = await m.chamar("POST", "/v1/offices/alfa/documentos", corpo);
    expect(r.status).toBe(201);
    expect(r.json.situacao).toBe("aguardando_assinatura");
    expect(m.vistos[0]!.url).toBe("http://127.0.0.1:3409/api/integracao/documentos");
    const h = m.vistos[0]!.init.headers as Record<string, string>;
    expect(verificarRequisicao(chaveSso(PONTE, "alfa"), { metodo: "POST", caminho: "/api/integracao/documentos", corpo }, h["x-sales-timestamp"], h["x-sales-signature"])).toBe(true);
    expect((await m.chamar("GET", "/v1/offices/alfa/documentos")).status).toBe(405);
    expect((await m.chamar("POST", "/v1/offices/alfa/documentos", corpo, false)).status).toBe(401);
    await m.fechar();
  });
});

describe("painel — repasse da saúde do armazenamento", () => {
  it("repassa GET /armazenamento/saude para o escritório e recusa POST e assinatura inválida", async () => {
    const m = await montar(3409, { status: 200, corpo: { problema: null } });
    const r = await m.chamar("GET", "/v1/offices/alfa/armazenamento/saude");
    expect(r.status).toBe(200);
    expect(m.vistos[0]!.url).toBe("http://127.0.0.1:3409/api/integracao/armazenamento/saude");
    expect((await m.chamar("POST", "/v1/offices/alfa/armazenamento/saude", "{}")).status).toBe(405);
    expect((await m.chamar("GET", "/v1/offices/alfa/armazenamento/saude", "", false)).status).toBe(401);
    await m.fechar();
  });
});

describe("painel — repasse dos indicadores do atendimento", () => {
  it("repassa POST /indicadores para o escritório; GET é recusado", async () => {
    const m = await montar(3409, { status: 201, corpo: { ok: true } });
    const corpo = JSON.stringify({ meses: [{ mes: "2026-11", novos: 3 }] });
    expect((await m.chamar("POST", "/v1/offices/alfa/indicadores", corpo)).status).toBe(201);
    expect(m.vistos[0]!.url).toBe("http://127.0.0.1:3409/api/integracao/indicadores");
    expect((await m.chamar("GET", "/v1/offices/alfa/indicadores")).status).toBe(405);
    await m.fechar();
  });
  it("repassa POST /anotacoes e /anotacoes/buscar para o escritório; GET é recusado", async () => {
    const m = await montar(3411, { status: 201, corpo: { ok: true } });
    expect((await m.chamar("POST", "/v1/offices/alfa/anotacoes/buscar", JSON.stringify({ telefone: "5513999991111" }))).status).toBe(201);
    expect(m.vistos[0]!.url).toBe("http://127.0.0.1:3411/api/integracao/anotacoes/buscar");
    expect((await m.chamar("POST", "/v1/offices/alfa/anotacoes", JSON.stringify({ pessoa_id: 1, texto: "ok" }))).status).toBe(201);
    expect(m.vistos[1]!.url).toBe("http://127.0.0.1:3411/api/integracao/anotacoes");
    expect((await m.chamar("GET", "/v1/offices/alfa/anotacoes")).status).toBe(405);
    await m.fechar();
  });
});
