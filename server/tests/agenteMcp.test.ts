import { describe, expect, it } from "vitest";
import express from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { db } from "../src/db";
import { chaveDoServidorMcp } from "../src/atendimento/mcp/chave";
import { chaveDoTelefone, clientePeloTelefone } from "../src/atendimento/mcp/telefone";
import { tratarJsonRpc } from "../src/atendimento/mcp/servidor";
import { criarRotaMcp } from "../src/atendimento/rotaMcp";
import { verificarRequisicao, chaveSso } from "../src/atendimento/assinatura";

const chamar = (nome: string, args: Record<string, unknown>, telefone: string) => {
  const r = tratarJsonRpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: nome, arguments: args } }, { telefone }) as { result: { content: { text: string }[]; structuredContent: any; isError: boolean } };
  return { texto: r.result.content[0]!.text, dados: r.result.structuredContent, erro: r.result.isError };
};
const hoje = new Date(Date.now() - 3 * 3_600_000).toISOString().slice(0, 10);
const mais = (n: number) => new Date(Date.parse(`${hoje}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

function semear() {
  const ins = (sql: string, ...p: unknown[]) => Number(db.prepare(sql).run(...p).lastInsertRowid);
  const ana = ins("INSERT INTO gestao_pessoas(tipo,nome,documento,telefone,cidade,uf) VALUES ('cliente','Ana Souza','52998224725','(13) 97404-5973','Santos','SP')");
  const outra = ins("INSERT INTO gestao_pessoas(tipo,nome,documento,telefone) VALUES ('cliente','Beatriz Lima','11144477735','(11) 98888-7777')");
  const proc = ins("INSERT INTO gestao_processos(numero,chave,pasta,titulo,tribunal,orgao,area,fase,status) VALUES ('1000001-11.2025.8.26.0562','10000011120258260562','P-9001','Ana x INSS','TJSP','1ª Vara de Santos','previdenciario','Perícia','ativo')");
  db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,?,1)").run(proc, ana, "autor");
  const procBeatriz = ins("INSERT INTO gestao_processos(numero,chave,pasta,titulo,status) VALUES ('2000002-22.2025.8.26.0001','20000022220258260001','P-9002','Beatriz','ativo')");
  db.prepare("INSERT INTO gestao_partes(processo_id,pessoa_id,papel,principal) VALUES (?,?,?,1)").run(procBeatriz, outra, "autor");
  const per = (tipo: string, origem: string | null, data: string, chave: string, tel: string) => db.prepare("INSERT INTO pericias_agendadas(card_id,tipo,tipo_chave,origem,nome,nome_chave,telefone,telefone_digits,processo,processo_chave,data,horario,local,profissional_perito,data_hora_ms,status) VALUES ('c',?,?,?,'x','x','x',?,'p',?,?,'14:30','Fórum de Santos','Dr. Paulo',?,'ativa')")
    .run(tipo, tipo.toLowerCase(), origem, tel, chave, data, Date.parse(`${data}T14:30:00Z`));
  per("Perícia médica", null, mais(10), "10000011120258260562", "5513974045973");
  per("Audiência", "audiencia", mais(40), "10000011120258260562", "5513974045973");
  per("Perícia médica", null, mais(5), "20000022220258260001", "5511988887777"); // da OUTRA cliente
  db.prepare("INSERT INTO gestao_lancamentos(tipo,categoria,descricao,valor_centavos,vencimento,parcela_numero,parcela_total,pessoa_id) VALUES ('receber','honorarios','Honorários',50000,?,1,3,?)").run(mais(-5), ana);
  db.prepare("INSERT INTO gestao_lancamentos(tipo,categoria,descricao,valor_centavos,vencimento,parcela_numero,parcela_total,pessoa_id) VALUES ('receber','honorarios','Honorários',50000,?,2,3,?)").run(mais(25), ana);
  db.prepare("INSERT INTO gestao_arquivos(pessoa_id,nome,armazenado,categoria) VALUES (?,?,?,?)").run(ana, "RG frente.jpg", "zz-ana-1", "Documento pessoal");
  return { ana, outra, proc };
}

describe("servidor de ferramentas do agente (MCP) — o cliente é achado só pelo telefone", () => {
  semear();
  it("telefones de formatos diferentes casam; telefone curto ou desconhecido não acha ninguém", () => {
    expect(chaveDoTelefone("5513974045973")).toBe(chaveDoTelefone("(13) 97404-5973"));
    expect(chaveDoTelefone("1374045973")).toBe(chaveDoTelefone("5513974045973")); // número antigo, sem o 9
    expect(chaveDoTelefone("123")).toBeNull();
    expect(clientePeloTelefone("5513974045973")).toMatchObject({ achou: "um", cliente: { nome: "Ana Souza" } });
    expect(clientePeloTelefone("5521999990000")).toEqual({ achou: "nenhum" });
  });

  it("consultar_cliente devolve a visão geral SÓ da cliente do telefone — sem CPF nem dados de outra pessoa", () => {
    const r = chamar("consultar_cliente", {}, "5513974045973");
    expect(r.erro).toBe(false);
    expect(r.texto).toContain("Ana Souza");
    expect(r.texto).toContain("1000001-11.2025.8.26.0562");
    expect(r.texto).toContain("Perícia médica em");
    expect(r.texto).toContain("0/2 parcelas pagas");
    expect(r.texto).not.toContain("Beatriz");
    expect(JSON.stringify(r.dados)).not.toMatch(/52998224725|2000002/);
    expect(r.dados.compromissos_proximos).toHaveLength(2);
    expect(r.dados.documentos_recentes[0].nome).toBe("RG frente.jpg");
  });

  it("proximos_compromissos separa perícia de audiência e respeita a janela", () => {
    const todos = chamar("proximos_compromissos", {}, "5513974045973");
    expect(todos.dados.compromissos.map((c: any) => c.tipo)).toEqual(["Perícia médica", "Audiência"]);
    expect(todos.dados.compromissos[0]).toMatchObject({ horario: "14:30", local: "Fórum de Santos", perito: "Dr. Paulo" });
    const curto = chamar("proximos_compromissos", { dias: 15 }, "5513974045973");
    expect(curto.dados.compromissos).toHaveLength(1);
  });

  it("andamento_do_processo: com um processo só, não precisa do número; número de OUTRO cliente não é achado", () => {
    expect(chamar("andamento_do_processo", {}, "5513974045973").texto).toContain("Fase: Perícia");
    expect(chamar("andamento_do_processo", { processo: "2000002" }, "5513974045973").texto).toContain("Fase: Perícia"); // com 1 processo, o filtro não abre outro
    expect(chamar("andamento_do_processo", {}, "5511988887777").texto).toContain("2000002-22.2025.8.26.0001");
  });

  it("financeiro mostra a parcela em atraso e a próxima; sem cadastro, o agente é orientado a tratar como lead", () => {
    const f = chamar("financeiro_do_cliente", {}, "5513974045973");
    expect(f.dados.em_atraso).toHaveLength(1);
    expect(f.dados.a_vencer).toHaveLength(1);
    expect(f.texto).toContain("Em atraso");
    const nenhum = chamar("consultar_cliente", {}, "5521999990000");
    expect(nenhum.dados).toEqual({ encontrado: false });
    expect(nenhum.texto).toContain("lead");
    expect(chamar("consultar_cliente", {}, "").dados).toEqual({ encontrado: false });
  });

  it("telefone dividido por dois cadastros NÃO escolhe um: manda para a equipe", () => {
    db.prepare("INSERT INTO gestao_pessoas(tipo,nome,telefone) VALUES ('cliente','Mãe da Ana','(13) 97404-5973')").run();
    const r = chamar("consultar_cliente", {}, "5513974045973");
    expect(r.dados).toMatchObject({ ambiguo: true });
    expect(r.texto).toContain("mais de um cadastro");
    db.prepare("DELETE FROM gestao_pessoas WHERE nome='Mãe da Ana'").run();
  });

  it("JSON-RPC: initialize, tools/list (todas somente leitura), notificação sem resposta, método e ferramenta desconhecidos", () => {
    const init = tratarJsonRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, {}) as any;
    expect(init.result).toMatchObject({ protocolVersion: "2025-06-18", capabilities: { tools: {} } });
    const lista = tratarJsonRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, {}) as any;
    expect(lista.result.tools.map((t: any) => t.name)).toEqual(["consultar_cliente", "andamento_do_processo", "proximos_compromissos", "financeiro_do_cliente", "documentos_do_cliente"]);
    expect(lista.result.tools.every((t: any) => t.annotations.readOnlyHint === true)).toBe(true);
    // nenhuma ferramenta aceita id/telefone/cpf como argumento: o cliente nunca vem do modelo
    expect(JSON.stringify(lista.result.tools.map((t: any) => Object.keys(t.inputSchema.properties)))).not.toMatch(/telefone|cpf|cliente|pessoa/);
    expect(tratarJsonRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, {})).toBeNull();
    expect((tratarJsonRpc({ jsonrpc: "2.0", id: 3, method: "x/y" }, {}) as any).error.code).toBe(-32601);
    expect((tratarJsonRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "apagar_tudo" } }, {}) as any).error.code).toBe(-32602);
  });
});

describe("painel — /mcp/<slug>: chave, repasse assinado e o telefone do Deskcomm", () => {
  const DESKCOMM = "d".repeat(40), PONTE = "p".repeat(40);
  async function montar() {
    const vistos: { url: string; init: RequestInit }[] = [];
    const http = (async (url: string, init: RequestInit) => { vistos.push({ url: String(url), init }); return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }), { status: 200 }); }) as unknown as typeof fetch;
    const app = express();
    app.use("/mcp", criarRotaMcp({ segredoDeskcomm: DESKCOMM, segredoAtendimento: PONTE, porta: (s) => (s === "alfa" ? 3407 : null), http }));
    const server = createServer(app);
    const base = await new Promise<string>((r) => server.listen(0, "127.0.0.1", () => r(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
    return { base, vistos, fechar: () => new Promise<void>((r) => server.close(() => r())) };
  }
  it("chave errada: 401 e nada é repassado; método diferente de POST: 405", async () => {
    const m = await montar();
    const corpo = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    expect((await fetch(`${m.base}/mcp/alfa`, { method: "POST", headers: { "Content-Type": "application/json" }, body: corpo })).status).toBe(401);
    expect((await fetch(`${m.base}/mcp/alfa`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${chaveDoServidorMcp(DESKCOMM, "beta")}` }, body: corpo })).status).toBe(401); // chave de OUTRO escritório
    expect(m.vistos).toHaveLength(0);
    expect((await fetch(`${m.base}/mcp/alfa`, { headers: { Authorization: `Bearer ${chaveDoServidorMcp(DESKCOMM, "alfa")}` } })).status).toBe(405);
    await m.fechar();
  });
  it("repassa assinado com a chave do escritório, levando o telefone do cabeçalho do Deskcomm e o JSON-RPC", async () => {
    const m = await montar();
    const rpc = { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "consultar_cliente", arguments: {} } };
    const r = await fetch(`${m.base}/mcp/alfa`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${chaveDoServidorMcp(DESKCOMM, "alfa")}`, "x-deskcomm-contato-telefone": "5513974045973", "x-deskcomm-contato-id": "uuid-1", "x-deskcomm-canal": "whatsapp" }, body: JSON.stringify(rpc) });
    expect(r.status).toBe(200);
    const v = m.vistos[0]!;
    expect(v.url).toBe("http://127.0.0.1:3407/api/integracao/mcp");
    const corpo = String(v.init.body);
    expect(JSON.parse(corpo)).toEqual({ contato: { telefone: "5513974045973", id: "uuid-1", canal: "whatsapp" }, rpc });
    const h = v.init.headers as Record<string, string>;
    expect(verificarRequisicao(chaveSso(PONTE, "alfa"), { metodo: "POST", caminho: "/api/integracao/mcp", corpo }, h["x-sales-timestamp"], h["x-sales-signature"])).toBe(true);
    expect((await fetch(`${m.base}/mcp/inexistente`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${chaveDoServidorMcp(DESKCOMM, "inexistente")}` }, body: JSON.stringify(rpc) })).status).toBe(404);
    await m.fechar();
  });
});
