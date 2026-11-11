import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";

const enviadas: { chat: string; texto: string }[] = [];
const estado = { pronto: true };
vi.mock("../src/services/whatsappService", () => ({
  whatsappManager: {
    isReady: () => estado.pronto,
    resolveChatId: async (d: string) => `${d}@c.us`,
    sendMessage: async (chat: string, texto: string) => { enviadas.push({ chat, texto }); return "id1"; },
  },
}));

import { db } from "../src/db";
import { enviarAviso, enviarEmLote, executarRegua, lerRegua, mensagemDoAviso, pausarAvisos, pendentesDaRegua, regraDe, salvarRegua } from "../src/services/gestao/regua";
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
  enviadas.length = 0; estado.pronto = true;
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
  it("envio manual manda o texto pelo WhatsApp e registra; sem WhatsApp conectado registra a falha", async () => {
    const id = lanc(pessoa(), somar(hoje, -2));
    expect((await enviarAviso(id, { origem: "manual" })).status).toBe("enviado");
    expect(enviadas).toHaveLength(1); expect(enviadas[0]!.chat).toBe("5513999991111@c.us"); expect(enviadas[0]!.texto).toContain("Olá, Maria!");
    estado.pronto = false;
    const r = await enviarAviso(id, { origem: "manual" });
    expect(r.status).toBe("falhou"); expect(r.motivo).toContain("não está conectado");
  });
  it("cliente sem telefone válido falha sem enviar", async () => {
    const r = await enviarAviso(lanc(pessoa("123"), hoje), { origem: "manual" });
    expect(r).toMatchObject({ status: "falhou", motivo: "Cliente sem telefone válido." }); expect(enviadas).toHaveLength(0);
  });
  it("lote envia uma por parcela, ignora pausados e recusa sem WhatsApp", async () => {
    const a = pessoa(), b = pessoa("(13) 98888-2222"); pausarAvisos(b, true);
    const ids = [lanc(a, hoje), lanc(a, somar(hoje, 5)), lanc(b, hoje)];
    const r = await enviarEmLote(ids, { semPausa: true });
    expect(r).toMatchObject({ enviados: 2, ignorados: 1, falhas: 0 }); expect(enviadas).toHaveLength(2);
    estado.pronto = false;
    await expect(enviarEmLote(ids, { semPausa: true })).rejects.toThrow(/não está conectado/);
    await expect(enviarEmLote([], {})).rejects.toThrow(/ao menos uma/);
  });
});

describe("Régua automática", () => {
  it("só envia o que a regra de hoje manda, uma vez por parcela e só depois do horário", async () => {
    const p = pessoa();
    const ant = lanc(p, somar(hoje, 3)), dia = lanc(p, hoje), dep = lanc(p, somar(hoje, -3)); lanc(p, somar(hoje, 10)); lanc(p, somar(hoje, -1));
    salvarRegua({ ativa: true, antes_dias: [3], no_dia: true, depois_dias: [3], horario: "09:00", gerar_cobranca: false });
    expect(pendentesDaRegua().map((i) => i.lancamento_id).sort()).toEqual([ant, dia, dep].sort());
    expect(await executarRegua(new Date(`${hoje}T08:00:00-03:00`))).toBeNull(); expect(enviadas).toHaveLength(0);
    expect(await executarRegua(tardeDemais)).toEqual({ enviados: 3, falhas: 0 });
    expect(await executarRegua(tardeDemais)).toEqual({ enviados: 0, falhas: 0 }); expect(enviadas).toHaveLength(3);
  });
  it("desligada, pausada, sem WhatsApp: não envia; falha tenta no máximo 3 vezes", async () => {
    const p = pessoa(); lanc(p, hoje);
    expect(await executarRegua(tardeDemais)).toBeNull();
    salvarRegua({ ativa: true, antes_dias: [], no_dia: true, depois_dias: [], horario: "00:00", gerar_cobranca: false });
    estado.pronto = false; expect(await executarRegua(tardeDemais)).toBeNull();
    estado.pronto = true; pausarAvisos(p, true); expect(pendentesDaRegua()).toHaveLength(0); pausarAvisos(p, false);
    const id = (db.prepare("SELECT id FROM gestao_lancamentos").get() as { id: number }).id;
    db.prepare("INSERT INTO gestao_avisos_cobranca(lancamento_id,regra,status,tentativas) VALUES (?, 'hoje','falhou',3)").run(id);
    expect(await executarRegua(tardeDemais)).toEqual({ enviados: 0, falhas: 0 }); expect(enviadas).toHaveLength(0);
    db.prepare("UPDATE gestao_avisos_cobranca SET tentativas=1").run();
    expect(await executarRegua(tardeDemais)).toEqual({ enviados: 1, falhas: 0 });
  });
  it("configuração é normalizada (dias inválidos, horário ruim)", () => {
    const c = salvarRegua({ antes_dias: [3, 3, 0, 200, "2" as unknown as number], horario: "25:99", depois_dias: [] });
    expect(c.antes_dias).toEqual([2, 3]); expect(c.horario).toBe("09:00"); expect(lerRegua().ativa).toBe(false);
  });
});
