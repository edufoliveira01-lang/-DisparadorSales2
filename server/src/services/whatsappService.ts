import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { Client, LocalAuth } from "whatsapp-web.js";
import { dataDir } from "../db";
import { emitEvent } from "../websocket";

export type WhatsappStatus = "desconectado" | "inicializando" | "aguardando_qr" | "autenticado" | "conectado" | "falha";

const AUTH_DATA_PATH = path.join(dataDir, "wwebjs_auth");
// Local padrão onde o whatsapp-web.js guardava o cache de versão do WhatsApp Web antes de
// mudarmos para webVersionCache: "none". Removido uma vez na inicialização para descartar
// qualquer versão cacheada de uma tentativa anterior a essa mudança.
const LEGACY_WEB_VERSION_CACHE_PATH = path.join(process.cwd(), ".wwebjs_cache");

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

function clearLegacyWebVersionCache(): void {
  try {
    fs.rmSync(LEGACY_WEB_VERSION_CACHE_PATH, { recursive: true, force: true });
  } catch {
    // limpeza best-effort
  }
}

// "Execution context was destroyed" / "Protocol error" são falhas conhecidas e
// intermitentes do whatsapp-web.js (bug de terceiros, ainda sem correção definitiva
// upstream) que costumam acontecer durante o carregamento inicial do WhatsApp Web,
// antes mesmo do QR Code aparecer. Na prática, tentar de novo quase sempre resolve —
// então fazemos isso automaticamente em vez de exigir que o usuário clique de novo.
const ERRO_TRANSITORIO = /execution context was destroyed|protocol error/i;
const MAX_TENTATIVAS_AUTOMATICAS = 3;
const INTERVALO_ENTRE_TENTATIVAS_MS = 3000;

class WhatsappManager {
  private client: Client | null = null;
  private status: WhatsappStatus = "desconectado";
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  private tentativa = 0;
  /** Incrementado a cada connect()/disconnect()/shutdown() para invalidar retries pendentes de uma tentativa anterior. */
  private geracao = 0;

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
    clearLegacyWebVersionCache();
    this.geracao++;
    this.tentativa = 0;
    this.iniciarTentativa(this.geracao);
  }

  private iniciarTentativa(minhaGeracao: number): void {
    if (minhaGeracao !== this.geracao) return; // uma chamada mais recente (connect/disconnect) já assumiu

    clearStaleChromiumLocks();
    this.setState({ status: "inicializando", lastError: null, qrDataUrl: null });

    // Configuração idêntica à usada no projeto anterior (que já validamos funcionando):
    // headless, apenas os dois args de sandbox, e os mesmos timeouts. Evitamos adicionar
    // flags extras do Chromium sem validação prévia em ambiente real.
    //
    // webVersionCache: "none" evita um problema documentado da comunidade: por padrão o
    // whatsapp-web.js guarda em cache local a versão do WhatsApp Web que funcionou da
    // última vez, e volta a usar essa MESMA versão em cada tentativa seguinte. Se o
    // WhatsApp atualizou o cliente web nesse meio tempo, a versão cacheada fica
    // incompatível e toda tentativa falha do mesmo jeito, sempre no mesmo ponto (exatamente
    // o padrão "Execution context was destroyed" antes do QR, de forma consistente, e não
    // intermitente). Com "none", cada tentativa usa a versão atual servida pelo WhatsApp.
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: AUTH_DATA_PATH }),
      puppeteer: {
        headless: true,
        args: ["--no-sandbox", "--disable-setuid-sandbox"],
        protocolTimeout: 120000,
      },
      webVersionCache: { type: "none" },
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
      if (this.client !== client) return; // uma tentativa mais nova já assumiu
      this.client = null;

      if (minhaGeracao === this.geracao && ERRO_TRANSITORIO.test(message) && this.tentativa < MAX_TENTATIVAS_AUTOMATICAS) {
        this.tentativa++;
        this.setState({
          status: "inicializando",
          lastError: `Falha temporária ao carregar o WhatsApp Web, tentando novamente (${this.tentativa}/${MAX_TENTATIVAS_AUTOMATICAS})…`,
          qrDataUrl: null,
        });
        setTimeout(() => this.iniciarTentativa(minhaGeracao), INTERVALO_ENTRE_TENTATIVAS_MS);
        return;
      }

      this.setState({ status, lastError: message, qrDataUrl: null });
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
    this.geracao++; // cancela qualquer retry automático pendente
    if (!this.client) {
      this.setState({ status: "desconectado", qrDataUrl: null, lastError: null });
      return;
    }
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
    this.geracao++; // cancela qualquer retry automático pendente
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
