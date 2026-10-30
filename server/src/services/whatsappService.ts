import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import QRCode from "qrcode";
import { WhatsappWorkCoordinator } from "./whatsappWorkCoordinator";
import { Client, LocalAuth, type Message, type Reaction } from "whatsapp-web.js";
import { dataDir } from "../db";
import { whatsappMessageIdCandidates, whatsappMessageStableKey } from "../utils/whatsappMessageId";
import { emitEvent } from "../websocket";
import { getSetting } from "./settingsService";
import { enviarMensagemTelegram } from "./telegramService";
import { recordSystemLog } from "./systemLogsService";
import { moveCard } from "./trelloService";
import { listLogsAguardandoConfirmacao, updateLogAckByMessageId } from "./logsService";
import { reconciliarConfirmacaoDeEnvio } from "./deliveryAckReconciliation";
import { sendConfirmedWhatsappMessage, type ConfirmedWhatsappSend } from "./confirmedWhatsappSend";
import { prepareWhatsappVersion, configureWhatsappStartupPage } from "./whatsappStartup";
import { backupWhatsappProfile, WhatsappSessionRecoveryError } from "./whatsappProfile";
import {
  atrasoRetryConexaoMs,
  deveInvalidarSessao,
  existeInstanciaConcorrenteAtiva,
  motivoImpedeRetryAutomatico,
  normalizarMotivoDesconexao,
} from "./whatsappConnectionPolicy";
import {
  findAwaitingByChatIdentifier,
  findAwaitingByWhatsappMessageId,
  listAwaitingRepliesPage,
  resolvePendingReplyIfAwaiting,
  updatePendingReplyAckByMessageId,
  type PendingReply,
  type TipoResposta,
} from "./pendingRepliesService";

export type WhatsappStatus = "desconectado" | "inicializando" | "aguardando_qr" | "pareando" | "autenticado" | "conectado" | "falha";

