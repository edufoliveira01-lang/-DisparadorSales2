/**
 * Motor alternativo do WhatsApp, sem navegador (biblioteca Baileys, protocolo direto por WebSocket).
 *
 * Em vez de reescrever o serviço do WhatsApp, este arquivo expõe a MESMA interface de eventos e
 * métodos que o sistema usa do `whatsapp-web.js` (qr, ready, authenticated, disconnected, message,
 * message_create, message_ack, message_reaction; sendMessage, getNumberId, getChatById, getState,
 * logout, destroy…). Assim o restante do sistema (envios, confirmação de entrega, respostas
 * pendentes, lembretes) continua igual e só o motor muda.
 *
 * A única diferença de fundo: o Baileys não consulta o histórico de uma conversa sob demanda.
 * Por isso toda mensagem enviada ou recebida é guardada numa tabela local (LojaMensagens), de onde
 * saem `chat.fetchMessages`, `chat.lastMessage` e `message.getQuotedMessage`.
 */
import { EventEmitter } from "node:events";
import fs from "node:fs";
import type Database from "better-sqlite3";

// ---------- tipos mínimos do Baileys (o pacote é carregado sob demanda) ----------
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface ModuloBaileys {
  makeWASocket: (config: any) => SocketBaileys;
  useMultiFileAuthState: (dir: string) => Promise<{ state: { creds: any; keys: any }; saveCreds: () => Promise<void> }>;
  makeCacheableSignalKeyStore?: (keys: any, logger: any) => any;
  fetchLatestBaileysVersion?: () => Promise<{ version: number[] }>;
  Browsers?: { macOS?: (nome: string) => [string, string, string]; ubuntu?: (nome: string) => [string, string, string] };
  DisconnectReason: Record<string, number>;
}
export interface SocketBaileys {
  ev: { on: (evento: string, fn: (dados: any) => void) => void; removeAllListeners?: (evento?: string) => void };
  user?: { id?: string; lid?: string };
  sendMessage: (jid: string, conteudo: any, opcoes?: any) => Promise<any>;
  onWhatsApp: (...ids: string[]) => Promise<{ jid: string; exists: boolean }[] | undefined>;
  logout: (msg?: string) => Promise<void>;
  end: (erro?: Error) => void;
  signalRepository?: { lidMapping?: { getPNForLID?: (lid: string) => Promise<string | null>; getLIDForPN?: (pn: string) => Promise<string | null> } };
}

// ---------- identificadores ----------
const PN = "@s.whatsapp.net";
/** wwebjs usa "@c.us" para telefone; o Baileys usa "@s.whatsapp.net". O sistema todo fala "@c.us". */
export const paraCus = (jid: string | null | undefined): string => String(jid ?? "").replace(/:\d+@/, "@").replace(PN, "@c.us");
export const paraJid = (id: string): string => String(id).replace(/@c\.us$/, PN);
const digitos = (id: string) => String(id ?? "").split("@")[0].split(":")[0].replace(/\D/g, "");
const ehLid = (id: string) => /@lid$/.test(String(id ?? ""));
/** Mesmo formato do wwebjs: "<fromMe>_<chat>_<id>". O sistema compara só a parte final (id). */
export const idSerializado = (deMim: boolean, chat: string, id: string) => `${deMim}_${paraCus(chat)}_${id}`;

// ---------- mensagens no formato do wwebjs ----------
export interface MensagemCompat {
  id: { _serialized: string; id: string; fromMe: boolean; remote: string };
  from: string; to: string; fromMe: boolean; body: string; timestamp: number; ack: number;
  hasQuotedMsg: boolean; type: string;
  getQuotedMessage: () => Promise<MensagemCompat>;
  getContact: () => Promise<{ id: { _serialized: string }; number: string }>;
  getChat: () => Promise<ChatCompat>;
}
export interface ChatCompat { id: { _serialized: string }; lastMessage: MensagemCompat | undefined; fetchMessages: (opcoes?: { limit?: number }) => Promise<MensagemCompat[]> }

interface LinhaMensagem { id: string; chat: string; chat_alt: string; de_mim: number; autor: string; corpo: string; ts: number; ack: number; citada: string }

