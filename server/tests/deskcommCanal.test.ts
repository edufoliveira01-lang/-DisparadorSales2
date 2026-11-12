import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.ENCRYPTION_KEY = "chave-somente-para-testes-0123456789abcdef";
Object.assign(process.env, { ATENDIMENTO_PONTE_URL: "https://painel.exemplo/ponte", ATENDIMENTO_URL: "https://desk.exemplo", ATENDIMENTO_SLUG: "teste", ATENDIMENTO_SEGREDO: "x".repeat(40) });
vi.mock("../src/services/whatsappService", () => ({ whatsappManager: { isReady: () => false, resolveChatId: async () => null, processarAckPendente: () => undefined } }));
vi.mock("../src/services/trelloService", () => ({ moveCard: vi.fn(async () => undefined) }));

import { db } from "../src/db";
import { setSetting } from "../src/services/settingsService";
import { salvarTokenDoDeskcomm, salvarCanaisDoDeskcomm } from "../src/services/gestao/deskcomm";
import { definirProvedor, enviarTexto, enviarTextoConfirmado, resolverDestino, canalPronto, usaDeskcomm } from "../src/services/canalWhatsapp";
import { sincronizarDeskcomm } from "../src/services/deskcommSync";
import { createPendingReply, getPendingReply } from "../src/services/pendingRepliesService";
import { createLog, getLog } from "../src/services/logsService";
import { moveCard } from "../src/services/trelloService";

const CANAL = "33333333-3333-4333-8333-333333333333";
const envios: { url: string; corpo: Record<string, unknown> }[] = [];
let historico: unknown[] = [];
const http = (async (url: string, init?: RequestInit) => {
  const corpo = init?.body && typeof init.body === "string" ? JSON.parse(init.body) : {};
  if (String(url).includes("/messages?limit")) return new Response(JSON.stringify({ data: historico }));
  envios.push({ url: String(url), corpo });
  if (String(url).endsWith("/open-with-contact")) return new Response(JSON.stringify({ data: { conversation_id: "conv-1" } }), { status: 201 });
  return new Response(JSON.stringify({ data: { id: "msg-uuid-1" } }), { status: 201 });
}) as unknown as typeof fetch;

beforeEach(() => {
  db.exec("DELETE FROM deskcomm_mensagens; DELETE FROM pending_replies; DELETE FROM send_logs;");
  db.prepare("DELETE FROM settings WHERE chave LIKE 'deskcomm_canal_%' OR chave='whatsapp_provedor'").run();
  envios.length = 0; historico = [];
  salvarTokenDoDeskcomm("dsk_token_de_teste_123456");
  vi.stubGlobal("fetch", http);
  vi.mocked(moveCard).mockClear();
});

afterEach(() => { vi.unstubAllGlobals(); });

describe("canal de envio: WhatsApp do Deskcomm", () => {
  it("só liga o Deskcomm para tudo com o token salvo e começa no WhatsApp próprio", () => {
    expect(usaDeskcomm()).toBe(false);
    definirProvedor("deskcomm");
    expect(usaDeskcomm()).toBe(true);
    expect(canalPronto()).toBe(true);
    expect(() => definirProvedor("outro")).toThrow();
  });

  it("envia pelo número escolhido para a finalidade e registra a mensagem para acompanhar a resposta", async () => {
    definirProvedor("deskcomm");
    salvarCanaisDoDeskcomm({ canal_padrao: CANAL });
    const destino = await resolverDestino("(13) 99999-1111");
    expect(destino).toBe("5513999991111@deskcomm");
    const id = await enviarTexto(destino!, "Olá", { nome: "Maria", finalidade: "avisos" });
    expect(id).toBe("msg-uuid-1");
    expect((envios.find((e) => e.url.endsWith("/open-with-contact"))!.corpo as { channel_session_id: string }).channel_session_id).toBe(CANAL);
    const r = db.prepare("SELECT * FROM deskcomm_mensagens WHERE message_id='msg-uuid-1'").get() as { conversation_id: string; telefone_digits: string };
    expect(r).toMatchObject({ conversation_id: "conv-1", telefone_digits: "5513999991111" });
    expect(await enviarTextoConfirmado(destino!, "Oi", {})).toEqual({ messageId: "msg-uuid-1", ack: 1 });
  });

  it("traz de volta entrega, leitura e resposta do cliente: resolve a espera e move o cartão", async () => {
    definirProvedor("deskcomm");
    setSetting("trello_key", "k"); setSetting("trello_token", "t"); setSetting("trello_confirm_list_id", "lista-ok");
    const destino = (await resolverDestino("13999991111"))!;
    const id = (await enviarTexto(destino, "Perícia amanhã", { nome: "Maria", finalidade: "avisos" }))!;
    const log = createLog({ card_id: "card-1", card_nome: "Maria", contact_id: null, telefone: "13999991111", pericias_json: "[]", mensagem_enviada: "x", status: "sucesso", erro: null, whatsapp_message_id: id });
    const espera = createPendingReply("card-1", "Maria", "13999991111", "5513999991111", destino, id);
    const t0 = new Date(Date.now() + 60_000).toISOString();
    historico = [
      { id, direction: "outbound", status: "read", ack: 3, created_at: new Date().toISOString(), delivered_at: t0, read_at: t0 },
      { id: "in-1", direction: "inbound", type: "text", body: "Confirmado, obrigada!", created_at: t0 },
    ];
    const r = await sincronizarDeskcomm(http);
    expect(r).toMatchObject({ conversas: 1, respostas: 1 });
    expect(getLog(log.id)!.ack).toBe(3);
    const p = getPendingReply(espera.id)!;
    expect(p.status).toBe("respondido");
    expect(p.resposta_preview).toBe("Confirmado, obrigada!");
    expect(moveCard).toHaveBeenCalledWith("k", "t", "card-1", "lista-ok");
  });

  it("não faz nada com o WhatsApp próprio ligado", async () => {
    const r = await sincronizarDeskcomm(http);
    expect(r).toEqual({ conversas: 0, respostas: 0, acks: 0 });
  });
});