const AUTH_DATA_PATH = path.join(dataDir, "wwebjs_auth");
const AUTH_SESSION_DIR = path.join(AUTH_DATA_PATH, "session");
const AUTH_SESSION_MARKER_PATH = path.join(dataDir, "whatsapp-session-ready.json");
const INSTANCE_LOCK_PATH = path.join(dataDir, "whatsapp-manager.lock");
const INSTANCE_TOKEN = `${os.hostname()}:${process.pid}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
let possuiLockDaInstancia = false;
// Local padrão onde o whatsapp-web.js guardava o cache de versão do WhatsApp Web antes de
// mudarmos para webVersionCache: "none". Removido uma vez na inicialização para descartar
// qualquer versão cacheada de uma tentativa anterior a essa mudança.
const LEGACY_WEB_VERSION_CACHE_PATH = path.join(process.cwd(), ".wwebjs_cache");

interface WhatsappInstanceLock {
  hostname: string;
  pid: number;
  token: string;
  createdAt: string;
}

function processoEstaAtivo(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function lerLockDaInstancia(): WhatsappInstanceLock | null {
  try {
    return JSON.parse(fs.readFileSync(INSTANCE_LOCK_PATH, "utf8")) as WhatsappInstanceLock;
  } catch {
    return null;
  }
}

function criarLockDaInstancia(): boolean {
  try {
    const fd = fs.openSync(INSTANCE_LOCK_PATH, "wx");
    try {
      fs.writeFileSync(fd, JSON.stringify({
        hostname: os.hostname(),
        pid: process.pid,
        token: INSTANCE_TOKEN,
        createdAt: new Date().toISOString(),
      } satisfies WhatsappInstanceLock));
    } finally {
      fs.closeSync(fd);
    }
    possuiLockDaInstancia = true;
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
      console.error("[WhatsApp] Não foi possível criar o lock da instância:", err);
    }
    return false;
  }
}

function adquirirLockDaInstancia(): boolean {
  if (possuiLockDaInstancia) return true;
  if (criarLockDaInstancia()) return true;

  const existente = lerLockDaInstancia();
  if (existeInstanciaConcorrenteAtiva(existente, os.hostname(), process.pid, processoEstaAtivo)) {
    console.error(`[WhatsApp] Conexão bloqueada: a instância PID ${existente?.pid} já controla a sessão.`);
    return false;
  }

  try {
    fs.rmSync(INSTANCE_LOCK_PATH, { force: true });
  } catch {
    return false;
  }
  return criarLockDaInstancia();
}

function liberarLockDaInstancia(): void {
  if (!possuiLockDaInstancia) return;
  try {
    const atual = lerLockDaInstancia();
    if (atual?.token === INSTANCE_TOKEN) fs.rmSync(INSTANCE_LOCK_PATH, { force: true });
  } catch {
    // limpeza best-effort
  } finally {
    possuiLockDaInstancia = false;
  }
}

function chromiumDoProfileEstaAtivo(sessionPath: string): boolean {
  const lockPath = path.join(sessionPath, "SingletonLock");
  try {
    const alvo = fs.readlinkSync(lockPath);
    const pidEncontrado = alvo.match(/-(\d+)$/)?.[1];
    if (!pidEncontrado || !alvo.startsWith(`${os.hostname()}-`)) return false;
    return processoEstaAtivo(Number(pidEncontrado));
  } catch {
    return false;
  }
}

/**
 * O Chromium recusa reutilizar o profile enquanto existir um lock "Singleton*" de
 * uma execução anterior, mesmo que o processo já não exista (ex: servidor reiniciado
 * sem shutdown limpo). Antes de remover, confirmamos que o PID do Chromium não está ativo;
 * assim uma segunda instância não consegue abrir o mesmo profile ao mesmo tempo.
 */
function clearStaleChromiumLocks(): void {
  if (!fs.existsSync(AUTH_DATA_PATH)) return;
  const lockFileNames = ["SingletonLock", "SingletonCookie", "SingletonSocket"];
  for (const sessionDir of fs.readdirSync(AUTH_DATA_PATH, { withFileTypes: true })) {
    if (!sessionDir.isDirectory()) continue;
    const sessionPath = path.join(AUTH_DATA_PATH, sessionDir.name);
    if (chromiumDoProfileEstaAtivo(sessionPath)) {
      throw new Error("O perfil do WhatsApp já está aberto por outro processo do Chromium.");
    }
    for (const lockName of lockFileNames) {
      try {
        fs.rmSync(path.join(sessionPath, lockName), { force: true });
      } catch {
        // limpeza best-effort
      }
    }
  }
}

/**
 * LocalAuth.logout() apaga a pasta do profile inteira, então um login via QR Code novo sempre
 * parte de um Chromium profile 100% limpo. Já um simples restart do servidor (reconectando com a
 * sessão salva, sem logout) reaproveita o MESMO profile — e o profile do Chromium guarda um cache
 * de Service Worker do site (web.whatsapp.com registra um), que sobrevive ao restart. Se esse
 * cache tiver o bundle de uma versão antiga do WhatsApp Web (de antes de fixarmos
 * webVersionCache, ou de antes do WhatsApp ter atualizado o build), o Service Worker responde as
 * requisições de navegação com esse bundle desatualizado ANTES de bater na rede — ignorando por
 * completo a versão que pinamos em webVersionCache. É exatamente esse cenário (build incompatível
 * com o patch que o whatsapp-web.js injeta no Store) que já vimos quebrar message.id._serialized
 * (ver comentário grande em iniciarTentativa) — e como message_ack também depende desse mesmo id
 * para casar com o registro salvo em send_logs/pending_replies, o sintoma é a confirmação de
 * entrega parar de ser capturada, mesmo com a conexão aparentemente normal, até o usuário fazer
 * logout e escanear um QR novo (que começa do zero, sem esse cache).
 *
 * A correção é limpar só o cache de Service Worker/HTTP (nunca o Local Storage/IndexedDB, onde
 * fica a sessão de login em si) antes de cada tentativa de conexão — assim toda reconexão, com ou
 * sem QR novo, sempre busca o bundle da versão pinada direto da rede.
 */
function clearStaleServiceWorkerCache(): void {
  if (!fs.existsSync(AUTH_DATA_PATH)) return;
  const cacheDirNames = ["Service Worker", "Cache", "Code Cache"];
  for (const sessionDir of fs.readdirSync(AUTH_DATA_PATH, { withFileTypes: true })) {
    if (!sessionDir.isDirectory()) continue;
    for (const cacheName of cacheDirNames) {
      try {
        fs.rmSync(path.join(AUTH_DATA_PATH, sessionDir.name, "Default", cacheName), {
          recursive: true,
          force: true,
        });
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

function marcarSessaoPersistida(): void {
  try {
    fs.writeFileSync(AUTH_SESSION_MARKER_PATH, JSON.stringify({ authenticatedAt: new Date().toISOString() }), "utf8");
  } catch (err) {
    console.error("[WhatsApp] Não foi possível registrar a sessão autenticada:", err);
  }
}

function removerMarcadorDeSessao(): void {
  try {
    fs.rmSync(AUTH_SESSION_MARKER_PATH, { force: true });
  } catch (err) {
    console.error("[WhatsApp] Não foi possível remover o marcador da sessão:", err);
  }
}

function removerSessaoPersistida(): void {
  try {
    removerMarcadorDeSessao();
    fs.rmSync(AUTH_SESSION_DIR, { recursive: true, force: true });
  } catch (err) {
    console.error("[WhatsApp] Não foi possível remover os dados da sessão encerrada:", err);
  }
}

function possuiMarcadorDeSessao(): boolean {
  return fs.existsSync(AUTH_SESSION_MARKER_PATH);
}

const WA_VERSION_REPO_API = "https://api.github.com/repos/wppconnect-team/wa-version/contents/html";
const WA_VERSION_RAW_BASE = "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html";
const WA_VERSION_CACHE_FILE = path.join(dataDir, "whatsapp-web-version.json");
/** Evita tanto a build mais nova quanto versões antigas que o WhatsApp já pode ter desativado. */
const WA_VERSION_MARGEM_RECENTES = 5;
/** Quanto tempo reaproveitar a mesma versão resolvida antes de consultar de novo. Sem isso, toda
 * tentativa de conexão (inclusive os retries automáticos de iniciarTentativa, até
 * MAX_TENTATIVAS_CONEXAO vezes) batia na API do GitHub — depois de algumas reconexões seguidas
 * isso já é suficiente pra esbarrar no limite de requisições sem autenticação do GitHub (60/hora
 * por IP), fazendo a consulta falhar e cair de volta em "none" (build mais recente), que é
 * exatamente o bug que estamos evitando. */
const WA_VERSION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type WaVersionCache = { type: "remote"; remotePath: string; strict: false } | { type: "none" };

function carregarWaVersionCachePersistida(): { valor: WaVersionCache; resolvidaEm: number } | null {
  try {
    if (!fs.existsSync(WA_VERSION_CACHE_FILE)) return null;
    const salvo = JSON.parse(fs.readFileSync(WA_VERSION_CACHE_FILE, "utf8")) as {
      remotePath?: string;
      resolvidaEm?: number;
    };
    if (!salvo.remotePath || !Number.isFinite(salvo.resolvidaEm)) return null;
    return {
      valor: { type: "remote", remotePath: salvo.remotePath, strict: false },
      resolvidaEm: Number(salvo.resolvidaEm),
    };
  } catch {
    return null;
  }
}

function salvarWaVersionCache(valor: WaVersionCache, resolvidaEm: number): void {
  if (valor.type !== "remote") return;
  try {
    fs.writeFileSync(WA_VERSION_CACHE_FILE, JSON.stringify({ remotePath: valor.remotePath, resolvidaEm }), "utf8");
  } catch (err) {
    console.error("[WhatsApp] Não foi possível persistir a versão do WhatsApp Web:", err);
  }
}

let waVersionCacheResolvida: { valor: WaVersionCache; resolvidaEm: number } | null = carregarWaVersionCachePersistida();

function invalidarWaVersionCache(): void {
  waVersionCacheResolvida = null;
  try {
    fs.rmSync(WA_VERSION_CACHE_FILE, { force: true });
  } catch {
    // limpeza best-effort
  }
}

/**
 * Resolve dinamicamente qual versão fixar no webVersionCache (ver comentário maior em
 * iniciarTentativa). Fixar um arquivo específico por nome (como fizemos antes) quebra de novo
 * assim que o wa-version poda esse arquivo do repositório — o repositório só mantém uma janela
 * rolante de versões recentes, então qualquer nome fixo tem vida curta. Em vez disso, consultamos
 * a listagem atual e escolhemos uma versão recente já estabilizada, evitando tanto a última build
 * quanto versões antigas que o próprio WhatsApp pode recusar. Isso se
 * auto-corrige à medida que a janela avança — mas só a cada WA_VERSION_CACHE_TTL_MS, e se a
 * consulta nova falhar (rede, rate limit) preferimos reaproveitar a última resolução boa que
 * tivermos a cair em "none", que reintroduziria o bug do id._serialized undefined.
 */
async function resolveWaVersionCache(): Promise<WaVersionCache> {
  if (waVersionCacheResolvida && Date.now() - waVersionCacheResolvida.resolvidaEm < WA_VERSION_CACHE_TTL_MS) {
    return waVersionCacheResolvida.valor;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const res = await fetch(WA_VERSION_REPO_API, {
      signal: controller.signal,
      headers: { "User-Agent": "disparazap", Accept: "application/vnd.github+json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const arquivos = (await res.json()) as { name: string }[];
    const versoes = arquivos.map((a) => a.name).filter((nome) => nome.endsWith(".html")).sort();
    if (versoes.length === 0) throw new Error("Nenhuma versão listada");

    const indice = Math.max(0, versoes.length - 1 - WA_VERSION_MARGEM_RECENTES);
    const escolhida = versoes[indice];
    const resultado: WaVersionCache = { type: "remote", remotePath: `${WA_VERSION_RAW_BASE}/${escolhida}`, strict: false };
    const resolvidaEm = Date.now();
    waVersionCacheResolvida = { valor: resultado, resolvidaEm };
    salvarWaVersionCache(resultado, resolvidaEm);
    console.log(`[WhatsApp] Versão fixa do WhatsApp Web resolvida: ${escolhida}`);
    return resultado;
  } catch (err) {
    if (waVersionCacheResolvida) {
      console.error(
        "[WhatsApp] Falha ao atualizar a versão fixa do WhatsApp Web, reaproveitando a última resolução válida:",
        err
      );
      return waVersionCacheResolvida.valor;
    }
    console.error("[WhatsApp] Não foi possível resolver versão fixa do WhatsApp Web, usando a mais recente:", err);
    return { type: "none" };
  } finally {
    clearTimeout(timeout);
  }
}

// "Execution context was destroyed" / "Protocol error" são falhas conhecidas e
// intermitentes do whatsapp-web.js (bug de terceiros, ainda sem correção definitiva
// upstream) que costumam acontecer durante o carregamento inicial do WhatsApp Web,
// antes mesmo do QR Code aparecer. Na prática, tentar de novo quase sempre resolve —
// então fazemos isso automaticamente em vez de exigir que o usuário clique de novo.
const ERRO_TRANSITORIO = /execution context was destroyed|protocol error|detached frame|frame was detached/i;

/**
 * Diferencia uma navegação momentânea da página de um Chromium/CDP efetivamente travado.
 * Nesse segundo caso repetir a mesma chamada não resolve: é preciso recriar o browser mantendo
 * o profile do LocalAuth. A mensagem original do Puppeteer cita protocolTimeout, enquanto o
 * nosso watchdog usa o marcador abaixo para não deixar o usuário esperando cinco minutos.
 */
const MARCADOR_TIMEOUT_OPERACAO = "WHATSAPP_BROWSER_OPERATION_TIMEOUT";
// Uma referência a Frame removido não volta a funcionar repetindo chamadas no mesmo Client.
const ERRO_BROWSER_TRAVADO = /Runtime\.callFunctionOn timed out|protocolTimeout|WHATSAPP_BROWSER_OPERATION_TIMEOUT|attempted to use detached frame|frame was detached/i;

export function isWhatsappBrowserStalledError(err: unknown): boolean {
  const mensagem = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return ERRO_BROWSER_TRAVADO.test(mensagem);
}

function comTempoLimiteDeOperacao<T>(promessa: Promise<T>, timeoutMs: number, operacao: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promessa,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(
        `${MARCADOR_TIMEOUT_OPERACAO}: tempo esgotado ao ${operacao}.`,
      )), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

// Retry de operações pontuais já em conexão estabelecida (ex: enviar mensagem que esbarrou
// num "Protocol error" pontual) — precisa ser rápido, o usuário está esperando a ação terminar.
const MAX_TENTATIVAS_AUTOMATICAS = 3;
const INTERVALO_ENTRE_TENTATIVAS_MS = 3000;
const TEMPO_LIMITE_RESOLVER_CONTATO_MS = 60 * 1000;
const TEMPO_LIMITE_ENVIAR_MENSAGEM_MS = 90 * 1000;
const TEMPO_LIMITE_ENCERRAR_BROWSER_MS = 15 * 1000;

// Retry do fluxo de CONEXÃO/QR Code (iniciarTentativa) — deliberadamente mais generoso que o
// de cima. O whatsapp-web.js trata qualquer estado do WhatsApp fora de
// [CONNECTED, OPENING, PAIRING, TIMEOUT] como desconexão fatal e derruba o browser na hora, sem
// nenhuma tolerância a oscilações passageiras (ex: UNPAIRED_IDLE/UNLAUNCHED por um instante) —
// isso é comportamento fixo da lib (Client.js, onAppStateChangedEvent), não dá pra configurar.
// Na prática isso aparece como "escaneei o QR mas ele deslogou e pediu pra escanear de novo",
// às vezes mais de uma vez, principalmente em ambiente headless com CPU mais escassa (o
// handshake de pareamento é uma rajada de operações de criptografia). Como não tem como evitar
// esse comportamento da lib, damos mais fôlego para o retry automático (que já gera um QR novo
// sozinho) se recuperar sem exigir clique manual do usuário.
const MAX_TENTATIVAS_CONEXAO = 6;
const INTERVALO_ENTRE_TENTATIVAS_CONEXAO_MS = 5000;
const TEMPO_PARA_CONSIDERAR_CONEXAO_ESTAVEL_MS = 2 * 60 * 1000;

/**
 * Tempo máximo aguardando o WhatsApp ficar pronto depois de "autenticado" (celular escaneou
 * o QR, mas o whatsapp-web.js às vezes trava nessa fase sem nunca emitir "ready" nem
 * "disconnected" — especialmente em celulares/conexões mais lentas). Sem esse limite, a tela
 * fica presa em "Autenticando…" para sempre, sem nenhuma tentativa automática de recuperação.
 */
const TEMPO_LIMITE_APOS_AUTENTICAR_MS = 3 * 60 * 1000;
const INTERVALO_SAUDE_WHATSAPP_MS = 45 * 1000;
const INTERVALO_CONFERENCIA_ENTREGA_MS = 2 * 60 * 1000;
const INTERVALO_CONFERENCIA_RESPOSTA_MS = 30 * 1000;
const INTERVALO_RETOMADA_SESSAO_MS = 2 * 60 * 1000;
const DEBUG_WHATSAPP_EVENTS = process.env.WHATSAPP_DEBUG_EVENTS === "1";

type Listener = () => void;

interface DiagnosticoWhatsapp {
  versaoWeb: string | null;
  url: string | null;
  memoriaLivreMb: number;
  memoriaTotalMb: number;
  memoriaProcessoMb: number;
  carga1Min: number;
  cpus: number;
}

function mb(bytes: number): number {
  return Math.round(bytes / 1024 / 1024);
}

async function coletarDiagnosticoWhatsapp(client: Client): Promise<DiagnosticoWhatsapp> {
  const [versaoResultado, urlResultado] = await Promise.allSettled([
    client.getWWebVersion(),
    Promise.resolve(client.pupPage?.url() ?? null),
  ]);

  return {
    versaoWeb: versaoResultado.status === "fulfilled" ? String(versaoResultado.value) : null,
    url: urlResultado.status === "fulfilled" ? urlResultado.value : null,
    memoriaLivreMb: mb(os.freemem()),
    memoriaTotalMb: mb(os.totalmem()),
    memoriaProcessoMb: mb(process.memoryUsage().rss),
    carga1Min: Number(os.loadavg()[0].toFixed(2)),
    cpus: os.cpus().length,
  };
}

function formatarDiagnosticoWhatsapp(diagnostico: DiagnosticoWhatsapp): string {
  return [
    diagnostico.versaoWeb ? `WhatsApp Web: ${diagnostico.versaoWeb}` : null,
    diagnostico.url ? `URL: ${diagnostico.url}` : null,
    `Memória livre: ${diagnostico.memoriaLivreMb} MB de ${diagnostico.memoriaTotalMb} MB`,
    `Memória do servidor Node: ${diagnostico.memoriaProcessoMb} MB`,
    `Carga: ${diagnostico.carga1Min} em ${diagnostico.cpus} CPU(s)`,
  ].filter(Boolean).join("\n");
}

interface EnvioAguardandoId {
  chatId: string;
  texto: string;
  resolve: (id: string) => void;
}

export async function encerrarWhatsappClient(
  client: Client,
  logout = false,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let terminou = false;
  try {
    await Promise.race([
      (async () => {
        if (logout) {
          try {
            await client.logout();
          } catch {}
        }
        await client.destroy();
        terminou = true;
      })(),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 5000);
      }),
    ]);
  } catch {
    /* encerra somente o browser desta instância abaixo */
  } finally {
    if (timer) clearTimeout(timer);
    if (!terminou) {
      try {
        client.pupBrowser?.process()?.kill("SIGKILL");
      } catch {}
    }
  }
}

class WhatsappManager {
  private client: Client | null = null;
  private status: WhatsappStatus = "desconectado";
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  private syncProgress: number | null = null;
  private tentativa = 0;
  private inicioTimer: ReturnType<typeof setTimeout> | null = null;
  private falhaInicializacao: ((message: string) => void) | null = null;
  private faseInicializacao: string | null = null;
  private usarVersaoAtual = false;
  private recriacao: Promise<void> | null = null;
  private recuperarPerfilNaFalha = false;
  private perfilRecuperado = false;
  private encerramento: Promise<void> | null = null;
  private cancelarMonitorPareamento: (() => void) | null = null;
  private estabilidadeTimer: ReturnType<typeof setTimeout> | null = null;
  private monitorSaudeTimer: ReturnType<typeof setInterval> | null = null;
  private conferenciaEntregaTimer: ReturnType<typeof setInterval> | null = null;
  private conferenciaRespostaTimer: ReturnType<typeof setInterval> | null = null;
  private conferindoEntregas = false;
  private conferindoRespostas = false;
  private proximoPendenteConferido = 0;
  private tarefasWhatsapp = new WhatsappWorkCoordinator();
  private ultimoLogConferido = 0;
  private retomadaTimer: ReturnType<typeof setTimeout> | null = null;
  private falhasSaude = 0;
  private verificandoSaude = false;
  /** Incrementado a cada connect()/disconnect()/shutdown() para invalidar retries pendentes de uma tentativa anterior. */
  private geracao = 0;
  private listeners = new Set<Listener>();
  /** Envios recentes aguardando o id real via "message_create" (fallback do sendMessage). */
  private enviosAguardandoId: EnvioAguardandoId[] = [];
  /** Acks que chegaram antes do log ser persistido no banco (race condition). */
  private acksPendentes = new Map<string, number>();
  /** true quando a desconexão em curso foi pedida pelo usuário (disconnect/stop) ou pelo
   * encerramento do processo (shutdown) — nesses casos não faz sentido alertar no Telegram, já
   * que quem desconectou sabe disso. false é o padrão: qualquer queda que chegue em
   * failAndCleanUp sem essa flag é inesperada (o WhatsApp caiu sozinho) e merece aviso. */
  private desconexaoManual = false;
  /** Uma única recuperação pode controlar o profile do Chromium por vez. */
  private recuperacaoBrowserEmAndamento: Promise<void> | null = null;

  onChange(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit() {
    for (const l of this.listeners) l();
  }

  getState() {
    return {
      status: this.status,
      qrDataUrl: this.qrDataUrl,
      lastError: this.lastError,
      syncProgress: this.syncProgress,
      sessionSaved: possuiMarcadorDeSessao(),
      faseInicializacao: this.faseInicializacao,
    };
  }

  isReady(): boolean {
    return this.status === "conectado" && this.client !== null;
  }

  private setState(
    partial: Partial<{
      status: WhatsappStatus;
      qrDataUrl: string | null;
      lastError: string | null;
      syncProgress: number | null;
      faseInicializacao: string | null;
    }>,
  ) {
    Object.assign(this, partial);
    if (partial.status && partial.status !== "inicializando") this.faseInicializacao = null;
    if (
      partial.status &&
      partial.status !== "inicializando" &&
      this.inicioTimer
    ) {
      clearTimeout(this.inicioTimer);
      this.inicioTimer = null;
    }
    if (partial.status === "inicializando" && !this.inicioTimer) {
      const geracao = this.geracao;
      this.inicioTimer = setTimeout(() => {
        this.inicioTimer = null;
        if (geracao !== this.geracao || this.status !== "inicializando") return;
        const message = `O WhatsApp excedeu 2 minutos ao iniciar. Etapa: ${this.faseInicializacao || "preparação da conexão"}. A sessão foi preservada.`;
        if (this.falhaInicializacao) {
          this.falhaInicializacao(message);
          return;
        }
        void this.stop().then(() => {
          if (this.geracao === geracao + 1) {
            this.desconexaoManual = false;
            this.setState({
              status: "falha",
              lastError:
                message,
            });
            this.agendarRetomada();
          }
        });
      }, 120000);
      this.inicioTimer.unref();
    }
    emitEvent("whatsapp:status", this.getState());
    this.emit();
  }

  private limparMonitorPareamento(): void {
    const cancelar = this.cancelarMonitorPareamento;
    this.cancelarMonitorPareamento = null;
    cancelar?.();
  }

  private limparEstabilidadeTimer(): void {
    if (!this.estabilidadeTimer) return;
    clearTimeout(this.estabilidadeTimer);
    this.estabilidadeTimer = null;
  }

  private limparMonitorSaude(): void {
    if (this.monitorSaudeTimer) clearInterval(this.monitorSaudeTimer);
    this.monitorSaudeTimer = null;
    if (this.conferenciaEntregaTimer) clearInterval(this.conferenciaEntregaTimer);
    this.conferenciaEntregaTimer = null;
    if (this.conferenciaRespostaTimer) clearInterval(this.conferenciaRespostaTimer);
    this.conferenciaRespostaTimer = null;
    this.falhasSaude = 0;
  }

  private async conferirEntregasRecentes(client: Client): Promise<void> {
    if (this.conferindoEntregas || this.client !== client || this.status !== "conectado") return;
    this.conferindoEntregas = true;
    try {
      const envios = listLogsAguardandoConfirmacao(this.ultimoLogConferido, 10);
      if (!envios.length) {
        this.ultimoLogConferido = 0;
        return;
      }
      for (const envio of envios) {
        if (this.client !== client || this.status !== "conectado") break;
        try {
          await reconciliarConfirmacaoDeEnvio(client, envio);
        } catch (err) {
          console.warn(`[WhatsApp] Não foi possível conferir a entrega do envio ${envio.id}:`, err);
        }
        this.ultimoLogConferido = envio.id;
      }
    } finally {
      this.conferindoEntregas = false;
    }
  }

  private iniciarConferenciaEntrega(client: Client): void {
    if (this.conferenciaEntregaTimer) clearInterval(this.conferenciaEntregaTimer);
    if (this.conferenciaRespostaTimer) clearInterval(this.conferenciaRespostaTimer);
    this.ultimoLogConferido = 0;
    this.proximoPendenteConferido = 0;
    this.conferenciaEntregaTimer = setInterval(() => {
      void this.conferirEntregasRecentes(client);
    }, INTERVALO_CONFERENCIA_ENTREGA_MS);
    this.conferenciaEntregaTimer.unref();
    const inicial = setTimeout(() => void this.conferirEntregasRecentes(client), 15000);
    inicial.unref();
    this.conferenciaRespostaTimer = setInterval(() => {
      void this.conferirRespostasPendentes(client);
    }, INTERVALO_CONFERENCIA_RESPOSTA_MS);
    this.conferenciaRespostaTimer.unref();
    const primeiraResposta = setTimeout(() => void this.conferirRespostasPendentes(client), 10000);
    primeiraResposta.unref();
  }

  /** Recupera respostas cujo evento em tempo real não chegou ao servidor. */
  private conferirRespostasPendentes(client: Client): Promise<void> {
    return this.tarefasWhatsapp.run(client, "conferencia-respostas", () => this.conferirRespostasPendentesSemSobreposicao(client));
  }

  private async conferirRespostasPendentesSemSobreposicao(client: Client): Promise<void> {
    if (this.conferindoRespostas || this.client !== client || this.status !== "conectado") return;
    this.conferindoRespostas = true;
    try {
      let pendentes = listAwaitingRepliesPage(this.proximoPendenteConferido, 5);
      if (!pendentes.length) pendentes = listAwaitingRepliesPage(0, 5);
      if (!pendentes.length) { this.proximoPendenteConferido = 0; return; }
      for (const pendente of pendentes) {
        if (this.client !== client || this.status !== "conectado") break;
        try { await this.verificarMensagemPerdida(client, pendente); }
        catch (error) { console.warn(`[WhatsApp] Falha ao conferir resposta do acompanhamento ${pendente.id}:`, error); }
        this.proximoPendenteConferido = pendente.id;
      }
    } finally { this.conferindoRespostas = false; }
  }

  /** Sessões salvas voltam a tentar conectar mesmo após esgotar as tentativas rápidas. */
  private agendarRetomada(): void {
    if (this.retomadaTimer || this.desconexaoManual || !possuiMarcadorDeSessao()) return;
    this.retomadaTimer = setTimeout(() => {
      this.retomadaTimer = null;
      if (!this.desconexaoManual && this.status !== "conectado" && possuiMarcadorDeSessao()) this.connect();
    }, INTERVALO_RETOMADA_SESSAO_MS);
    this.retomadaTimer.unref();
  }

  /** Detecta um WhatsApp Web congelado antes de o próximo envio do escritório falhar. */
  private iniciarMonitorSaude(client: Client): void {
    this.limparMonitorSaude();
    this.monitorSaudeTimer = setInterval(async () => {
      if (this.verificandoSaude || this.client !== client || this.status !== "conectado") return;
      this.verificandoSaude = true;
      try {
        const browser = client.pupBrowser;
        if (browser && typeof browser.isConnected === "function" && !browser.isConnected()) throw new Error("Chromium desconectado");
        const estado = await comTempoLimiteDeOperacao(client.getState(), 8000, "verificar a saúde do WhatsApp");
        if (this.client !== client || this.status !== "conectado") return;
        if (estado === "CONNECTED") this.falhasSaude = 0;
        else this.falhasSaude++;
      } catch (err) {
        if (this.client === client && this.status === "conectado") {
          this.falhasSaude++;
          console.warn("[WhatsApp] Verificação de saúde falhou:", err);
        }
      } finally {
        this.verificandoSaude = false;
      }
      if (this.client === client && this.status === "conectado" && this.falhasSaude >= 2)
        void this.recuperarBrowserTravado("Verificações de saúde consecutivas sem resposta do WhatsApp Web.");
    }, INTERVALO_SAUDE_WHATSAPP_MS);
    this.monitorSaudeTimer.unref();
  }

  /**
   * Reinicia apenas o Chromium/whatsapp-web.js, preservando o LocalAuth e o marcador da sessão.
   * É o equivalente seguro à reconexão manual que antes destravava o envio, mas sem logout e
   * sem exigir um novo QR Code. Chamadas concorrentes compartilham a mesma recuperação.
   */
  private async recuperarBrowserTravado(motivo: string): Promise<void> {
    if (this.recuperacaoBrowserEmAndamento)
      return this.recuperacaoBrowserEmAndamento;

    const recuperacao = (async () => {
      const clientTravado = this.client;
      this.geracao++;
      const minhaGeracao = this.geracao;
      this.client = null;
      this.tentativa = 0;
      this.desconexaoManual = false;
      this.limparEstabilidadeTimer();
      this.limparMonitorSaude();
      this.limparMonitorPareamento();
      this.setState({
        status: "inicializando",
        lastError:
          "A conexão interna do WhatsApp travou e está sendo reiniciada automaticamente.",
        qrDataUrl: null,
        syncProgress: null,
      });

      recordSystemLog({
        nivel: "aviso",
        categoria: "whatsapp",
        evento: "recuperacao_automatica_browser",
        titulo: "Navegador do WhatsApp reiniciado automaticamente",
        mensagem:
          "O canal interno com o Chromium parou de responder; a sessão autenticada foi preservada.",
        origem: "sistema",
        detalhes: { motivo, instancia: `${os.hostname()}:${process.pid}` },
      });

      if (clientTravado) {
        let encerrou = false;
        try {
          await Promise.race([
            clientTravado.destroy().then(() => {
              encerrou = true;
            }),
            new Promise<void>((resolve) =>
              setTimeout(resolve, TEMPO_LIMITE_ENCERRAR_BROWSER_MS),
            ),
          ]);
        } catch {
          // O processo filho será encerrado abaixo se destroy() também estiver travado.
        }

        if (!encerrou) {
          try {
            clientTravado.pupBrowser?.process()?.kill("SIGKILL");
          } catch {
            // limpeza best-effort restrita ao Chromium desta instância
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      if (minhaGeracao !== this.geracao) return;
      clearLegacyWebVersionCache();
      this.iniciarTentativaSegura(minhaGeracao);
    })();

    this.recuperacaoBrowserEmAndamento = recuperacao;
    try {
      await recuperacao;
    } finally {
      if (this.recuperacaoBrowserEmAndamento === recuperacao)
        this.recuperacaoBrowserEmAndamento = null;
    }
  }

  private async tratarTravamentoDeOperacao(err: unknown, resultadoIncerto: boolean, clientDaOperacao: Client): Promise<never> {
    const mensagem = err instanceof Error ? err.message : String(err);
    // Uma falha tardia de um Client antigo não deve reiniciar a conexão recém-recuperada.
    if (this.client === clientDaOperacao) await this.recuperarBrowserTravado(mensagem);
    if (resultadoIncerto) {
      throw new Error(
        "O navegador do WhatsApp travou durante o envio e foi reiniciado automaticamente. " +
        "Confira a conversa antes de reenviar, pois a mensagem pode ter sido concluída.",
      );
    }
    throw new Error(
      "A conexão interna do WhatsApp travou e está sendo reiniciada automaticamente. " +
      "Aguarde o status voltar para conectado e tente novamente.",
    );
  }

  private iniciarTentativaSegura(minhaGeracao: number): void {
    this.iniciarTentativa(minhaGeracao).catch(async (err) => {
      if (minhaGeracao !== this.geracao) return;
      const client = this.client;
      this.client = null;
      this.limparMonitorPareamento();
      if (client) {
        try {
          await encerrarWhatsappClient(client);
        } catch {
          // limpeza best-effort
        }
      }
      if (minhaGeracao !== this.geracao) return;
      liberarLockDaInstancia();
      const mensagem = (err as Error)?.message || String(err);
      console.error("[WhatsApp] Falha ao iniciar a instância:", err);
      this.setState({
        status: "falha",
        lastError: mensagem,
        qrDataUrl: null,
        syncProgress: null,
      });
      this.agendarRetomada();
    });
  }

  connect(preferCurrentVersion = true): boolean {
    if (this.encerramento) return false;
    if (this.client || this.status === "inicializando") return true;
    if (this.retomadaTimer) clearTimeout(this.retomadaTimer);
    this.retomadaTimer = null;
    if (!adquirirLockDaInstancia()) {
      this.setState({
        status: "falha",
        lastError:
          "Outra instância do servidor já está controlando esta sessão do WhatsApp.",
        qrDataUrl: null,
        syncProgress: null,
      });
      return false;
    }
    clearLegacyWebVersionCache();
    this.geracao++;
    this.tentativa = 0;
    this.recuperarPerfilNaFalha = false;
    this.perfilRecuperado = false;
    // A biblioteca atual normaliza os IDs da versão corrente; a versão arquivada é fallback.
    this.usarVersaoAtual = preferCurrentVersion;
    this.limparEstabilidadeTimer();
    this.desconexaoManual = false;
    this.syncProgress = null;
    this.iniciarTentativaSegura(this.geracao);
    return true;
  }

  /** One user action restores the saved session or prepares a fresh QR when needed. */
  async connectWithRecovery(): Promise<void> {
    if (this.client || this.status === "inicializando" || this.encerramento) return;
    const renovar = !possuiMarcadorDeSessao() && fs.existsSync(AUTH_SESSION_DIR);
    if (renovar) await this.recreateSession();
    else this.connect();
    this.perfilRecuperado = renovar;
    this.recuperarPerfilNaFalha = true;
  }

  /** Restaura automaticamente apenas quando já existe uma sessão autenticada no disco. */
  restoreSavedSession(): boolean {
    if (!possuiMarcadorDeSessao()) return false;
    return this.connect();
  }

  private async iniciarTentativa(minhaGeracao: number): Promise<void> {
    if (minhaGeracao !== this.geracao) return; // uma chamada mais recente (connect/disconnect) já assumiu

    this.limparMonitorPareamento();
    // A nova tentativa recebe o prazo completo; o timer da anterior não pode
    // interromper o navegador recém-criado durante uma recuperação automática.
    if (this.inicioTimer) { clearTimeout(this.inicioTimer); this.inicioTimer = null; }
    clearStaleChromiumLocks();
    // A sessão fica em Local Storage/IndexedDB e não é apagada aqui. Limpamos somente caches
    // descartáveis para impedir que um bundle antigo do WhatsApp Web derrube a conexão.
    clearStaleServiceWorkerCache();
    this.falhaInicializacao = null;
    this.setState({ status: "inicializando", lastError: null, qrDataUrl: null, syncProgress: null, faseInicializacao: "Preparando o navegador" });
    let clientDaTentativa: Client | null = null;
    const informarEtapa = (description: string) => {
      if (minhaGeracao === this.geracao && this.status === "inicializando" && (!clientDaTentativa || this.client === clientDaTentativa)) this.setState({ faseInicializacao: description });
    };

    // O commit do whatsapp-web.js fixado no package.json contém a correção oficial para
    // reinjeções concorrentes e listeners duplicados quando o WhatsApp Web recarrega como SPA.
    // A versão 1.34.7 publicada no npm ainda não inclui essa correção e pode acumular handlers
    // até a própria página navegar para post_logout=1.
    //
    // Historicamente usávamos webVersionCache: "none" para evitar um problema documentado da
    // comunidade: por padrão o whatsapp-web.js guarda em cache local a versão do WhatsApp Web
    // que funcionou da última vez, e volta a usar essa MESMA versão em cada tentativa seguinte.
    // Se o WhatsApp atualizou o cliente web nesse meio tempo, a versão cacheada fica
    // incompatível e toda tentativa falha do mesmo jeito, sempre no mesmo ponto (exatamente o
    // padrão "Execution context was destroyed" antes do QR, de forma consistente).
    //
    // Só que "none" sempre puxa a build MAIS NOVA (às vezes literalmente alpha do dia) servida
    // pelo WhatsApp — e essa build muda por fora do nosso controle. Foi assim que o id das
    // mensagens (message.id._serialized) passou a vir "undefined" em 100% dos eventos
    // message_ack/message_create em produção: o whatsapp-web.js injeta um patch no Store
    // interno do WhatsApp Web esperando um formato específico, e quando o WhatsApp muda esse
    // formato numa build nova, esse patch (não a conexão em si) quebra silenciosamente — por
    // isso reações/mensagens recebidas continuam funcionando (caminho diferente), mas o id de
    // mensagens enviadas por nós não.
    //
    // A primeira correção foi fixar um arquivo de versão específico do wa-version (mantido pela
    // comunidade wppconnect, referência oficial do whatsapp-web.js para esse cenário). Só que
    // esse repositório poda os arquivos mais antigos com o tempo — a versão que fixamos por
    // nome sumiu de lá poucos dias depois, e o problema voltou (strict:false caiu de volta para
    // "mais recente"). A correção agora é resolver isso DINAMICAMENTE a cada tentativa de
    // conexão via resolveWaVersionCache(): consultamos a listagem atual do repositório e
    // escolhemos uma versão recente já estabilizada, deixando de fora as últimas builds. Se a consulta falhar por
    // qualquer motivo, caímos no comportamento anterior (mais recente) em vez de travar.
    informarEtapa("Selecionando versão do WhatsApp Web");
    const source = this.usarVersaoAtual ? { type: "none" as const } : await resolveWaVersionCache();
    const version = await prepareWhatsappVersion(source, path.join(dataDir, "whatsapp-web-cache"), informarEtapa);
    if (minhaGeracao !== this.geracao) return; // connect()/disconnect() aconteceu enquanto resolvíamos a versão

    const authStrategy = new LocalAuth({ dataPath: AUTH_DATA_PATH });
    const afterBrowserInitialized = authStrategy.afterBrowserInitialized?.bind(authStrategy);
    const client = new Client({
      authStrategy,
      puppeteer: {
        headless: true,
        timeout: 20000,
        // Além de impedir throttling em segundo plano, usamos /tmp em vez do /dev/shm. Em
        // instâncias pequenas ou containers, o /dev/shm costuma ter só 64 MB; quando ele enche,
        // o Chromium fica instável justamente durante a sincronização inicial do WhatsApp.
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--no-first-run",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",
        ],
        // O limite do protocolo fica folgado para inicialização/sincronização. Nas operações de
        // envio e consulta usamos watchdogs menores, que reiniciam o browser automaticamente.
        protocolTimeout: 600000,
      },
      ...version,
      // Quantas vezes o QR Code pode ser renovado (o WhatsApp Web troca a imagem sozinho a
      // cada ~20-30s) antes do whatsapp-web.js desistir e desconectar. Um valor generoso dá
      // mais tempo real para escanear em celulares mais lentos, sem travar para sempre — depois
      // de esgotado, nosso próprio retry automático entra em ação e gera um QR novo.
      qrMaxRetries: 12,
      authTimeoutMs: 90000,
    });
    this.client = client;
    clientDaTentativa = client;
    informarEtapa("Iniciando navegador do WhatsApp");
    authStrategy.afterBrowserInitialized = async () => {
      await afterBrowserInitialized?.();
      if (minhaGeracao !== this.geracao || this.client !== client || !client.pupPage) return;
      configureWhatsappStartupPage(client.pupPage, informarEtapa);
    };

    let pronto = false;
    let encerrandoTentativa = false;
    let sequenciaQr = 0;
    let sondagemEmAndamento = false;
    let falhasDeSondagem = 0;
    let sincronizacaoObservada = false;
    let monitorPareamento: ReturnType<typeof setInterval> | null = null;
    const tentativaAtiva = () => minhaGeracao === this.geracao && this.client === client && !encerrandoTentativa;
    let readyWatchdog: ReturnType<typeof setTimeout> | null = null;
    const limparReadyWatchdog = () => {
      if (readyWatchdog) {
        clearTimeout(readyWatchdog);
        readyWatchdog = null;
      }
    };

    this.cancelarMonitorPareamento = () => {
      sequenciaQr++;
      limparReadyWatchdog();
      if (monitorPareamento) clearInterval(monitorPareamento);
      monitorPareamento = null;
    };

    const failAndCleanUp = async (
      status: WhatsappStatus,
      message: string,
      invalidarSessao = false,
      diagnostico?: DiagnosticoWhatsapp
    ) => {
      if (!tentativaAtiva()) return;
      encerrandoTentativa = true;
      this.limparMonitorPareamento();
      this.limparEstabilidadeTimer();
      this.limparMonitorSaude();

      // O whatsapp-web.js costuma emitir "disconnected" de forma espúria durante o próprio
      // fluxo de pareamento (ex: "Max qrcode retries reached", ou uma oscilação momentânea
      // do estado do socket logo após o QR ser escaneado, antes do evento "ready") — a lib trata
      // QUALQUER estado fora de [CONNECTED, OPENING, PAIRING, TIMEOUT] como desconexão fatal e
      // já derruba o browser sozinha, sem nenhuma tolerância a oscilações passageiras (ver
      // Client.js, onAppStateChangedEvent). Não tem como configurar isso na lib. Se ainda não
      // tínhamos chegado a "conectado" nesta tentativa, tratamos como falha transitória e
      // tentamos de novo automaticamente (com um QR novo) — só paramos sem retry quando a
      // desconexão acontece DEPOIS de já estar conectado (ex: logout pelo celular), que é uma
      // desconexão real.
      const statusAntesDaFalha = this.status;
      const etapaDaFalha = this.faseInicializacao;
      const aindaNaoConectouNestaTentativa = statusAntesDaFalha !== "conectado";
      const falhaLogoAposEscanear = statusAntesDaFalha === "autenticado" || statusAntesDaFalha === "pareando";
      const motivoNormalizado = normalizarMotivoDesconexao(message);
      if (statusAntesDaFalha === "inicializando") this.usarVersaoAtual = !this.usarVersaoAtual;
      recordSystemLog({
        nivel: "erro", categoria: "whatsapp", evento: "falha_conexao",
        titulo: "Não foi possível concluir a conexão do WhatsApp",
        mensagem: etapaDaFalha ? `${message} Etapa: ${etapaDaFalha}.` : message,
        origem: "sistema", detalhes: { etapa: etapaDaFalha, tentativa: this.tentativa, versao: version.webVersion ?? "atual" },
      });

      if (motivoNormalizado === "DEPRECATED_VERSION") invalidarWaVersionCache();

      await encerrarWhatsappClient(client);
      if (this.client !== client || minhaGeracao !== this.geracao) return; // tentativa antiga
      this.client = null;
      this.falhaInicializacao = null;
      if (invalidarSessao) removerSessaoPersistida();

      // A manual connection can renew a profile once if the page loaded but the
      // library never reached QR/authentication. Background restores preserve it.
      let renovouPerfil = false;
      if (this.recuperarPerfilNaFalha && !this.perfilRecuperado && !invalidarSessao &&
          statusAntesDaFalha === "inicializando" && etapaDaFalha === "Preparando o vínculo e o QR Code" &&
          /waiting failed|waiting for function|auth timeout|excedeu 2 minutos/i.test(message)) {
        this.perfilRecuperado = true;
        try {
          backupWhatsappProfile(dataDir, chromiumDoProfileEstaAtivo);
          renovouPerfil = true;
          this.usarVersaoAtual = true;
          recordSystemLog({ nivel: "aviso", categoria: "whatsapp", evento: "recuperacao_automatica_perfil", titulo: "Renovando vínculo do WhatsApp", mensagem: "A inicialização travou antes do QR. O perfil anterior foi guardado em backup para preparar uma nova sessão.", origem: "sistema" });
        } catch (error) {
          recordSystemLog({ nivel: "erro", categoria: "whatsapp", evento: "falha_recuperacao_perfil", titulo: "Não foi possível renovar o vínculo", mensagem: error instanceof Error ? error.message : String(error), origem: "sistema" });
        }
      }

      const deveTentarNovamente =
        minhaGeracao === this.geracao &&
        this.tentativa < MAX_TENTATIVAS_CONEXAO &&
        !motivoImpedeRetryAutomatico(motivoNormalizado) &&
        (ERRO_TRANSITORIO.test(message) || aindaNaoConectouNestaTentativa || possuiMarcadorDeSessao());

      if (deveTentarNovamente) {
        this.tentativa++;
        this.setState({
          status: "inicializando",
          lastError: renovouPerfil ? "A sessão não respondeu. Preparando um novo QR Code para conectar…" : falhaLogoAposEscanear
            ? `O WhatsApp não concluiu a sincronização (${this.tentativa}/${MAX_TENTATIVAS_CONEXAO}). Retomando a conexão com a sessão preservada…`
            : `Falha temporária ao conectar (${message}), tentando novamente (${this.tentativa}/${MAX_TENTATIVAS_CONEXAO})…`,
          qrDataUrl: null,
          syncProgress: null,
        });
        setTimeout(
          () => this.iniciarTentativaSegura(minhaGeracao),
          atrasoRetryConexaoMs(this.tentativa, INTERVALO_ENTRE_TENTATIVAS_CONEXAO_MS)
        );
        return;
      }

      liberarLockDaInstancia();
      if (!this.desconexaoManual) {
        this.notificarDesconexaoInesperada(message, diagnostico).catch((err) =>
          console.error("[Notificações] Erro ao enviar alerta de desconexão ao Telegram:", err)
        );
      }
      this.setState({ status, lastError: message, qrDataUrl: null, syncProgress: null });
      if (!motivoImpedeRetryAutomatico(motivoNormalizado)) this.agendarRetomada();
    };
    this.falhaInicializacao = message => { void failAndCleanUp("falha", message); };

    const reconhecerPareamento = () => {
      if (!tentativaAtiva() || pronto || this.status === "autenticado") return;
      // A confirmação abre uma única janela de sincronização, após a validação do vínculo.
      limparReadyWatchdog();
      // Invalida também uma imagem de QR que ainda está sendo codificada.
      sequenciaQr++;
      this.setState({ status: "autenticado", qrDataUrl: null, syncProgress: this.syncProgress ?? 0 });
      // O evento authenticated da biblioteca depende da sincronização. CONNECTED já
      // confirma o vínculo, mas somente ready libera consultas e envio de mensagens.
      readyWatchdog = setTimeout(() => {
        void failAndCleanUp(
          "falha",
          "O dispositivo foi vinculado, mas o WhatsApp não concluiu a sincronização em 3 minutos. A sessão foi preservada para retomar a conexão."
        );
      }, TEMPO_LIMITE_APOS_AUTENTICAR_MS);
      readyWatchdog.unref();
    };

    const aguardarValidacaoPareamento = () => {
      if (!tentativaAtiva() || pronto || this.status !== "aguardando_qr") return;
      sequenciaQr++;
      limparReadyWatchdog();
      this.setState({ status: "pareando", qrDataUrl: null, syncProgress: null });
      readyWatchdog = setTimeout(() => {
        void failAndCleanUp("falha", "O WhatsApp não concluiu a validação do vínculo com o celular em 3 minutos. A sessão foi preservada para retomar a conexão.");
      }, TEMPO_LIMITE_APOS_AUTENTICAR_MS);
      readyWatchdog.unref();
    };

    const observarSincronizacao = () => {
      if (!tentativaAtiva() || pronto) return;
      sincronizacaoObservada = true;
      // loading_screen pode chegar antes de authenticated/CONNECTED. A partir daqui o
      // watchdog de sincronização assume; o limite de inicialização de 2 minutos não
      // pode encerrar um carregamento que ainda tem sua janela de 3 minutos válida.
      if (this.inicioTimer) {
        clearTimeout(this.inicioTimer);
        this.inicioTimer = null;
      }
      // loading_screen é emitido somente depois que o WhatsApp começa a carregar a conta.
      // Mesmo que getState() seja interrompido por uma navegação, esta fase precisa continuar
      // limitada: se o evento ready nunca vier, recuperamos o browser preservando a sessão.
      if (!readyWatchdog) {
        readyWatchdog = setTimeout(() => {
          void failAndCleanUp(
            "falha",
            "O WhatsApp iniciou a sincronização, mas não ficou pronto em 3 minutos. A sessão foi preservada para retomar a conexão."
          );
        }, TEMPO_LIMITE_APOS_AUTENTICAR_MS);
        readyWatchdog.unref();
      }
    };

    const verificarPareamento = async () => {
      if (!tentativaAtiva() || pronto || sondagemEmAndamento || !client.pupPage) return;
      sondagemEmAndamento = true;
      try {
        const estado = await comTempoLimiteDeOperacao(client.getState(), 8000, "verificar o pareamento");
        if (!tentativaAtiva() || pronto) return;
        falhasDeSondagem = 0;
        if (estado === "CONNECTED") reconhecerPareamento();
        else if (estado === "PAIRING") aguardarValidacaoPareamento();
      } catch (err) {
        if (!tentativaAtiva() || pronto || this.status === "inicializando") return;
        const mensagem = err instanceof Error ? err.message : String(err);
        // O WhatsApp troca o documento principal durante o pareamento e a sincronização. Nesse
        // instante o Puppeteer invalida o ExecutionContext antigo, mas o novo contexto continua
        // carregando normalmente. Não some essas navegações às falhas de browser; o watchdog
        // acima ainda recupera a tentativa caso o evento ready realmente não aconteça.
        if (ERRO_TRANSITORIO.test(mensagem) && !isWhatsappBrowserStalledError(err)) return;
        // Navegações isoladas não reiniciam o pareamento. Uma página que não responde
        // repetidamente é recuperada pelo mesmo fluxo limitado de reconexão, sem logout.
        if (++falhasDeSondagem >= 3) {
          void failAndCleanUp("falha", "O navegador do WhatsApp deixou de responder durante o pareamento. A sessão foi preservada.");
        }
      } finally {
        sondagemEmAndamento = false;
      }
    };
    monitorPareamento = setInterval(() => { void verificarPareamento(); }, 2000);
    monitorPareamento.unref();

    client.on("qr", async (qr) => {
      if (!tentativaAtiva() || pronto || this.status === "autenticado") return;
      const seq = ++sequenciaQr;
      if (this.status === "pareando") limparReadyWatchdog();
      // Um QR novo indica que o vínculo anterior deixou de ser restaurável. Não apaga o profile.
      removerMarcadorDeSessao();
      try {
        const qrDataUrl = await QRCode.toDataURL(qr);
        if (!tentativaAtiva() || pronto || seq !== sequenciaQr) return;
        this.setState({ status: "aguardando_qr", qrDataUrl, syncProgress: null });
      } catch {
        if (tentativaAtiva() && !pronto && seq === sequenciaQr)
          void failAndCleanUp("falha", "Não foi possível preparar o QR Code. Tente conectar novamente.");
      }
    });

    client.on("loading_screen", (percent) => {
      if (!tentativaAtiva() || pronto) return;
      observarSincronizacao();
      const valor = Number(percent);
      this.setState({ syncProgress: Number.isFinite(valor) ? Math.max(0, Math.min(100, valor)) : null });
      // Progresso sozinho não comprova autenticação; consulta o estado do socket.
      void verificarPareamento();
    });

    client.on("authenticated", reconhecerPareamento);

    client.on("change_state", (state) => {
      console.log(`[WhatsApp][${os.hostname()}:${process.pid}] Estado da conexão: ${String(state)}`);
    });

    client.on("ready", () => {
      if (!tentativaAtiva()) return;
      pronto = true;
      this.limparMonitorPareamento();
      marcarSessaoPersistida();
      this.setState({ status: "conectado", qrDataUrl: null, syncProgress: 100 });
      this.iniciarMonitorSaude(client);
      this.iniciarConferenciaEntrega(client);
      this.limparEstabilidadeTimer();
      this.estabilidadeTimer = setTimeout(() => {
        if (this.client === client && this.status === "conectado") this.tentativa = 0;
        this.estabilidadeTimer = null;
      }, TEMPO_PARA_CONSIDERAR_CONEXAO_ESTAVEL_MS);

      coletarDiagnosticoWhatsapp(client)
        .then((diagnostico) => console.log(`[WhatsApp] Conexão pronta.\n${formatarDiagnosticoWhatsapp(diagnostico)}`))
        .catch((err) => console.error("[WhatsApp] Não foi possível coletar o diagnóstico da conexão:", err));

      // "ready" dispara em toda reconexão (não só na primeira). O whatsapp-web.js não reemite
      // "message"/"message_reaction" para o que chegou enquanto a sessão estava desconectada —
      // esses eventos só pegam o que chega ao vivo, depois do client já pronto — então sem essa
      // checagem, uma resposta de texto do cliente durante uma queda ficaria presa em
      // "aguardando" para sempre.
      this.reconciliarPendentesAoReconectar().catch((err) =>
        console.error("Erro ao verificar mensagens perdidas durante a desconexão:", err)
      );
    });

    client.on("auth_failure", (msg) => {
      failAndCleanUp("falha", String(msg), true);
    });

    client.on("disconnected", async (reason) => {
      if (minhaGeracao !== this.geracao || this.client !== client) return;
      const motivo = String(reason);
      const diagnostico = await comTempoLimiteDeOperacao(coletarDiagnosticoWhatsapp(client), 5000, "coletar o diagnóstico da desconexão").catch(() => undefined);
      console.error(
        `[WhatsApp][${os.hostname()}:${process.pid}] Desconectado: ${motivo}` +
        (diagnostico ? `\n${formatarDiagnosticoWhatsapp(diagnostico)}` : "")
      );
      await failAndCleanUp(
        "desconectado",
        motivo,
        deveInvalidarSessao(motivo, this.status === "conectado"),
        diagnostico
      );
    });

    // "message" só dispara para mensagens recebidas (não inclui as que o próprio bot envia).
    // Chega uma mensagem de QUALQUER conversa; o filtro por "está esperando resposta desse
    // telefone/conversa" acontece dentro de resolvePendingReplyForMessage.
    client.on("message", (message: Message) => {
      if (!tentativaAtiva() || message.fromMe || message.from.endsWith("@g.us")) return;
      this.processarMensagemRecebida(client, message).catch(
        (err) => console.error("Erro ao processar mensagem recebida:", err)
      );
    });

    // Só considera reações feitas em mensagens que NÓS enviamos (msgId.fromMe) — reações em
    // mensagens de terceiros na mesma conversa são ignoradas. reaction.reaction vem vazia
    // quando o cliente remove a reação, então também ignoramos esse caso.
    client.on("message_reaction", (reaction: Reaction) => {
      if (!reaction.msgId.fromMe || !reaction.reaction) return;
      this.resolvePendingReplyForReaction(reaction).catch((err) =>
        console.error("Erro ao processar reação recebida:", err)
      );
    });

    // "message_create" dispara para toda mensagem criada. Para mensagens recebidas, funciona
    // como redundância do evento "message" (a resolução é idempotente: depois da primeira, o
    // pendente deixa de estar em "aguardando"). Para mensagens nossas, é o fallback que captura
    // o ID real quando o retorno direto de client.sendMessage() vem vazio.
    client.on("message_create", (message: Message) => {
      if (!tentativaAtiva()) return;
      if (!message.fromMe) {
        if (message.from.endsWith("@g.us")) return;
        this.processarMensagemRecebida(client, message).catch((err) =>
          console.error("Erro ao processar mensagem recebida pelo fallback:", err)
        );
        return;
      }

      const messageId = whatsappMessageIdCandidates(message.id)[0];
      const toDigits = String(message.to || "").split("@")[0];
      if (DEBUG_WHATSAPP_EVENTS) console.log(`[WhatsApp] message_create detectado (fromMe) para: ${toDigits}`);
      if (!messageId) {
        console.warn("[WhatsApp] message_create sem identificador utilizável.");
        return;
      }

      // Prefere chat + texto exatos e usa somente o chat como fallback. Como os envios para o
      // mesmo contato são sequenciais, isso associa o ID ao envio que está aguardando agora.
      let idx = this.enviosAguardandoId.findIndex(
        (e) => e.chatId.split("@")[0] === toDigits && e.texto === message.body
      );
      if (idx === -1) {
        idx = this.enviosAguardandoId.findIndex((e) => e.chatId.split("@")[0] === toDigits);
      }
      if (idx === -1) return;

      const [aguardando] = this.enviosAguardandoId.splice(idx, 1);
      console.log(`[WhatsApp] ID capturado via fallback para ${toDigits}: ${messageId}`);
      aguardando.resolve(messageId);
    });

    // "message_ack" dispara a cada mudança no status de confirmação de uma mensagem NOSSA
    // (✓ enviado ao servidor, ✓✓ cinza entregue no aparelho, ✓✓ azul lido). Associamos pelo id
    // da mensagem do WhatsApp, salvo tanto em send_logs quanto em pending_replies (quando há
    // monitoramento de resposta ativo) no momento do envio, em dispatchService.
    client.on("message_ack", (message: Message, ack: number) => {
      // Confirmações de mensagens recebidas não pertencem aos envios do sistema.
      if (!tentativaAtiva() || message.fromMe === false || !Number.isInteger(ack) || ack < -1 || ack > 4) return;
      try {
        const messageId = whatsappMessageIdCandidates(message.id)[0];
        if (!messageId) {
          console.warn(`[WhatsApp] message_ack sem identificador utilizável. ACK=${ack}`);
          return;
        }

        // Em algumas versões do WhatsApp Web, message_ack chega antes de message_create. Nesse
        // caso ele também conclui a captura do ID para que o log seja salvo com rastreamento.
        const toDigits = String(message.to || "").split("@")[0];
        let waitingIndex = this.enviosAguardandoId.findIndex(
          (e) => e.chatId.split("@")[0] === toDigits && e.texto === message.body
        );
        if (waitingIndex === -1) {
          waitingIndex = this.enviosAguardandoId.findIndex((e) => e.chatId.split("@")[0] === toDigits);
        }
        if (waitingIndex !== -1) {
          const [aguardando] = this.enviosAguardandoId.splice(waitingIndex, 1);
          aguardando.resolve(messageId);
        }

        if (DEBUG_WHATSAPP_EVENTS) console.log(`[WhatsApp] Evento message_ack recebido: ID=${messageId}, ACK=${ack}`);

        const log = updateLogAckByMessageId(messageId, ack);
        const pending = updatePendingReplyAckByMessageId(messageId, ack);

        if (log) {
          if (DEBUG_WHATSAPP_EVENTS) console.log(`[WhatsApp] Status do Log atualizado: ${messageId}`);
          emitEvent("send:ack-update", log);
        }
        if (pending) {
          if (DEBUG_WHATSAPP_EVENTS) console.log(`[WhatsApp] Status do Pendente atualizado: ${messageId}`);
          emitEvent("pendingReply:ack-update", pending);
        }

        // Se não encontrou nem log nem pendente, pode ser que o registro ainda não tenha sido
        // salvo no banco (race condition). Guardamos o ack para tentar aplicar logo em seguida.
        if (!log || !pending) {
          const stableKey = whatsappMessageStableKey(messageId);
          if (DEBUG_WHATSAPP_EVENTS) console.log(`[WhatsApp] ACK órfão detectado (race condition), guardando: ${stableKey}`);
          const previousAck = this.acksPendentes.get(stableKey);
          if (previousAck === undefined || ack === -1 || ack > previousAck) {
            this.acksPendentes.set(stableKey, ack);
          }
          // Limpa do cache após 30 segundos para não vazar memória
          setTimeout(() => this.acksPendentes.delete(stableKey), 30000);
        }
      } catch (err) {
        console.error("Erro ao processar confirmação de entrega/leitura:", err);
      }
    });

    client.initialize().then(() => {
      if (minhaGeracao !== this.geracao || this.client !== client) void encerrarWhatsappClient(client);
      else void verificarPareamento();
    }).catch((err) => {
      const mensagem = err?.message ?? String(err);
      // A própria biblioteca reinstala suas funções quando o documento principal navega. A
      // promessa original de initialize(), porém, pode rejeitar com o ExecutionContext antigo
      // mesmo enquanto loading_screen/authenticated continuam avançando no novo documento.
      // Destruir o Client aqui interromperia uma sincronização válida logo após o QR.
      if (
        tentativaAtiva() &&
        ERRO_TRANSITORIO.test(mensagem) &&
        !isWhatsappBrowserStalledError(err) &&
        (sincronizacaoObservada || this.status === "pareando" || this.status === "autenticado")
      ) {
        observarSincronizacao();
        void verificarPareamento();
        return;
      }
      void failAndCleanUp("falha", mensagem);
    });
  }

  private async encerrar(logout = false): Promise<void> {
    this.recuperarPerfilNaFalha = false;
    this.perfilRecuperado = false;
    if (this.encerramento) {
      await this.encerramento;
      if (logout) removerSessaoPersistida();
      return;
    }
    this.geracao++;
    this.desconexaoManual = true;
    this.limparEstabilidadeTimer();
    this.limparMonitorSaude();
    if (this.retomadaTimer) clearTimeout(this.retomadaTimer);
    this.retomadaTimer = null;
    this.limparMonitorPareamento();
    const client = this.client;
    this.client = null;
    this.falhaInicializacao = null;
    this.setState({
      status: "desconectado",
      qrDataUrl: null,
      lastError: null,
      syncProgress: null,
    });
    const fechamento = (async () => {
      if (client) await encerrarWhatsappClient(client, logout);
      if (logout) removerSessaoPersistida();
      liberarLockDaInstancia();
    })();
    this.encerramento = fechamento;
    try {
      await fechamento;
    } finally {
      if (this.encerramento === fechamento) this.encerramento = null;
    }
  }
  async stop(): Promise<void> {
    await this.encerrar();
  }
  recreateSession(): Promise<void> {
    if (this.recriacao) return this.recriacao;
    const operation = (async () => {
      await this.stop();
      if (!adquirirLockDaInstancia()) throw new WhatsappSessionRecoveryError("Outra instância está usando esta sessão. Não foi possível recriar o vínculo.");
      try {
        backupWhatsappProfile(dataDir, chromiumDoProfileEstaAtivo);
      } finally {
        liberarLockDaInstancia();
      }
      recordSystemLog({ nivel: "info", categoria: "whatsapp", evento: "sessao_recriada", titulo: "Preparando uma nova sessão do WhatsApp", mensagem: "O perfil anterior foi preservado em backup. Um novo vínculo será solicitado pelo QR Code.", origem: "usuario" });
      if (!this.connect()) throw new WhatsappSessionRecoveryError("Não foi possível iniciar a nova sessão. Tente conectar novamente.");
    })();
    this.recriacao = operation;
    void operation.finally(() => { if (this.recriacao === operation) this.recriacao = null; }).catch(() => {});
    return operation;
  }
  async disconnect(): Promise<void> {
    await this.encerrar(true);
  }
  async shutdown(): Promise<void> {
    await this.encerrar();
  }

  /**
   * Avisa no Telegram quando o WhatsApp cai sozinho (não por ação do usuário) — sem isso, nada
   * mais é enviado até alguém notar e reconectar manualmente pela tela, e não tem outro jeito de
   * saber disso a distância. Silencioso se a integração não estiver configurada.
   */
  private async notificarDesconexaoInesperada(
    motivo: string,
    diagnostico?: DiagnosticoWhatsapp,
  ) {
    const token = getSetting("telegram_bot_token");
    const chatId = getSetting("telegram_chat_id");
    const motivoNormalizado = normalizarMotivoDesconexao(motivo);
    const orientacao =
      motivoNormalizado === "LOGOUT"
        ? "\n\nO próprio WhatsApp Web encerrou e invalidou o vínculo. O diagnóstico abaixo permite distinguir incompatibilidade da interface web de falta de recursos no servidor."
        : "";
    const detalhes = diagnostico
      ? `\n\nDiagnóstico:\n${formatarDiagnosticoWhatsapp(diagnostico)}`
      : "";
    const dadosLog = {
      motivo,
      motivo_normalizado: motivoNormalizado,
      instancia: `${os.hostname()}:${process.pid}`,
      diagnostico: diagnostico ?? null,
      canal_configurado: Boolean(token && chatId),
    };

    if (!token || !chatId) {
      recordSystemLog({
        nivel: "erro",
        categoria: "whatsapp",
        evento: "desconexao_inesperada",
        titulo: "WhatsApp desconectado inesperadamente",
        mensagem:
          "A desconexão foi detectada, mas o Telegram não está configurado para receber o alerta.",
        origem: "sistema",
        detalhes: dadosLog,
      });
      return;
    }

    try {
      await enviarMensagemTelegram(
        token,
        chatId,
        `🔌 O WhatsApp do DisparaZap desconectou inesperadamente.\n\nMotivo: ${motivo}\nInstância: ${os.hostname()}:${process.pid}${orientacao}${detalhes}\n\nNenhuma mensagem será enviada até reconectar. Acesse Configurações → Conexão com o WhatsApp para reconectar.`,
      );
      recordSystemLog({
        nivel: "erro",
        categoria: "whatsapp",
        evento: "desconexao_inesperada",
        titulo: "WhatsApp desconectado inesperadamente",
        mensagem:
          "A desconexão foi detectada e o alerta foi enviado pelo Telegram.",
        origem: "sistema",
        detalhes: {
          ...dadosLog,
          notificacao: { canal: "Telegram", sucesso: true },
        },
      });
    } catch (err) {
      recordSystemLog({
        nivel: "erro",
        categoria: "whatsapp",
        evento: "desconexao_inesperada",
        titulo: "WhatsApp desconectado inesperadamente",
        mensagem:
          "A desconexão foi detectada, mas o alerta pelo Telegram falhou.",
        origem: "sistema",
        detalhes: {
          ...dadosLog,
          notificacao: {
            canal: "Telegram",
            sucesso: false,
            erro: (err as Error).message,
          },
        },
      });
      throw err;
    }
  }

  /**
   * Tenta aplicar um ack que chegou antes do registro existir no banco.
   * Chamado por logsService/pendingRepliesService logo após o INSERT.
   *
   * dispatchService cria o pending_reply ANTES do send_log (precisa do pending para casar a
   * resposta do cliente antes de logar o envio) — então, quando um ack chega bem cedo (antes de
   * QUALQUER um dos dois existir), este método é chamado duas vezes em sequência para o mesmo
   * messageId: uma vez pelo INSERT do pending, outra pelo INSERT do log. Importante: NÃO apagar
   * a entrada do cache assim que um dos dois achar seu registro — se apagássemos aqui, a segunda
   * chamada (log) chegaria com o cache já vazio e o Histórico nunca receberia esse ack, mesmo
   * com o pending (que roda primeiro) tendo funcionado normalmente. As UPDATEs são idempotentes,
   * então é seguro deixar a entrada disponível para as duas chamadas — quem efetivamente limpa o
   * cache é só o setTimeout de 30s lá embaixo (em client.on("message_ack")).
   */
  processarAckPendente(messageId: string) {
    const ack = this.acksPendentes.get(whatsappMessageStableKey(messageId));
    if (ack === undefined) return;

    const log = updateLogAckByMessageId(messageId, ack);
    const pending = updatePendingReplyAckByMessageId(messageId, ack);

    if (log) emitEvent("send:ack-update", log);
    if (pending) emitEvent("pendingReply:ack-update", pending);
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
        // Um timeout real do canal CDP não melhora repetindo a operação no mesmo browser.
        if (isWhatsappBrowserStalledError(err)) throw err;
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

    try {
      const result = await this.comRetryTransitorio(() => comTempoLimiteDeOperacao(
        client.getNumberId(target),
        TEMPO_LIMITE_RESOLVER_CONTATO_MS,
        "consultar o número no WhatsApp",
      ));
      return result ? result._serialized : null;
    } catch (err) {
      if (isWhatsappBrowserStalledError(err)) return this.tratarTravamentoDeOperacao(err, false, client);
      throw err;
    }
  }

  /** Envio sensível exige ACK real, sem reutilizar a captura permissiva de IDs do fluxo legado. */
  async sendMessageConfirmed(
    chatId: string,
    mensagem: string,
  ): Promise<ConfirmedWhatsappSend> {
    if (!this.client || this.status !== "conectado")
      throw new Error("WhatsApp não está conectado.");
    const client = this.client;
    let aliases: string[] = [];
    let aliasTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const contatos = await Promise.race([
        client.getContactLidAndPhone([chatId]),
        new Promise<never>((_resolve, reject) => {
          aliasTimer = setTimeout(
            () => reject(new Error("Timeout PN/LID")),
            5000,
          );
        }),
      ]);
      aliases = contatos
        .flatMap((contato) => [contato.lid, contato.pn])
        .filter(Boolean);
    } catch (err) {
      if (isWhatsappBrowserStalledError(err))
        return this.tratarTravamentoDeOperacao(err, false, client);
      // ACK pelo ID direto continua funcionando mesmo sem o mapeamento PN/LID.
      console.warn(
        "[WhatsApp] Não foi possível consultar aliases PN/LID da cobrança.",
      );
    } finally {
      clearTimeout(aliasTimer);
    }
    if (this.client !== client || this.status !== "conectado")
      throw new Error(
        "A conexão do WhatsApp mudou. Aguarde reconectar e tente novamente.",
      );
    console.log(
      `[WhatsApp] Enviando mensagem com confirmação para ${chatId}...`,
    );
    try {
      const resultado = await sendConfirmedWhatsappMessage(
        client,
        chatId,
        mensagem,
        aliases,
      );
      console.log(
        `[WhatsApp] Mensagem confirmada: ID=${resultado.messageId}, ACK=${resultado.ack}`,
      );
      return resultado;
    } catch (err) {
      if (isWhatsappBrowserStalledError(err))
        return this.tratarTravamentoDeOperacao(err, true, client);
      throw err;
    }
  }

  /**
   * Envia a mensagem e retorna o id do WhatsApp, usado depois para rastrear entrega/leitura.
   * O whatsapp-web.js às vezes devolve undefined mesmo quando a mensagem foi enviada com
   * sucesso (limitação conhecida da lib — não consegue montar o objeto de retorno a tempo).
   * Nesse caso não falhamos o envio: tentamos capturar o id por "message_create" (que chega por
   * um caminho independente) antes de desistir e seguir sem id de rastreamento.
   */
  async sendMessage(chatId: string, mensagem: string): Promise<string | null> {
    if (!this.client || this.status !== "conectado") {
      throw new Error("WhatsApp não está conectado.");
    }
    const client = this.client;

    // Registramos a intenção de capturar o ID via message_create ANTES de enviar.
    const promessaIdFallback = this.aguardarIdViaMessageCreate(
      chatId,
      mensagem,
    );

    try {
      console.log(`[WhatsApp] Enviando mensagem para ${chatId}...`);
      // Nunca repetimos automaticamente um sendMessage que terminou em timeout: o WhatsApp
      // pode ter aceitado a mensagem antes de o retorno do Chromium travar, causando duplicata.
      const sent = await comTempoLimiteDeOperacao(
        client.sendMessage(chatId, mensagem),
        TEMPO_LIMITE_ENVIAR_MENSAGEM_MS,
        "enviar a mensagem",
      );

      // Pequena pausa para o WhatsApp Web processar o ID interno
      await new Promise((r) => setTimeout(r, 500));

      // Prioridade 1: ID retornado diretamente pelo sendMessage. Aceita tanto o formato
      // completo quanto o stanza ID reduzido, pois ambos aparecem em versões reais da lib.
      const directId = whatsappMessageIdCandidates(sent?.id)[0];
      if (directId) {
        // O WhatsApp pode devolver o ACK final no próprio sendMessage sem emitir um evento
        // posterior. Preservamos esse dado até os registros serem criados no banco.
        if (Number.isInteger(sent?.ack) && sent.ack >= 2 && sent.ack <= 4) {
          const key = whatsappMessageStableKey(directId);
          const anterior = this.acksPendentes.get(key);
          if (anterior === undefined || sent.ack > anterior) this.acksPendentes.set(key, sent.ack);
          setTimeout(() => this.acksPendentes.delete(key), 30000).unref();
        }
        console.log(`[WhatsApp] ID retornado no envio direto: ${directId}`);
        this.removerEnvioAguardando(chatId, mensagem);
        return directId;
      }

      // Prioridade 2: Fallback via message_create (evento disparado pela lib)
      const idFallback = await promessaIdFallback;
      if (idFallback) {
        console.log(
          `[WhatsApp] ID obtido via fallback de evento: ${idFallback}`,
        );
        return idFallback;
      }

      // Prioridade 3: Verificação via Propriedade lastMessage (Mais fiável que fetchMessages)
      try {
        const chat = await client.getChatById(chatId);
        if (chat.lastMessage && chat.lastMessage.fromMe) {
          const bodyStart = chat.lastMessage.body.slice(0, 20);
          if (mensagem.includes(bodyStart)) {
            const lastMessageId = whatsappMessageIdCandidates(
              chat.lastMessage.id,
            )[0];
            if (lastMessageId) {
              console.log(
                `[WhatsApp] ID capturado via lastMessage: ${lastMessageId}`,
              );
              return lastMessageId;
            }
          }
        }
      } catch (e) {
        console.warn(
          `[WhatsApp] Falha ao verificar lastMessage para ${chatId}`,
        );
      }

      // Prioridade 4: Busca Persistente (Polling Fetch-back)
      try {
        console.log(`[WhatsApp] Iniciando busca persistente para ${chatId}...`);
        for (let i = 0; i < 4; i++) {
          await new Promise((resolve) => setTimeout(resolve, 2000));
          const chat = await client.getChatById(chatId);
          const messages = await chat.fetchMessages({ limit: 5 });
          const lastSent = messages
            .reverse()
            .find((m) => m.fromMe && mensagem.includes(m.body.slice(0, 20)));

          const fetchedId = lastSent
            ? whatsappMessageIdCandidates(lastSent.id)[0]
            : null;
          if (fetchedId) {
            console.log(
              `[WhatsApp] ID capturado na busca persistente (T${i + 1}): ${fetchedId}`,
            );
            return fetchedId;
          }
        }
      } catch (fetchErr) {
        console.error(
          `[WhatsApp] Erro na busca persistente para ${chatId}:`,
          fetchErr,
        );
      }

      console.error(
        `[WhatsApp] FALHA TOTAL ao capturar ID para ${chatId}. Status permanecerá como "Enviado".`,
      );
      return null;
    } catch (err) {
      this.removerEnvioAguardando(chatId, mensagem);
      if (isWhatsappBrowserStalledError(err))
        return this.tratarTravamentoDeOperacao(err, true, client);
      throw err;
    }
  }

  private removerEnvioAguardando(chatId: string, texto: string) {
    // Match por dígitos para ser consistente com o listener
    const digits = chatId.split("@")[0];
    const idx = this.enviosAguardandoId.findIndex((e) => e.chatId.split("@")[0] === digits);
    if (idx !== -1) {
      this.enviosAguardandoId.splice(idx, 1);
    }
  }

  private aguardarIdViaMessageCreate(chatId: string, texto: string, timeoutMs = 8000): Promise<string | null> {
    return new Promise((resolve) => {
      const aguardando: EnvioAguardandoId = {
        chatId,
        texto,
        resolve: (id) => {
          clearTimeout(timer);
          resolve(id);
        },
      };
      const timer = setTimeout(() => {
        const idx = this.enviosAguardandoId.indexOf(aguardando);
        if (idx !== -1) this.enviosAguardandoId.splice(idx, 1);
        resolve(null);
      }, timeoutMs);
      this.enviosAguardandoId.push(aguardando);
    });
  }

  /**
   * Reconcilia os ACKs e verifica, para cada pendente ainda "aguardando", se o cliente respondeu
   * enquanto a sessão estava fora do ar. Reações perdidas não podem ser recuperadas pela lib.
   */
  private async reconciliarPendentesAoReconectar(): Promise<void> {
    const client = this.client;
    if (!client) return;
    return this.tarefasWhatsapp.run(client, "conferencia-respostas", () => this.reconciliarPendentesSemSobreposicao(client));
  }

  private async reconciliarPendentesSemSobreposicao(client: Client): Promise<void> {

    let cursor = 0;
    while (this.client === client && this.status === "conectado") {
      const pendentes = listAwaitingRepliesPage(cursor, 50);
      if (!pendentes.length) break;
      for (const pendente of pendentes) {
        if (this.client !== client || this.status !== "conectado") return;
        try { await this.verificarMensagemPerdida(client, pendente); }
        catch (err) { console.error(`Erro ao verificar mensagens perdidas do pendente ${pendente.id}:`, err); }
        cursor = pendente.id;
      }
    }
  }

  private async verificarMensagemPerdida(
    client: Client,
    pendente: PendingReply,
  ): Promise<void> {
    // created_at do SQLite vem como "YYYY-MM-DD HH:MM:SS" em UTC, sem indicação de fuso —
    // sem o "Z", o Date trataria como horário local e compararia timestamps errado.
    const criadoEmMs = new Date(
      `${pendente.created_at.replace(" ", "T")}Z`,
    ).getTime();
    const chatIds = new Set<string>();
    if (pendente.whatsapp_chat_id) chatIds.add(pendente.whatsapp_chat_id);

    // Resolve novamente o telefone porque o WhatsApp pode ter migrado a conversa de @c.us para
    // @lid depois do envio original. Mantemos os dois candidatos para recuperar a resposta em
    // instalações que atravessaram essa migração.
    const numberId = await this.comRetryTransitorio(() =>
      client.getNumberId(pendente.telefone_digits),
    ).catch(() => null);
    if (numberId) chatIds.add(numberId._serialized);

    for (const chatId of chatIds) {
      try {
        const chat = await client.getChatById(chatId);
        const mensagens = await chat.fetchMessages({ limit: 50 });

        // Recupera confirmações perdidas durante reinícios/desconexões. A comparação usa o
        // stanza ID estável, funcionando com o ID completo ou reduzido salvo no banco.
        if (pendente.whatsapp_message_id) {
          const pendingKey = whatsappMessageStableKey(
            pendente.whatsapp_message_id,
          );
          const enviada = mensagens.find(
            (m) =>
              m.fromMe &&
              whatsappMessageIdCandidates(m.id).some(
                (candidate) =>
                  whatsappMessageStableKey(candidate) === pendingKey,
              ),
          );
          const recoveredAck = Number(enviada?.ack);
          if (
            Number.isInteger(recoveredAck) &&
            recoveredAck >= -1 &&
            recoveredAck <= 4
          ) {
            const log = updateLogAckByMessageId(
              pendente.whatsapp_message_id,
              recoveredAck,
            );
            const updatedPending = updatePendingReplyAckByMessageId(
              pendente.whatsapp_message_id,
              recoveredAck,
            );
            if (log) emitEvent("send:ack-update", log);
            if (updatedPending)
              emitEvent("pendingReply:ack-update", updatedPending);
          }
        }

        const resposta = mensagens.find(
          (m) => !m.fromMe && m.timestamp * 1000 >= criadoEmMs,
        );
        if (!resposta) continue;

        await this.finalizarPendingReply(
          pendente,
          "mensagem",
          resposta.body ? resposta.body.slice(0, 300) : null,
        );
        return;
      } catch {
        // Um dos aliases pode não existir mais; tentamos o próximo antes de desistir.
      }
    }
  }

  /**
   * Prioriza o vínculo inequívoco com a mensagem citada. Se a resposta não for uma citação,
   * tenta o chat completo, os dígitos e por fim os aliases retornados pelo contato do WhatsApp.
   * Esta última etapa cobre conversas que chegam como @lid embora tenham sido abertas como @c.us.
   */
  private processarMensagemRecebida(client: Client, message: Message): Promise<void> {
    if (this.client !== client) return Promise.resolve();
    // Sem acompanhamentos aguardando, não consulta contatos nem históricos do navegador.
    if (!listAwaitingRepliesPage(0, 1).length) return Promise.resolve();
    const messageId = whatsappMessageIdCandidates(message.id)[0];
    if (!messageId) return this.resolvePendingReplyForMessage(message);
    const key = "mensagem:" + message.from + ":" + whatsappMessageStableKey(messageId);
    return this.tarefasWhatsapp.run(client, key, async () => {
      if (this.client !== client) return;
      await this.resolvePendingReplyForMessage(message);
    }, 5000);
  }

  private async resolvePendingReplyForMessage(message: Message): Promise<void> {
    let pending: PendingReply | undefined;

    if (message.hasQuotedMsg) {
      try {
        const citada = await message.getQuotedMessage();
        pending = findAwaitingByWhatsappMessageId(citada.id._serialized);
      } catch {
        // A mensagem citada pode já ter saído do cache local; seguimos com os demais critérios.
      }
    }

    pending ??= this.findPendingReplyByChatId(message.from);

    if (!pending) {
      try {
        const contato = await message.getContact();
        pending = this.findPendingReplyByChatId(contato.id._serialized)
          ?? this.findPendingReplyByChatId(contato.number);
      } catch {
        // Nem toda mensagem permite carregar o contato; o evento continua sendo ignorado sem erro.
      }
    }

    // Após migração para @lid, nem o chat nem o contato necessariamente expõem o telefone.
    // O ID da mensagem enviada dentro desta conversa fornece um vínculo inequívoco.
    if (!pending) {
      try {
        const chat = await message.getChat();
        const recentes = await chat.fetchMessages({ limit: 40 });
        const correspondentes = recentes.filter((item) => item.fromMe)
          .map((item) => findAwaitingByWhatsappMessageId(item.id._serialized))
          .filter((item): item is PendingReply => Boolean(item && message.timestamp * 1000 >= new Date(`${item.created_at.replace(" ", "T")}Z`).getTime()))
          .sort((a, b) => b.id - a.id);
        pending = correspondentes[0];
      } catch (error) {
        console.warn("[WhatsApp] Não foi possível comparar a conversa com a mensagem enviada:", error);
      }
    }

    if (!pending) return;
    await this.finalizarPendingReply(pending, "mensagem", message.body ? message.body.slice(0, 300) : null);
  }

  private async resolvePendingReplyForReaction(reaction: Reaction): Promise<void> {
    const pending = findAwaitingByWhatsappMessageId(reaction.msgId._serialized)
      ?? this.findPendingReplyByChatId(reaction.senderId);
    if (!pending) return;
    await this.finalizarPendingReply(pending, "reacao", reaction.reaction);
  }

  private findPendingReplyByChatId(chatId: string): PendingReply | undefined {
    return findAwaitingByChatIdentifier(chatId);
  }

  private async finalizarPendingReply(
    pending: PendingReply,
    tipo: TipoResposta,
    preview: string | null,
  ): Promise<void> {
    const resolved = resolvePendingReplyIfAwaiting(pending.id, tipo, preview);
    if (!resolved) return;
    emitEvent("pendingReply:resolved", resolved);

    const trelloKey = getSetting("trello_key");
    const trelloToken = getSetting("trello_token");
    const confirmListId = getSetting("trello_confirm_list_id");
    if (trelloKey && trelloToken && confirmListId) {
      try {
        await moveCard(trelloKey, trelloToken, pending.card_id, confirmListId);
      } catch (err) {
        console.error(
          `Erro ao mover cartão ${pending.card_id} no Trello após resposta do cliente:`,
          err,
        );
      }
    }
  }
}

export const whatsappManager = new WhatsappManager();