/** Guarda as mensagens para consultas de histórico, que o Baileys não oferece. */
export class LojaMensagens {
  private inseridas = 0;
  constructor(private db: Database.Database, private retencaoDias = 30) {
    db.exec(`CREATE TABLE IF NOT EXISTS wa_baileys_mensagens (
      id TEXT PRIMARY KEY, chat TEXT NOT NULL, chat_alt TEXT NOT NULL DEFAULT '', de_mim INTEGER NOT NULL DEFAULT 0, autor TEXT NOT NULL DEFAULT '',
      corpo TEXT NOT NULL DEFAULT '', ts INTEGER NOT NULL, ack INTEGER NOT NULL DEFAULT 0, citada TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_wa_baileys_chat ON wa_baileys_mensagens(chat, ts);
    CREATE INDEX IF NOT EXISTS idx_wa_baileys_alt ON wa_baileys_mensagens(chat_alt, ts);`);
  }
  salvar(m: Omit<LinhaMensagem, "ack"> & { ack?: number }) {
    this.db.prepare(`INSERT INTO wa_baileys_mensagens(id,chat,chat_alt,de_mim,autor,corpo,ts,ack,citada) VALUES (?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET corpo=CASE WHEN excluded.corpo<>'' THEN excluded.corpo ELSE corpo END, chat_alt=CASE WHEN excluded.chat_alt<>'' THEN excluded.chat_alt ELSE chat_alt END,
      citada=CASE WHEN excluded.citada<>'' THEN excluded.citada ELSE citada END, ack=MAX(ack,excluded.ack)`)
      .run(m.id, m.chat, m.chat_alt, m.de_mim, m.autor, m.corpo, m.ts, m.ack ?? 0, m.citada);
    if (++this.inseridas % 200 === 0) this.db.prepare("DELETE FROM wa_baileys_mensagens WHERE ts < ?").run(Math.floor(Date.now() / 1000) - this.retencaoDias * 86400);
  }
  /** Sobe o ack (nunca desce, exceto -1 = erro). Devolve a linha, ou null se a mensagem não é conhecida. */
  atualizarAck(id: string, ack: number): LinhaMensagem | null {
    const atual = this.obter(id);
    if (!atual) return null;
    const novo = ack === -1 ? -1 : Math.max(atual.ack, ack);
    this.db.prepare("UPDATE wa_baileys_mensagens SET ack=? WHERE id=?").run(novo, id);
    return { ...atual, ack: novo };
  }
  obter(id: string): LinhaMensagem | null { return (this.db.prepare("SELECT * FROM wa_baileys_mensagens WHERE id=?").get(id) as LinhaMensagem | undefined) ?? null; }
  doChat(chats: string[], limite: number): LinhaMensagem[] {
    const ids = [...new Set(chats.filter(Boolean))];
    if (!ids.length) return [];
    const marcas = ids.map(() => "?").join(",");
    const linhas = this.db.prepare(`SELECT * FROM wa_baileys_mensagens WHERE chat IN (${marcas}) OR chat_alt IN (${marcas}) ORDER BY ts DESC, rowid DESC LIMIT ?`).all(...ids, ...ids, limite) as LinhaMensagem[];
    return linhas.reverse();
  }
}

/** Texto de uma mensagem do Baileys, qualquer que seja o tipo. */
export function corpoDaMensagem(mensagem: any): string {
  const m = mensagem?.ephemeralMessage?.message ?? mensagem?.viewOnceMessage?.message ?? mensagem?.documentWithCaptionMessage?.message ?? mensagem ?? {};
  return String(m.conversation ?? m.extendedTextMessage?.text ?? m.imageMessage?.caption ?? m.videoMessage?.caption ?? m.documentMessage?.caption ?? m.buttonsResponseMessage?.selectedDisplayText ?? m.listResponseMessage?.title ?? "");
}
const citadaDe = (mensagem: any): string => {
  const m = mensagem?.ephemeralMessage?.message ?? mensagem ?? {};
  return String(m.extendedTextMessage?.contextInfo?.stanzaId ?? m.imageMessage?.contextInfo?.stanzaId ?? m.videoMessage?.contextInfo?.stanzaId ?? "");
};
/** Status do Baileys → ack do wwebjs. ERROR=0→-1, PENDING=1→0, SERVER_ACK=2→1, DELIVERY=3→2, READ=4→3, PLAYED=5→4. */
export const ackDoStatus = (status: number): number => (status === 0 ? -1 : Math.max(0, Number(status) - 1));

