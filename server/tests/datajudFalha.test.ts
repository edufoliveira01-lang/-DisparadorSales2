import { describe, expect, it } from "vitest";
import { buscarNoDataJud, ErroDataJud } from "../src/services/djen/datajud";

const CNJ = "10000941720268260681";
describe("DataJud: falha de rede diz a causa e tenta de novo", () => {
  it("tempo esgotado nas duas tentativas: a mensagem traz o motivo real", async () => {
    let n = 0;
    const http = (async () => { n++; const e = new Error("t"); e.name = "TimeoutError"; throw e; }) as unknown as typeof fetch;
    await expect(buscarNoDataJud(CNJ, "chave-de-teste-1234567890", http)).rejects.toThrow(/sem resposta em 60 s/);
    expect(n).toBe(2);
  });
  it("erro 503 na primeira vez e sucesso na segunda: devolve o resultado", async () => {
    let n = 0;
    const http = (async () => { n++; return n === 1 ? new Response("x", { status: 503 }) : new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 }); }) as unknown as typeof fetch;
    expect(await buscarNoDataJud(CNJ, "chave-de-teste-1234567890", http)).toBeNull();
    expect(n).toBe(2);
  });
  it("chave recusada não repete e avisa", async () => {
    let n = 0;
    const http = (async () => { n++; return new Response("x", { status: 401 }); }) as unknown as typeof fetch;
    await expect(buscarNoDataJud(CNJ, "chave-de-teste-1234567890", http)).rejects.toBeInstanceOf(ErroDataJud);
    expect(n).toBe(1);
  });
});

import { pausaDoDataJudMs, reiniciarPausaDoDataJud } from "../src/services/djen/datajud";
describe("DataJud: limite de consultas (HTTP 429)", () => {
  it("429 pausa as consultas, avisa em português e não bate na API enquanto durar a pausa", async () => {
    reiniciarPausaDoDataJud();
    let n = 0;
    const http = (async () => { n++; return new Response("x", { status: 429, headers: { "retry-after": "120" } }); }) as unknown as typeof fetch;
    await expect(buscarNoDataJud(CNJ, "chave-de-teste-1234567890", http)).rejects.toThrow(/limitou as consultas/);
    expect(pausaDoDataJudMs()).toBeGreaterThan(100_000);
    await expect(buscarNoDataJud(CNJ, "chave-de-teste-1234567890", http)).rejects.toThrow(/limitou as consultas/);
    expect(n).toBe(1); // a segunda nem chegou à API
    reiniciarPausaDoDataJud();
  });
});
