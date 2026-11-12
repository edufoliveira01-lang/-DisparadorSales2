import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

const enviadas: { fone: string; texto: string }[] = [];
const estado = { pronto: true, falhaEnvio: "" };
Object.assign(process.env, { ATENDIMENTO_PONTE_URL: "https://painel.exemplo/ponte", ATENDIMENTO_URL: "https://desk.exemplo", ATENDIMENTO_SLUG: "teste", ATENDIMENTO_SEGREDO: "x".repeat(40) });
const http = (async (url: string, init: RequestInit) => {
  const corpo = JSON.parse(String(init.body ?? "{}"));
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer dsk_token_de_teste_123456");
  if (String(url).endsWith("/open-with-contact")) return new Response(JSON.stringify({ data: { conversation_id: `c-${corpo.phone_number}` } }), { status: 201 });
  if (estado.falhaEnvio) return new Response(JSON.stringify({ error: { message: estado.falhaEnvio } }), { status: 502 });
  enviadas.push({ fone: String(corpo.conversation_id).slice(2), texto: corpo.body });
  return new Response(JSON.stringify({ data: { id: "m1" } }), { status: 201 });
}) as unknown as typeof fetch;

import { db } from "../src/db";
import { aplicarLink, previaDoAviso, textoDoModelo, enviarAviso, enviarEmLote, executarRegua, lerRegua, mensagemDoAviso, pausarAvisos, pendentesDaRegua, regraDe, salvarRegua } from "../src/services/gestao/regua";
import { salvarTokenDoDeskcomm } from "../src/services/gestao/deskcomm";
import { hojeSaoPaulo } from "../src/services/djen/cache";

const somar = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const pessoa = (tel = "(13) 99999-1111") => Number(db.prepare("INSERT INTO gestao_pessoas(nome,tipo,telefone) VALUES ('Maria Souza','cliente',?)").run(tel).lastInsertRowid);
const lanc = (p: number, venc: string, valor = 50000) => Number(db.prepare("INSERT INTO gestao_lancamentos(tipo,categoria,descricao,valor_centavos,vencimento,pessoa_id) VALUES ('receber','honorarios','Parcela 1/3',?,?,?)").run(valor, venc, p).lastInsertRowid);
const hoje = hojeSaoPaulo();
const tardeDemais = new Date(`${hoje}T23:00:00-03:00`);

beforeEach(() => {
  db.exec("DELETE FROM gestao_avisos_cobranca; DELETE FROM gestao_cobranca_pausa; DELETE FROM gestao_asaas_cobrancas; DELETE FROM gestao_lancamentos_historico; DELETE FROM gestao_lancamentos; DELETE FROM gestao_pessoas;");
  db.prepare("DELETE FROM settings WHERE chave IN ('cobranca_regua','asaas_api_key')").run();
  db.prepare("INSERT OR REPLACE INTO settings(chave,valor) VALUES ('send_interval_min','0'),('send_interval_max','0')").run();
  enviadas.length = 0; estado.pronto = true; estado.falhaEnvio = ""; salvarTokenDoDeskcomm("dsk_token_de_teste_123456");
});

describe("Cobrança pelo WhatsApp", () => {
  it("regra do dia: antes / hoje / depois", () => {
    expect(regraDe(somar(hoje, 3), hoje)).toBe("antes:3");
    expect(regraDe(hoje, hoje)).toBe("hoje");
    expect(regraDe(somar(hoje, -7), hoje)).toBe("depois:7");
  });
  it("mensagem muda conforme o vencimento e nunca fala em juros", () => {
    const p = { nome: "Maria Souza", descricao: "Parcela 1/3", valor_centavos: 50000, vencimento: somar(hoje, 1) };
    expect(mensagemDoAviso(p, hoje)).toContain("vence amanhã");
    expect(mensagemDoAviso({ ...p, vencimento: hoje }, hoje)).toContain("vence hoje");
    const atraso = mensagemDoAviso({ ...p, vencimento: somar(hoje, -2) }, hoje, { url: "https://x/i" });
    expect(atraso).toContain("ainda consta em aberto"); expect(atraso).toContain("https://x/i"); expect(atraso).not.toMatch(/juros|multa/i);
  });
  it("envio manual envia pelo Deskcomm e registra; falha do canal ou sem token fica registrada", async () => {
    const id = lanc(pessoa(), somar(hoje, -2));
    expect((await enviarAviso(id, { origem: "manual", http })).status).toBe("enviado");
    expect(enviadas).toHaveLength(1); expect(enviadas[0]!.fone).toBe("+5513999991111"); expect(enviadas[0]!.texto).toContain("Olá, Maria!");
    estado.falhaEnvio = "canal fora do ar";
    const r = await enviarAviso(id, { origem: "manual", http });
    expect(r.status).toBe("falhou"); expect(r.motivo).toContain("canal fora do ar");
    salvarTokenDoDeskcomm("");
    expect((await enviarAviso(id, { origem: "manual", http })).motivo).toContain("não foi ligado");
  });
  it("cliente sem telefone válido falha sem enviar", async () => {
    const r = await enviarAviso(lanc(pessoa("123"), hoje), { origem: "manual", http });
    expect(r).toMatchObject({ status: "falhou", motivo: "Cliente sem telefone válido." }); expect(enviadas).toHaveLength(0);
  });
  it("lote envia uma por parcela, ignora pausados e recusa sem o token do Deskcomm", async () => {
    const a = pessoa(), b = pessoa("(13) 98888-2222"); pausarAvisos(b, true);
    const ids = [lanc(a, hoje), lanc(a, somar(hoje, 5)), lanc(b, hoje)];
    const r = await enviarEmLote(ids, { semPausa: true, http });
    expect(r).toMatchObject({ enviados: 2, ignorados: 1, falhas: 0 }); expect(enviadas).toHaveLength(2);
    salvarTokenDoDeskcomm("");
    await expect(enviarEmLote(ids, { semPausa: true, http })).rejects.toThrow(/não foi ligado/);
    await expect(enviarEmLote([], { http })).rejects.toThrow(/ao menos uma/);
  });
});

