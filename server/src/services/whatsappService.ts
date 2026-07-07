import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { Client, LocalAuth } from "whatsapp-web.js";
import { dataDir } from "../db";
import { emitEvent } from "../websocket";

export type WhatsappStatus = "desconectado" | "inicializando" | "aguardando_qr" | "autenticado" | "conectado" | "falha";

const AUTH_DATA_PATH = path.join(dataDir, "wwebjs_auth");

/**
 * O Chromium recusa reutilizar o profile enquanto existir um lock "Singleton*" de
 * uma execução anterior, mesmo que o processo já não exista (ex: servidor reiniciado
 * sem shutdown limpo). Como só rodamos um Client por vez, é seguro limpar esses locks
 * antes de iniciar um novo browser — evita o erro "browser is already running".
 */
function clearStaleChromiumLocks(): void {
  if (!fs.existsSync(AUTH_DATA_PATH)) return;
  const lockFileNames = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
  for (const sessionDir of fs.readdirSync(AUTH_DATA_PATH, { withFileTypes: true })) {
    if (!sessionDir.isDirectory()) continue;
    for (const lockName of lockFileNames) {
      try {
        fs.rmSync(path.join(AUTH_DATA_PATH, sessionDir.name, lockName), { force: true });
      } catch {
        // limpeza best-effort
      }
    }
  }
}

class WhatsappManager {
  private client: Client | null = null;
  private status: WhatsappStatus = "desconectado";
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;

  getState() {
    return { status: this.status, qrDataUrl: this.qrDataUrl, lastError: this.lastError };
  }

  isReady(): boolean {
    return this.status === "conectado" && this.client !== null;
  }

  private setState(partial: Partial<{ status: WhatsappStatus; qrDataUrl: string | null; lastError: string | null }>) {
    Object.assign(this, partial);
    emitEvent("whatsapp:status", this.getState());
  }

  connect(): void {
    if (this.client) return;
    clearStaleChromiumLocks();
    this.setState({ status: "inicializando", lastError: null, qrDataUrl: null });

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: AUTH_DATA_PATH }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        protocolTimeout: 120000,
      },
      qrMaxRetries: 5,
      authTimeoutMs: 90000,
    });
    this.client = client;

    const failAndCleanUp = async (status: WhatsappStatus, message: string) => {
      try {
        await client.destroy();
      } catch {
        // best-effort — já estamos tratando uma falha
      }
      if (this.client === client) {
        this.client = null;
        this.setState({ status, lastError: message, qrDataUrl: null });
      }
    };

    client.on("qr", async (qr) => {
      const qrDataUrl = await QRCode.toDataURL(qr);
      this.setState({ status: "aguardando_qr", qrDataUrl });
    });

    client.on("authenticated", () => {
      this.setState({ status: "autenticado", qrDataUrl: null });
    });

    client.on("ready", () => {
      this.setState({ status: "conectado", qrDataUrl: null });
    });

    client.on("auth_failure", (msg) => {
      failAndCleanUp("falha", String(msg));
    });

    client.on("disconnected", (reason) => {
      failAndCleanUp("desconectado", String(reason));
    });

    client.initialize().catch((err) => {
      failAndCleanUp("falha", err?.message ?? String(err));
    });
  }

  async disconnect(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.logout();
    } catch {
      try {
        await this.client.destroy();
      } catch {
        // best-effort
      }
    }
    this.client = null;
    this.setState({ status: "desconectado", qrDataUrl: null, lastError: null });
  }

  /**
   * Fecha o browser sem invalidar a sessão (diferente de disconnect(), que faz logout()),
   * para que o próximo connect() não precise de um novo QR Code. Chamar no shutdown do
   * processo para não deixar um Chromium travando o profile na próxima inicialização.
   */
  async shutdown(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.destroy();
    } catch {
      // best-effort — estamos encerrando de qualquer forma
    }
    this.client = null;
  }

  /** Confirma que o telefone existe no WhatsApp e retorna o chat id canônico. */
  async resolveChatId(telefoneDigits: string): Promise<string | null> {
    if (!this.client || this.status !== "conectado") {
      throw new Error("WhatsApp não está conectado.");
    }
    const result = await this.client.getNumberId(telefoneDigits);
    return result ? result._serialized : null;
  }

  async sendMessage(chatId: string, mensagem: string): Promise<void> {
    if (!this.client || this.status !== "conectado") {
      throw new Error("WhatsApp não está conectado.");
    }
    await this.client.sendMessage(chatId, mensagem);
  }
}

export const whatsappManager = new WhatsappManager();
