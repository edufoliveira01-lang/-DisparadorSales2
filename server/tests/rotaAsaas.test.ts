import { describe, expect, it } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { chaveSso, verificarRequisicao } from "../src/atendimento/assinatura";
import { criarRotaAsaas } from "../src/atendimento/rotaAsaas";

const PONTE = "p".repeat(40);

async function montar(porta: number | null) {
  const vistos: { url: string; init: RequestInit }[] = [];
  const http = (async (url: string, init: RequestInit) => { vistos.push({ url: String(url), init }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }) as unknown as typeof fetch;
  const app = express(); app.use("/asaas", criarRotaAsaas({ segredoAtendimento: PONTE, porta: () => porta, http }));
  const server = createServer(app);
  const base = await new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
  return { base, vistos, fechar: () => new Promise<void>((r) => server.close(() => r())) };
}

describe("painel — aviso de pagamento do Asaas", () => {
  it("repassa o corpo e o token ao escritório, assinando com a chave dele", async () => {
    const m = await montar(3501);
    const corpo = JSON.stringify({ event: "PAYMENT_RECEIVED", payment: { id: "pay_1" } });
    const r = await fetch(`${m.base}/asaas/alfa`, { method: "POST", headers: { "Content-Type": "application/json", "asaas-access-token": "tok123" }, body: corpo });
    expect(r.status).toBe(200);
    expect(m.vistos[0]!.url).toBe("http://127.0.0.1:3501/api/integracao/asaas");
    const h = m.vistos[0]!.init.headers as Record<string, string>;
    expect(h["x-asaas-token"]).toBe("tok123");
    expect(verificarRequisicao(chaveSso(PONTE, "alfa"), { metodo: "POST", caminho: "/api/integracao/asaas", corpo }, h["x-sales-timestamp"], h["x-sales-signature"])).toBe(true);
    expect(m.vistos[0]!.init.body).toBe(corpo);
    await m.fechar();
  });
  it("escritório sem instância: 404; GET não existe", async () => {
    const m = await montar(null);
    expect((await fetch(`${m.base}/asaas/beta`, { method: "POST", body: "{}" })).status).toBe(404);
    expect((await fetch(`${m.base}/asaas/beta`)).status).toBe(404);
    expect(m.vistos).toHaveLength(0);
    await m.fechar();
  });
});