describe("Texto editável e PIX separado", () => {
  it("o PIX copia e cola e a linha digitável vão em mensagens separadas, inteiros", () => {
    const pix = "00020101021226820014br.gov.bcb.pix2560pix-h.asaas.com/qr/cobv/f9ad467f-e3a2-479a-a73e-e6ccb47f0d065204000053039865802BR5924Eduardo Freitas Oliveira6011Sao Vicente61081134001062070503***6304F3E1";
    const r = aplicarLink("Oi!\n\n{link}\n\nTchau", { url: "https://asaas/i/1", pix, linha: "23793.38128 60000.000003" });
    expect(r.partes).toEqual([pix, "23793.38128 60000.000003"]);
    expect(r.texto).toContain("https://asaas/i/1"); expect(r.texto).not.toContain("00020101"); expect(r.texto).toContain("Em seguida, envio o código PIX copia e cola e a linha digitável do boleto.");
    expect(aplicarLink("Oi\n\n{link}\n\nTchau", null)).toEqual({ texto: "Oi\n\nTchau", partes: [] });
  });
  it("modelos editáveis: variáveis, nome vazio e modelo vazio volta ao padrão", () => {
    const p = { nome: "Maria Souza", descricao: "Parcela 1/3", valor_centavos: 50000, vencimento: somar(hoje, 2) };
    salvarRegua({ modelos: { antes: "Oi {nome}, {descricao} de {valor} vence {quando} ({vencimento}). {link}", hoje: "", depois: "x" } });
    expect(textoDoModelo(p, hoje)).toMatch(/^Oi Maria, Parcela 1\/3 de R\$\s?500,00 vence em \d\d\/\d\d\/\d{4} \(\d\d\/\d\d\/\d{4}\)\. \{link\}$/);
    expect(lerRegua().modelos.hoje).toContain("vence hoje");
    expect(textoDoModelo({ ...p, nome: "" }, hoje, { antes: "Olá, {nome}! Oi", hoje: "", depois: "" })).toBe("Olá! Oi");
  });
  it("mensagem editada vai como está, com {link} resolvido, e o PIX segue sozinho", async () => {
    const id = lanc(pessoa(), somar(hoje, 5));
    expect(previaDoAviso(id).texto).toContain("{link}");
    const r = await enviarAviso(id, { origem: "manual", http, mensagem: "Texto meu, {valor}? {link}" });
    expect(r.status).toBe("enviado"); expect(enviadas[0]!.texto).toBe("Texto meu, {valor}?");
  });
});

describe("Régua automática", () => {
  it("só envia o que a regra de hoje manda, uma vez por parcela e só depois do horário", async () => {
    const p = pessoa();
    const ant = lanc(p, somar(hoje, 3)), dia = lanc(p, hoje), dep = lanc(p, somar(hoje, -3)); lanc(p, somar(hoje, 10)); lanc(p, somar(hoje, -1));
    salvarRegua({ ativa: true, antes_dias: [3], no_dia: true, depois_dias: [3], horario: "09:00", gerar_cobranca: false });
    expect(pendentesDaRegua().map((i) => i.lancamento_id).sort()).toEqual([ant, dia, dep].sort());
    expect(await executarRegua(new Date(`${hoje}T08:00:00-03:00`), http)).toBeNull(); expect(enviadas).toHaveLength(0);
    expect(await executarRegua(tardeDemais, http)).toEqual({ enviados: 3, falhas: 0 });
    expect(await executarRegua(tardeDemais, http)).toEqual({ enviados: 0, falhas: 0 }); expect(enviadas).toHaveLength(3);
  });
  it("desligada, pausada, sem token: não envia; falha tenta no máximo 3 vezes", async () => {
    const p = pessoa(); lanc(p, hoje);
    expect(await executarRegua(tardeDemais, http)).toBeNull();
    salvarRegua({ ativa: true, antes_dias: [], no_dia: true, depois_dias: [], horario: "00:00", gerar_cobranca: false });
    salvarTokenDoDeskcomm(""); expect(await executarRegua(tardeDemais, http)).toBeNull();
    salvarTokenDoDeskcomm("dsk_token_de_teste_123456"); pausarAvisos(p, true); expect(pendentesDaRegua()).toHaveLength(0); pausarAvisos(p, false);
    const id = (db.prepare("SELECT id FROM gestao_lancamentos").get() as { id: number }).id;
    db.prepare("INSERT INTO gestao_avisos_cobranca(lancamento_id,regra,status,tentativas) VALUES (?, 'hoje','falhou',3)").run(id);
    expect(await executarRegua(tardeDemais, http)).toEqual({ enviados: 0, falhas: 0 }); expect(enviadas).toHaveLength(0);
    db.prepare("UPDATE gestao_avisos_cobranca SET tentativas=1").run();
    expect(await executarRegua(tardeDemais, http)).toEqual({ enviados: 1, falhas: 0 });
  });
  it("configuração é normalizada (dias inválidos, horário ruim)", () => {
    const c = salvarRegua({ antes_dias: [3, 3, 0, 200, "2" as unknown as number], horario: "25:99", depois_dias: [] });
    expect(c.antes_dias).toEqual([2, 3]); expect(c.horario).toBe("09:00"); expect(lerRegua().ativa).toBe(false);
  });
});
