import fs from "node:fs";
import path from "node:path";
import makeWASocket, { DisconnectReason, useMultiFileAuthState, type WASocket } from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { dataDir } from "../db";
import { emitEvent } from "../websocket";

export type WhatsappStatus = "desconectado" | "inicializando" | "aguardando_qr" | "autenticado" | "conectado" | "falha";

const AUTH_DIR = path.join(dataDir, "baileys_auth");
const RECONEXAO_INTERVALO_MS = 4000;
const MAX_TENTATIVAS_FALHA_SEGUIDAS = 5;

class WhatsappManager {
  private sock: WASocket | null = null;
  private status: WhatsappStatus = "desconectado";
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  /** Incrementado a cada connect()/disconnect()/shutdown() para invalidar reconexões automáticas de uma tentativa anterior. */
  private geracao = 0;
  private tentativasFalhaSeguidas = 0;

  getState() {
    return { status: this.status, qrDataUrl: this.qrDataUrl, lastError: this.lastError };
  }

  isReady(): boolean {
    return this.status === "conectado" && this.sock !== null;
  }

  private setState(partial: Partial<{ status: WhatsappStatus; qrDataUrl: string | null; lastError: string | null }>) {
    Object.assign(this, partial);
    emitEvent("whatsapp:status", this.getState());
  }

  connect(): void {
    if (this.sock) return;
    this.geracao++;
    this.tentativasFalhaSeguidas = 0;
    void this.iniciarConexao(this.geracao);
  }

  private async iniciarConexao(minhaGeracao: number): Promise<void> {
    if (minhaGeracao !== this.geracao) return;
    this.setState({ status: "inicializando", lastError: null, qrDataUrl: null });

    let state, saveCreds: () => Promise<void>;
    try {
      ({ state, saveCreds } = await useMultiFileAuthState(AUTH_DIR));
    } catch (err) {
      this.setState({
        status: "falha",
        lastError: `Erro ao carregar a sessão salva: ${(err as Error).message}`,
        qrDataUrl: null,
      });
      return;
    }
    if (minhaGeracao !== this.geracao) return; // um disconnect()/connect() mais novo já assumiu

    const sock = makeWASocket({
      auth: state,
      logger: pino({ level: "silent" }),
      browser: ["Disparador de Perícias", "Chrome", "120.0.0"],
    });
    this.sock = sock;

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", (update) => {
      if (this.sock !== sock) return; // evento de uma conexão antiga já substituída

      const { connection, qr, lastDisconnect } = update;

      if (qr) {
        QRCode.toDataURL(qr).then((qrDataUrl) => {
          if (this.sock === sock) this.setState({ status: "aguardando_qr", qrDataUrl });
        });
      }

      if (connection === "open") {
        this.tentativasFalhaSeguidas = 0;
        this.setState({ status: "conectado", qrDataUrl: null, lastError: null });
      }

      if (connection === "close") {
        this.sock = null;
        const statusCode = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output
          ?.statusCode;

        if (statusCode === DisconnectReason.loggedOut) {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
          this.setState({ status: "desconectado", qrDataUrl: null, lastError: null });
          return;
        }

        if (minhaGeracao !== this.geracao) return; // uma desconexão/reconexão manual já está em andamento

        this.tentativasFalhaSeguidas++;
        if (this.tentativasFalhaSeguidas > MAX_TENTATIVAS_FALHA_SEGUIDAS) {
          this.setState({
            status: "falha",
            lastError: "Não foi possível conectar ao WhatsApp após várias tentativas. Clique em Conectar para tentar de novo.",
            qrDataUrl: null,
          });
          return;
        }

        this.setState({
          status: "inicializando",
          lastError: `Conexão perdida, tentando novamente (${this.tentativasFalhaSeguidas}/${MAX_TENTATIVAS_FALHA_SEGUIDAS})…`,
          qrDataUrl: null,
        });
        setTimeout(() => void this.iniciarConexao(minhaGeracao), RECONEXAO_INTERVALO_MS);
      }
    });
  }

  async disconnect(): Promise<void> {
    this.geracao++; // cancela qualquer reconexão automática pendente
    const sock = this.sock;
    this.sock = null;

    if (sock) {
      try {
        await sock.logout();
      } catch {
        try {
          await sock.end(undefined);
        } catch {
          // best-effort
        }
      }
    }

    fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    this.setState({ status: "desconectado", qrDataUrl: null, lastError: null });
  }

  /**
   * Encerra a conexão sem invalidar a sessão salva (diferente de disconnect(), que faz
   * logout()), para que o próximo connect() não precise de um novo QR Code. Chamar no
   * shutdown do processo.
   */
  async shutdown(): Promise<void> {
    this.geracao++; // cancela qualquer reconexão automática pendente
    const sock = this.sock;
    this.sock = null;
    if (!sock) return;
    try {
      await sock.end(undefined);
    } catch {
      // best-effort — estamos encerrando de qualquer forma
    }
  }

  /** Confirma que o telefone existe no WhatsApp e retorna o JID canônico. */
  async resolveChatId(telefoneDigits: string): Promise<string | null> {
    if (!this.sock || this.status !== "conectado") {
      throw new Error("WhatsApp não está conectado.");
    }
    const resultados = await this.sock.onWhatsApp(telefoneDigits);
    const encontrado = resultados?.find((r) => r.exists);
    return encontrado ? encontrado.jid : null;
  }

  async sendMessage(chatId: string, mensagem: string): Promise<void> {
    if (!this.sock || this.status !== "conectado") {
      throw new Error("WhatsApp não está conectado.");
    }
    await this.sock.sendMessage(chatId, { text: mensagem });
  }
}

export const whatsappManager = new WhatsappManager();
