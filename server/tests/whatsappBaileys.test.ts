import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { EventEmitter } from "node:events";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { BaileysClient, LojaMensagens, ackDoStatus, corpoDaMensagem, paraCus, paraJid, type ModuloBaileys } from "../src/services/whatsappBaileys";

const DR = { loggedOut: 401, restartRequired: 515, connectionReplaced: 440, connectionClosed: 428 };

function criar(opcoes: { onWhatsApp?: any } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "baileys-teste-"));
  const ev = new EventEmitter();
  const enviados: any[] = [];
  const sock: any = {
    ev: { on: (n: string, f: any) => ev.on(n, f), removeAllListeners: () => ev.removeAllListeners() },
    user: { id: "5511900000000:12@s.whatsapp.net" },
    sendMessage: async (jid: string, c: any) => { enviados.push({ jid, c }); return { key: { id: "ABC123", remoteJid: jid, fromMe: true }, messageTimestamp: 1700000000 }; },
    onWhatsApp: opcoes.onWhatsApp ?? (async (j: string) => [{ jid: j, exists: true }]),
    logout: async () => undefined, end: () => undefined,
  };
  const modulo: ModuloBaileys = {
    makeWASocket: () => sock,
    useMultiFileAuthState: async () => ({ state: { creds: {}, keys: {} }, saveCreds: async () => undefined }),
    DisconnectReason: DR,
  };
  const loja = new LojaMensagens(new Database(":memory:"));
  const client = new BaileysClient({ authDir: path.join(dir, "auth"), carregar: async () => modulo, loja, qrMaxRetries: 2, registrar: () => undefined, esperaReconexaoMs: 1 });
  return { client, ev, sock, enviados, loja, dir };
}
const abrir = async (c: ReturnType<typeof criar>) => {
  const p = c.client.initialize();
  await new Promise((r) => setTimeout(r, 5));
  c.ev.emit("connection.update", { connection: "open" });
  await p;
};
const limpar: string[] = [];
afterEach(() => { for (const d of limpar.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe("Baileys: conversões", () => {
  it("converte ids e status", () => {
    expect(paraCus("5511999999999:3@s.whatsapp.net")).toBe("5511999999999@c.us");
    expect(paraJid("5511999999999@c.us")).toBe("5511999999999@s.whatsapp.net");
    expect([0, 1, 2, 3, 4, 5].map(ackDoStatus)).toEqual([-1, 0, 1, 2, 3, 4]);
    expect(corpoDaMensagem({ extendedTextMessage: { text: "oi" } })).toBe("oi");
    expect(corpoDaMensagem({ imageMessage: { caption: "foto" } })).toBe("foto");
  });
});

describe("BaileysClient", () => {
  it("emite qr, authenticated e ready; initialize resolve ao abrir", async () => {
    const c = criar(); limpar.push(c.dir);
    const eventos: string[] = [];
    c.client.on("qr", (q) => eventos.push(`qr:${q}`)); c.client.on("authenticated", () => eventos.push("auth")); c.client.on("ready", () => eventos.push("ready"));
    const p = c.client.initialize();
    await new Promise((r) => setTimeout(r, 5));
    c.ev.emit("connection.update", { qr: "QR1" });
    c.ev.emit("connection.update", { connection: "open" });
    await p;
    expect(eventos).toEqual(["qr:QR1", "auth", "ready"]);
    expect(await c.client.getState()).toBe("CONNECTED");
    expect(c.client.pupPage).toBeUndefined();
  });

  it("depois de qrMaxRetries QRs desiste com a mesma mensagem do motor antigo", async () => {
    const c = criar(); limpar.push(c.dir);
    const motivos: string[] = [];
    c.client.on("disconnected", (m) => motivos.push(m));
    const p = c.client.initialize().catch((e) => e.message);
    await new Promise((r) => setTimeout(r, 5));
    for (const q of ["1", "2", "3"]) c.ev.emit("connection.update", { qr: q });
    expect(await p).toBe("Max qrcode retries reached");
    expect(motivos).toEqual(["Max qrcode retries reached"]);
  });

  it("logout pelo celular emite LOGOUT e apaga a sessão", async () => {
    const c = criar(); limpar.push(c.dir);
    await abrir(c);
    fs.mkdirSync(path.join(c.dir, "auth"), { recursive: true });
    const motivos: string[] = [];
    c.client.on("disconnected", (m) => motivos.push(m));
    c.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 401 } } } });
    expect(motivos).toEqual(["LOGOUT"]);
    expect(fs.existsSync(path.join(c.dir, "auth"))).toBe(false);
  });

  it("envia texto, devolve id no formato do wwebjs e registra ack subindo", async () => {
    const c = criar(); limpar.push(c.dir);
    await abrir(c);
    const criadas: any[] = []; const acks: [string, number][] = [];
    c.client.on("message_create", (m) => criadas.push(m)); c.client.on("message_ack", (m, a) => acks.push([m.id.id, a]));
    const m = await c.client.sendMessage("5511999999999@c.us", "Olá");
    expect(c.enviados[0]).toEqual({ jid: "5511999999999@s.whatsapp.net", c: { text: "Olá" } });
    expect(m.id._serialized).toBe("true_5511999999999@c.us_ABC123");
    expect(m.fromMe).toBe(true);
    expect(criadas).toHaveLength(1);
    c.ev.emit("messages.update", [{ key: { id: "ABC123", fromMe: true, remoteJid: "5511999999999@s.whatsapp.net" }, update: { status: 3 } }]);
    c.ev.emit("messages.update", [{ key: { id: "ABC123", fromMe: true, remoteJid: "x" }, update: { status: 2 } }]); // não desce
    expect(acks[0]).toEqual(["ABC123", 2]);
    expect(acks.at(-1)![1]).toBe(2);
    c.ev.emit("messages.update", [{ key: { id: "ABC123", fromMe: true, remoteJid: "x" }, update: { status: 4 } }]);
    expect(acks.at(-1)![1]).toBe(3);
  });

  it("confirmação que chega ANTES de o envio retornar não se perde", async () => {
    const c = criar(); limpar.push(c.dir);
    await abrir(c);
    c.sock.sendMessage = async (jid: string) => {
      // o celular do cliente confirma a entrega antes de sendMessage devolver
      c.ev.emit("messages.update", [{ key: { id: "RAPIDO1", fromMe: true, remoteJid: jid }, update: { status: 3 } }]);
      return { key: { id: "RAPIDO1", remoteJid: jid, fromMe: true }, messageTimestamp: 1700000000 };
    };
    const acks: [string, number][] = [];
    c.client.on("message_ack", (m, a) => acks.push([m.id.id, a]));
    const m = await c.client.sendMessage("5511999999999@c.us", "Olá");
    expect(m.id.id).toBe("RAPIDO1");
    await new Promise((r) => setTimeout(r, 10));
    expect(acks).toEqual([["RAPIDO1", 2]]);
    const chat = await c.client.getChatById("5511999999999@c.us");
    expect((await chat.fetchMessages({ limit: 5 }))[0].ack).toBe(2);
  });

  it("mensagem recebida vira message/message_create e entra no histórico do chat, com citação", async () => {
    const c = criar(); limpar.push(c.dir);
    await abrir(c);
    const m = await c.client.sendMessage("5511999999999@c.us", "Confirma?");
    const recebidas: any[] = [];
    c.client.on("message", (x) => recebidas.push(x));
    c.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "R1", remoteJid: "5511999999999@s.whatsapp.net", fromMe: false }, messageTimestamp: 1700000100,
      message: { extendedTextMessage: { text: "Sim", contextInfo: { stanzaId: "ABC123" } } } }] });
    await new Promise((r) => setTimeout(r, 5));
    expect(recebidas).toHaveLength(1);
    expect(recebidas[0].body).toBe("Sim");
    expect(recebidas[0].from).toBe("5511999999999@c.us");
    expect(recebidas[0].hasQuotedMsg).toBe(true);
    expect((await recebidas[0].getQuotedMessage()).id.id).toBe(m.id.id);
    const chat = await c.client.getChatById("5511999999999@c.us");
    expect((await chat.fetchMessages({ limit: 10 })).map((x) => x.body)).toEqual(["Confirma?", "Sim"]);
    expect(chat.lastMessage?.body).toBe("Sim");
    // mensagem repetida não dispara de novo
    c.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "R1", remoteJid: "5511999999999@s.whatsapp.net", fromMe: false }, message: { conversation: "Sim" } }] });
    await new Promise((r) => setTimeout(r, 5));
    expect(recebidas).toHaveLength(1);
  });

  it("conversa @lid com telefone alternativo é normalizada para @c.us", async () => {
    const c = criar(); limpar.push(c.dir);
    await abrir(c);
    const recebidas: any[] = [];
    c.client.on("message", (x) => recebidas.push(x));
    c.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "L1", remoteJid: "123456@lid", remoteJidAlt: "5511988887777@s.whatsapp.net", fromMe: false }, message: { conversation: "oi" } }] });
    await new Promise((r) => setTimeout(r, 5));
    expect(recebidas[0].from).toBe("5511988887777@c.us");
  });

  it("reação em mensagem nossa é repassada; grupo/status ignorados", async () => {
    const c = criar(); limpar.push(c.dir);
    await abrir(c);
    const reacoes: any[] = []; const recebidas: any[] = [];
    c.client.on("message_reaction", (r) => reacoes.push(r)); c.client.on("message", (x) => recebidas.push(x));
    c.ev.emit("messages.reaction", [{ key: { id: "ABC123", fromMe: true, remoteJid: "5511999999999@s.whatsapp.net" }, reaction: { text: "👍", key: { remoteJid: "5511999999999@s.whatsapp.net" } } }]);
    expect(reacoes[0]).toMatchObject({ reaction: "👍", msgId: { fromMe: true, id: "ABC123" } });
    c.ev.emit("messages.upsert", { type: "notify", messages: [{ key: { id: "S1", remoteJid: "status@broadcast", fromMe: false }, message: { conversation: "x" } }] });
    await new Promise((r) => setTimeout(r, 5));
    expect(recebidas).toHaveLength(0);
  });

  it("getNumberId usa onWhatsApp e devolve null quando não existe", async () => {
    const c = criar({ onWhatsApp: async (j: string) => [{ jid: j, exists: j.startsWith("5511911") }] }); limpar.push(c.dir);
    await abrir(c);
    expect((await c.client.getNumberId("(11) 91122-2333"))).toBeNull();
    expect((await c.client.getNumberId("5511911112222"))?._serialized).toBe("5511911112222@c.us");
  });

  it("queda com sessão ativa reconecta sozinha", async () => {
    const c = criar(); limpar.push(c.dir);
    await abrir(c);
    const desconectou: string[] = []; c.client.on("disconnected", (m) => desconectou.push(m));
    c.ev.emit("connection.update", { connection: "close", lastDisconnect: { error: { output: { statusCode: 428 } } } });
    await new Promise((r) => setTimeout(r, 30));
    expect(desconectou).toEqual([]);
    expect(await c.client.getState()).not.toBeNull();
  });
});
