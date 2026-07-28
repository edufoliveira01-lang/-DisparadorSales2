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

/**
 * Tempo máximo aguardando o WhatsApp ficar pronto depois de "autenticado" (celular escaneou
 * o QR, mas o whatsapp-web.js às vezes trava nessa fase sem nunca emitir "ready" nem
 * "disconnected" — especialmente em celulares/conexões mais lentas). Sem esse limite, a tela
 * fica presa em "Autenticando…" para sempre, sem nenhuma tentativa automática de recuperação.
 */
const TEMPO_LIMITE_APOS_AUTENTICAR_MS = 3 * 60 * 1000;

type Listener = () => void;

class WhatsappManager {
  private client: Client | null = null;
  private status: WhatsappStatus = "desconectado";
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  private tentativa = 0;
  /** Incrementado a cada connect()/disconnect()/shutdown() para invalidar retries pendentes de uma tentativa anterior. */
  private geracao = 0;
  private listeners = new Set<Listener>();

  onChange(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  getState() {
    return { status: this.status, qrDataUrl: this.qrDataUrl, lastError: this.lastError };
  }

  isReady(): boolean {
    return this.status === "conectado" && this.client !== null;
  }

  private setState(partial: Partial<{ status: WhatsappStatus; qrDataUrl: string | null; lastError: string | null }>) {
    Object.assign(this, partial);
    emitEvent("whatsapp:status", this.getState());
    this.emit();
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
      // Quantas vezes o QR Code pode ser renovado (o WhatsApp Web troca a imagem sozinho a
      // cada ~20-30s) antes do whatsapp-web.js desistir e desconectar. Um valor generoso dá
      // mais tempo real para escanear em celulares mais lentos, sem travar para sempre — depois
      // de esgotado, nosso próprio retry automático entra em ação e gera um QR novo.
      qrMaxRetries: 12,
      authTimeoutMs: 90000,
    });
    this.client = client;

    let readyWatchdog: ReturnType<typeof setTimeout> | null = null;
    const limparReadyWatchdog = () => {
      if (readyWatchdog) {
        clearTimeout(readyWatchdog);
        readyWatchdog = null;
      }
    };

    const failAndCleanUp = async (status: WhatsappStatus, message: string) => {
      limparReadyWatchdog();

      // O whatsapp-web.js costuma emitir "disconnected" de forma espúria durante o próprio
      // fluxo de pareamento (ex: "Max qrcode retries reached", ou uma oscilação momentânea
      // do estado do socket logo após o QR ser escaneado, antes do evento "ready"). Se ainda
      // não tínhamos chegado a "conectado" nesta tentativa, tratamos como falha transitória e
      // tentamos de novo automaticamente — só paramos sem retry quando a desconexão acontece
      // DEPOIS de já estar conectado (ex: logout pelo celular), que é uma desconexão real.
      const aindaNaoConectouNestaTentativa = this.status !== "conectado";

      try {
        await client.destroy();
      } catch {
        // best-effort — já estamos tratando uma falha
      }
      if (this.client !== client) return; // uma tentativa mais nova já assumiu
      this.client = null;

      const deveTentarNovamente =
        minhaGeracao === this.geracao &&
        this.tentativa < MAX_TENTATIVAS_AUTOMATICAS &&
        (ERRO_TRANSITORIO.test(message) || aindaNaoConectouNestaTentativa);

      if (deveTentarNovamente) {
        this.tentativa++;
        this.setState({
          status: "inicializando",
          lastError: `Falha temporária ao conectar (${message}), tentando novamente (${this.tentativa}/${MAX_TENTATIVAS_AUTOMATICAS})…`,
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

      // Depois de autenticar, o whatsapp-web.js às vezes trava sem nunca emitir "ready" nem
      // "disconnected" (mais comum em celulares/conexões lentas) — sem esse timeout a tela
      // ficaria presa em "Autenticando…" para sempre. Se estourar, tratamos como falha
      // transitória: o retry automático entra em ação e tenta uma conexão nova.
      limparReadyWatchdog();
      readyWatchdog = setTimeout(() => {
        failAndCleanUp(
          "desconectado",
          "Tempo esgotado aguardando o WhatsApp sincronizar após a autenticação (celular pode estar lento ou sem internet)."
        );
      }, TEMPO_LIMITE_APOS_AUTENTICAR_MS);
    });

    client.on("ready", () => {
      limparReadyWatchdog();
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

  async stop(): Promise<void> {
    this.geracao++; // cancela qualquer retry automático pendente
    if (this.client) {
      try {
        await this.client.destroy();
      } catch {
        // best-effort
      }
      this.client = null;
    }
    this.setState({ status: "desconectado", qrDataUrl: null, lastError: null });
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

  /**
   * "Protocol error (Runtime.callFunctionOn): Execution context was destroyed" também
   * acontece em operações normais (resolver contato, enviar mensagem), não só durante a
   * conexão — é um problema conhecido do whatsapp-web.js quando a página do WhatsApp Web faz
   * uma navegação/reload interna bem no meio de uma chamada do Puppeteer. Tentar de novo quase
   * sempre resolve, então fazemos isso automaticamente em vez de falhar o envio de primeira.
   */
  private async comRetryTransitorio<T>(fn: () => Promise<T>): Promise<T> {
    for (let tentativa = 1; ; tentativa++) {
      try {
        return await fn();
      } catch (err) {
        const mensagem = (err as Error)?.message ?? String(err);
        if (tentativa >= MAX_TENTATIVAS_AUTOMATICAS || !ERRO_TRANSITORIO.test(mensagem)) throw err;
        await new Promise((resolve) => setTimeout(resolve, INTERVALO_ENTRE_TENTATIVAS_MS));
      }
    }
  }

  /** Confirma que o telefone existe no WhatsApp e retorna o chat id canônico. */
  async resolveChatId(telefoneDigits: string): Promise<string | null> {
    if (!this.client || this.status !== "conectado") {
      throw new Error("WhatsApp não está conectado.");
    }
    const client = this.client;

    // Se o número tem apenas 8 dígitos, assumimos que é um número antigo sem o 9 inicial.
    // Tentamos resolver como está, mas o whatsapp-web.js geralmente espera o formato com DDI e DDD.
    // O dispatchService já passa apenas dígitos.
    let target = telefoneDigits;

    // Se o usuário forneceu apenas 8 ou 9 dígitos (sem DDD), não temos como saber o DDD.
    // Mas se ele forneceu 10 dígitos (DDD + 8 dígitos), o WhatsApp costuma aceitar ou
    // converter automaticamente se o número for válido.
    // A melhor prática é garantir que o número tenha o prefixo 55 se não tiver.
    if (target.length >= 8 && target.length <= 11 && !target.startsWith("55")) {
      target = "55" + target;
    }

    const result = await this.comRetryTransitorio(() => client.getNumberId(target));
    return result ? result._serialized : null;
  }

  async sendMessage(chatId: string, mensagem: string): Promise<void> {
    if (!this.client || this.status !== "conectado") {
      throw new Error("WhatsApp não está conectado.");
    }
    const client = this.client;
    await this.comRetryTransitorio(() => client.sendMessage(chatId, mensagem));
  }
}

export const whatsappManager = new WhatsappManager();