const loggerSilencioso: any = { level: "silent", child() { return loggerSilencioso; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

export interface OpcoesBaileys {
  /** Pasta onde ficam as credenciais da sessão. */
  authDir: string;
  carregar: () => Promise<ModuloBaileys>;
  loja: LojaMensagens;
  /** Quantos QR Codes emitir antes de desistir (cada um vale ~20 s). */
  qrMaxRetries?: number;
  /** Tentativas de reconectar sozinho quando a internet cai com a sessão já ativa. */
  reconexoesMax?: number;
  esperaReconexaoMs?: number;
  registrar?: (mensagem: string) => void;
}

/** Cliente com a interface do wwebjs, mas conversando direto com o WhatsApp. */
export class BaileysClient extends EventEmitter {
  /** Sem navegador: o serviço usa a ausência de `pupPage` para pular as sondas do Chromium. */
  pupPage: undefined = undefined;
  pupBrowser: undefined = undefined;

  private sock: SocketBaileys | null = null;
  private modulo: ModuloBaileys | null = null;
  private estado: { creds: any; keys: any } | null = null;
  private salvarCreds: (() => Promise<void>) | null = null;
  private aberto = false;
  private fechado = false;
  private jaAutenticou = false;
  private qrEmitidos = 0;
  private reconexoes = 0;
  private espera: { resolve: () => void; reject: (e: Error) => void } | null = null;
  private vistos = new Set<string>();

  constructor(private op: OpcoesBaileys) { super(); }

  private log(m: string) { (this.op.registrar ?? ((x) => console.log(`[WhatsApp/Baileys] ${x}`)))(m); }

  /** Resolve quando a conexão estiver pronta (como o wwebjs), ou rejeita se não for possível conectar. */
  async initialize(): Promise<void> {
    this.modulo = await this.op.carregar();
    fs.mkdirSync(this.op.authDir, { recursive: true, mode: 0o700 });
    const auth = await this.modulo.useMultiFileAuthState(this.op.authDir);
    this.estado = auth.state; this.salvarCreds = auth.saveCreds;
    const pronta = new Promise<void>((resolve, reject) => { this.espera = { resolve, reject }; });
    await this.abrirSocket();
    return pronta;
  }

  private async versaoDoWhatsapp(): Promise<number[] | undefined> {
    try {
      if (!this.modulo?.fetchLatestBaileysVersion) return undefined;
      const r = await Promise.race([this.modulo.fetchLatestBaileysVersion(), new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 4000))]);
      return r.version;
    } catch { return undefined; }
  }

  private async abrirSocket(): Promise<void> {
    const b = this.modulo!;
    const version = await this.versaoDoWhatsapp();
    const keys = b.makeCacheableSignalKeyStore ? b.makeCacheableSignalKeyStore(this.estado!.keys, loggerSilencioso) : this.estado!.keys;
    const sock = b.makeWASocket({
      auth: { creds: this.estado!.creds, keys },
      ...(version ? { version } : {}),
      browser: b.Browsers?.macOS?.("Desktop") ?? ["DisparaZap", "Desktop", "2"],
      logger: loggerSilencioso,
      syncFullHistory: false,
      markOnlineOnConnect: false,
      generateHighQualityLinkPreview: false,
      printQRInTerminal: false,
      // Reenvio interno de mensagens que o destinatário não conseguiu decifrar.
      getMessage: async (key: any) => { const l = this.op.loja.obter(String(key?.id ?? "")); return l ? { conversation: l.corpo } : undefined; },
    });
    this.sock = sock;
    sock.ev.on("creds.update", () => { void this.salvarCreds?.().catch(() => undefined); });
    sock.ev.on("connection.update", (u) => this.aoMudarConexao(sock, u));
    sock.ev.on("messages.upsert", (d) => this.aoReceber(d));
    sock.ev.on("messages.update", (d) => this.aoAtualizar(d));
    sock.ev.on("message-receipt.update", (d) => this.aoRecibo(d));
    sock.ev.on("messages.reaction", (d) => this.aoReagir(d));
  }

  private aoMudarConexao(sock: SocketBaileys, u: any) {
    if (this.fechado || sock !== this.sock) return;
    if (u?.qr) {
      this.qrEmitidos++;
      if (this.qrEmitidos > (this.op.qrMaxRetries ?? 12)) { this.encerrarPorFalta("Max qrcode retries reached"); return; }
      this.emit("qr", u.qr);
    }
    if (u?.connection === "open") {
      this.aberto = true; this.reconexoes = 0; this.qrEmitidos = 0;
      if (!this.jaAutenticou) { this.jaAutenticou = true; this.emit("authenticated"); }
      this.emit("ready");
      this.espera?.resolve(); this.espera = null;
    } else if (u?.connection === "close") {
      this.aberto = false;
      const codigo = Number(u?.lastDisconnect?.error?.output?.statusCode ?? u?.lastDisconnect?.error?.statusCode ?? 0);
      const D = this.modulo!.DisconnectReason;
      if (codigo === D.restartRequired) { this.log("Reinício solicitado pelo WhatsApp (normal após o pareamento)."); void this.reabrir(); return; }
      if (codigo === D.loggedOut) { this.encerrarPorFalta("LOGOUT", true); return; }
      if (codigo === D.connectionReplaced) { this.encerrarPorFalta("CONFLICT"); return; }
      if (!this.jaAutenticou) {
        // Antes do pareamento: o fim do tempo do QR Code (ou da conexão) vira o mesmo aviso do wwebjs.
        this.encerrarPorFalta(this.qrEmitidos > 0 ? "Max qrcode retries reached" : `Falha ao conectar (código ${codigo || "?"})`); return;
      }
      void this.tentarReconectar(codigo);
    }
  }

  private async reabrir() {
    try { this.sock?.ev.removeAllListeners?.(); this.sock?.end(undefined); } catch { /* já fechado */ }
    if (this.fechado) return;
    await this.abrirSocket();
  }

  private async tentarReconectar(codigo: number) {
    const max = this.op.reconexoesMax ?? 5;
    if (this.fechado) return;
    if (this.reconexoes >= max) { this.encerrarPorFalta(`Conexão perdida (código ${codigo || "?"})`); return; }
    this.reconexoes++;
    this.log(`Conexão perdida (código ${codigo || "?"}). Reconectando (${this.reconexoes}/${max})…`);
    await new Promise((r) => setTimeout(r, (this.op.esperaReconexaoMs ?? 2000) * this.reconexoes));
    if (!this.fechado) await this.reabrir().catch(() => this.tentarReconectar(codigo));
  }

  private encerrarPorFalta(motivo: string, limparSessao = false) {
    if (this.fechado) return;
    this.fechado = true;
    if (limparSessao) { try { fs.rmSync(this.op.authDir, { recursive: true, force: true }); } catch { /* best-effort */ } }
    try { this.sock?.end(undefined); } catch { /* já fechado */ }
    this.emit("disconnected", motivo);
    this.espera?.reject(new Error(motivo)); this.espera = null;
  }

  // ---------- conversão de mensagens ----------
  private meuId(): string { return paraCus(this.sock?.user?.id ?? ""); }

  private linhaParaMensagem(l: LinhaMensagem): MensagemCompat {
    const chat = l.chat;
    const deMim = Boolean(l.de_mim);
    const id = { _serialized: idSerializado(deMim, chat, l.id), id: l.id, fromMe: deMim, remote: chat };
    const msg: MensagemCompat = {
      id, from: deMim ? this.meuId() : (l.autor || chat), to: deMim ? chat : this.meuId(), fromMe: deMim, body: l.corpo, timestamp: l.ts, ack: l.ack, hasQuotedMsg: Boolean(l.citada), type: "chat",
      getQuotedMessage: async () => {
        const c = l.citada ? this.op.loja.obter(l.citada) : null;
        if (!c) throw new Error("Mensagem citada não encontrada");
        return this.linhaParaMensagem(c);
      },
      getContact: async () => ({ id: { _serialized: l.autor || chat }, number: digitos(l.autor || chat) }),
      getChat: async () => this.getChatById(chat),
    };
    return msg;
  }

  private async paraLinha(w: any): Promise<Omit<LinhaMensagem, "ack"> | null> {
    const key = w?.key;
    if (!key?.id || !key.remoteJid) return null;
    if (key.remoteJid === "status@broadcast" || /@newsletter$/.test(key.remoteJid)) return null;
    const m = w.message;
    if (!m || m.protocolMessage || m.reactionMessage || m.senderKeyDistributionMessage) return null;
    const grupo = /@g\.us$/.test(key.remoteJid);
    const deMim = Boolean(key.fromMe);
    // Na versão nova do WhatsApp a conversa pode vir como @lid, com o telefone em "Alt".
    const chatBruto = key.remoteJid as string;
    const alt = (key.remoteJidAlt as string | undefined) ?? "";
    const chat = ehLid(chatBruto) && alt && !ehLid(alt) ? paraCus(alt) : paraCus(chatBruto);
    const chatAlt = ehLid(chatBruto) && chat !== paraCus(chatBruto) ? chatBruto : (alt ? paraCus(alt) : "");
    const autorBruto = grupo ? String(key.participant ?? "") : chatBruto;
    return {
      id: key.id, chat, chat_alt: chatAlt, de_mim: deMim ? 1 : 0, autor: deMim ? "" : (ehLid(autorBruto) && alt && !ehLid(alt) && !grupo ? paraCus(alt) : paraCus(autorBruto)),
      corpo: corpoDaMensagem(m), ts: Number(w.messageTimestamp?.toNumber?.() ?? w.messageTimestamp ?? Math.floor(Date.now() / 1000)), citada: citadaDe(m),
    };
  }

  private async aoReceber(d: { messages?: any[]; type?: string }) {
    for (const w of d?.messages ?? []) {
      try {
        const linha = await this.paraLinha(w);
        if (!linha) continue;
        const repetida = this.vistos.has(linha.id);
        this.vistos.add(linha.id); if (this.vistos.size > 2000) this.vistos.delete(this.vistos.values().next().value as string);
        const ackInicial = linha.de_mim ? Math.max(0, ackDoStatus(Number(w.status ?? 1))) : 0;
        this.op.loja.salvar({ ...linha, ack: ackInicial });
        if (repetida) continue;
        const msg = this.linhaParaMensagem({ ...linha, ack: ackInicial });
        this.emit("message_create", msg);
        if (!linha.de_mim && d.type === "notify") this.emit("message", msg);
      } catch (e) { this.log(`Falha ao tratar mensagem recebida: ${(e as Error).message}`); }
    }
  }

  private emitirAck(id: string, ack: number) {
    const l = this.op.loja.atualizarAck(id, ack);
    if (!l) return;
    this.emit("message_ack", this.linhaParaMensagem(l), ack === -1 ? -1 : l.ack);
  }
  private aoAtualizar(d: any[]) {
    for (const u of d ?? []) {
      const status = u?.update?.status;
      if (typeof status !== "number" || !u?.key?.id || !u.key.fromMe) continue;
      this.emitirAck(u.key.id, ackDoStatus(status));
    }
  }
  /** Recibos de entrega/leitura (principalmente em conversas de grupo e dispositivos extras). */
  private aoRecibo(d: any[]) {
    for (const r of d ?? []) {
      if (!r?.key?.id || !r.key.fromMe) continue;
      const rec = r.receipt ?? {};
      if (rec.readTimestamp) this.emitirAck(r.key.id, 3);
      else if (rec.receiptTimestamp) this.emitirAck(r.key.id, 2);
    }
  }
  private aoReagir(d: any[]) {
    for (const x of d ?? []) {
      const key = x?.key; if (!key?.id) continue;
      const remoto = String(key.remoteJid ?? "");
      const chat = ehLid(remoto) && key.remoteJidAlt ? paraCus(key.remoteJidAlt) : paraCus(remoto);
      const autor = paraCus(x.reaction?.key?.participant ?? x.reaction?.key?.remoteJid ?? remoto);
      this.emit("message_reaction", { msgId: { fromMe: Boolean(key.fromMe), _serialized: idSerializado(Boolean(key.fromMe), chat, key.id), id: key.id }, reaction: String(x.reaction?.text ?? ""), senderId: autor });
    }
  }

  // ---------- métodos no formato do wwebjs ----------
  async getState(): Promise<string | null> { return this.aberto ? "CONNECTED" : this.fechado ? null : "OPENING"; }
  async getWWebVersion(): Promise<string> { return "baileys"; }

  async getNumberId(numero: string): Promise<{ _serialized: string; user: string; server: string } | null> {
    if (!this.sock || !this.aberto) throw new Error("WhatsApp não está conectado.");
    const r = await this.sock.onWhatsApp(`${digitos(numero)}${PN}`);
    const achado = r?.find((x) => x.exists);
    if (!achado) return null;
    const cus = paraCus(achado.jid);
    return { _serialized: cus, user: digitos(cus), server: "c.us" };
  }

  async getContactLidAndPhone(ids: string[]): Promise<{ lid: string; pn: string }[]> {
    const mapa = this.sock?.signalRepository?.lidMapping;
    const saida: { lid: string; pn: string }[] = [];
    if (!mapa) return saida;
    for (const id of ids) {
      try {
        if (ehLid(id)) { const pn = await mapa.getPNForLID?.(id); if (pn) saida.push({ lid: id, pn: paraCus(pn) }); }
        else { const lid = await mapa.getLIDForPN?.(paraJid(id)); if (lid) saida.push({ lid, pn: paraCus(id) }); }
      } catch { /* sem mapeamento conhecido */ }
    }
    return saida;
  }

  async sendMessage(chatId: string, texto: string, _opcoes?: unknown): Promise<MensagemCompat> {
    if (!this.sock || !this.aberto) throw new Error("WhatsApp não está conectado.");
    const jid = paraJid(chatId);
    const enviada = await this.sock.sendMessage(jid, { text: texto });
    const id = String(enviada?.key?.id ?? "");
    if (!id) throw new Error("O WhatsApp não devolveu o identificador da mensagem enviada.");
    const chat = paraCus(chatId);
    const ts = Number(enviada?.messageTimestamp?.toNumber?.() ?? enviada?.messageTimestamp ?? Math.floor(Date.now() / 1000));
    this.vistos.add(id);
    const jaTinha = this.op.loja.obter(id);
    this.op.loja.salvar({ id, chat, chat_alt: "", de_mim: 1, autor: "", corpo: texto, ts, citada: "", ack: 0 });
    const linha = this.op.loja.obter(id)!;
    const msg = this.linhaParaMensagem(linha);
    if (!jaTinha) this.emit("message_create", msg);
    return msg;
  }

  async getChatById(chatId: string): Promise<ChatCompat> {
    const chat = paraCus(chatId);
    const chats = [chat, chatId];
    const extra = await this.getContactLidAndPhone([chat]).catch(() => []);
    for (const c of extra) chats.push(c.lid, c.pn);
    const linhas = () => this.op.loja.doChat(chats, 200);
    const a = this;
    return {
      id: { _serialized: chat },
      get lastMessage() { const l = linhas(); return l.length ? a.linhaParaMensagem(l[l.length - 1]) : undefined; },
      fetchMessages: async (opcoes) => this.op.loja.doChat(chats, Math.max(1, Math.min(500, opcoes?.limit ?? 50))).map((l) => this.linhaParaMensagem(l)),
    };
  }

  async getMessageById(id: string): Promise<MensagemCompat | null> {
    const stanza = String(id).split("_").pop() ?? "";
    const l = this.op.loja.obter(stanza);
    return l ? this.linhaParaMensagem(l) : null;
  }

  async logout(): Promise<void> {
    try { await this.sock?.logout(); } catch { /* servidor pode já ter encerrado */ }
    try { fs.rmSync(this.op.authDir, { recursive: true, force: true }); } catch { /* best-effort */ }
  }

  async destroy(): Promise<void> {
    this.fechado = true; this.aberto = false;
    try { this.sock?.ev.removeAllListeners?.(); this.sock?.end(undefined); } catch { /* já fechado */ }
    this.sock = null;
    this.espera?.reject(new Error("Conexão encerrada")); this.espera = null;
    this.removeAllListeners();
  }
}

/** Carrega o pacote (ESM) a partir deste código CommonJS. */
export const carregarBaileys = async (): Promise<ModuloBaileys> => {
  const importar = new Function("m", "return import(m)") as (m: string) => Promise<any>;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const m = await importar("@whiskeysockets/baileys").catch(() => require("@whiskeysockets/baileys"));
  return { ...m, makeWASocket: m.makeWASocket ?? m.default?.makeWASocket ?? m.default } as ModuloBaileys;
};
