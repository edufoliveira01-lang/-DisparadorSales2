import fs from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import { Client, LocalAuth, type Message, type Reaction } from "whatsapp-web.js";
import { dataDir } from "../db";
import { emitEvent } from "../websocket";
import { normalizePhone } from "../utils/phone";
import { getSetting } from "./settingsService";
import { moveCard } from "./trelloService";
import { updateLogAckByMessageId } from "./logsService";
import {
  findAwaitingByPhoneDigits,
  listPendingReplies,
  resolvePendingReply,
  updatePendingReplyAckByMessageId,
  type PendingReply,
  type TipoResposta,
} from "./pendingRepliesService";

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

const WA_VERSION_REPO_API = "https://api.github.com/repos/wppconnect-team/wa-version/contents/html";
const WA_VERSION_RAW_BASE = "https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html";
/** Nº de versões a pular a partir da mais antiga ainda disponível, como margem de segurança
 * contra o repositório podar exatamente a que escolhemos entre a hora que listamos e a hora
 * que de fato conectamos. */
const WA_VERSION_MARGEM_SEGURANCA = 5;
/** Quanto tempo reaproveitar a mesma versão resolvida antes de consultar de novo. Sem isso, toda
 * tentativa de conexão (inclusive os retries automáticos de iniciarTentativa, até
 * MAX_TENTATIVAS_CONEXAO vezes) batia na API do GitHub — depois de algumas reconexões seguidas
 * isso já é suficiente pra esbarrar no limite de requisições sem autenticação do GitHub (60/hora
 * por IP), fazendo a consulta falhar e cair de volta em "none" (build mais recente), que é
 * exatamente o bug que estamos evitando. */
const WA_VERSION_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

type WaVersionCache = { type: "remote"; remotePath: string; strict: false } | { type: "none" };
let waVersionCacheResolvida: { valor: WaVersionCache; resolvidaEm: number } | null = null;

/**
 * Resolve dinamicamente qual versão fixar no webVersionCache (ver comentário maior em
 * iniciarTentativa). Fixar um arquivo específico por nome (como fizemos antes) quebra de novo
 * assim que o wa-version poda esse arquivo do repositório — o repositório só mantém uma janela
 * rolante de versões recentes, então qualquer nome fixo tem vida curta. Em vez disso, consultamos
 * a listagem atual e escolhemos a mais antiga ainda disponível (com uma pequena margem), o que se
 * auto-corrige à medida que a janela avança — mas só a cada WA_VERSION_CACHE_TTL_MS, e se a
 * consulta nova falhar (rede, rate limit) preferimos reaproveitar a última resolução boa que
 * tivermos a cair em "none", que reintroduziria o bug do id._serialized undefined.
 */
async function resolveWaVersionCache(): Promise<WaVersionCache> {
  if (waVersionCacheResolvida && Date.now() - waVersionCacheResolvida.resolvidaEm < WA_VERSION_CACHE_TTL_MS) {
    return waVersionCacheResolvida.valor;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const res = await fetch(WA_VERSION_REPO_API, {
      signal: controller.signal,
      headers: { "User-Agent": "disparazap", Accept: "application/vnd.github+json" },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const arquivos = (await res.json()) as { name: string }[];
    const versoes = arquivos.map((a) => a.name).filter((nome) => nome.endsWith(".html")).sort();
    if (versoes.length === 0) throw new Error("Nenhuma versão listada");

    const escolhida = versoes[Math.min(WA_VERSION_MARGEM_SEGURANCA, versoes.length - 1)];
    const resultado: WaVersionCache = { type: "remote", remotePath: `${WA_VERSION_RAW_BASE}/${escolhida}`, strict: false };
    waVersionCacheResolvida = { valor: resultado, resolvidaEm: Date.now() };
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
  }
}

// "Execution context was destroyed" / "Protocol error" são falhas conhecidas e
// intermitentes do whatsapp-web.js (bug de terceiros, ainda sem correção definitiva
// upstream) que costumam acontecer durante o carregamento inicial do WhatsApp Web,
// antes mesmo do QR Code aparecer. Na prática, tentar de novo quase sempre resolve —
// então fazemos isso automaticamente em vez de exigir que o usuário clique de novo.
const ERRO_TRANSITORIO = /execution context was destroyed|protocol error/i;

// Retry de operações pontuais já em conexão estabelecida (ex: enviar mensagem que esbarrou
// num "Protocol error" pontual) — precisa ser rápido, o usuário está esperando a ação terminar.
const MAX_TENTATIVAS_AUTOMATICAS = 3;
const INTERVALO_ENTRE_TENTATIVAS_MS = 3000;

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

/**
 * Tempo máximo aguardando o WhatsApp ficar pronto depois de "autenticado" (celular escaneou
 * o QR, mas o whatsapp-web.js às vezes trava nessa fase sem nunca emitir "ready" nem
 * "disconnected" — especialmente em celulares/conexões mais lentas). Sem esse limite, a tela
 * fica presa em "Autenticando…" para sempre, sem nenhuma tentativa automática de recuperação.
 */
const TEMPO_LIMITE_APOS_AUTENTICAR_MS = 3 * 60 * 1000;

type Listener = () => void;

interface EnvioAguardandoId {
  chatId: string;
  texto: string;
  resolve: (id: string) => void;
}

class WhatsappManager {
  private client: Client | null = null;
  private status: WhatsappStatus = "desconectado";
  private qrDataUrl: string | null = null;
  private lastError: string | null = null;
  private tentativa = 0;
  /** Incrementado a cada connect()/disconnect()/shutdown() para invalidar retries pendentes de uma tentativa anterior. */
  private geracao = 0;
  private listeners = new Set<Listener>();
  /** Envios recentes aguardando o id real via "message_create" (fallback do sendMessage). */
  private enviosAguardandoId: EnvioAguardandoId[] = [];
  /** Acks que chegaram antes do log ser persistido no banco (race condition). */
  private acksPendentes = new Map<string, number>();

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

  private async iniciarTentativa(minhaGeracao: number): Promise<void> {
    if (minhaGeracao !== this.geracao) return; // uma chamada mais recente (connect/disconnect) já assumiu

    clearStaleChromiumLocks();
    this.setState({ status: "inicializando", lastError: null, qrDataUrl: null });

    // Configuração idêntica à usada no projeto anterior (que já validamos funcionando):
    // headless, apenas os dois args de sandbox, e os mesmos timeouts. Evitamos adicionar
    // flags extras do Chromium sem validação prévia em ambiente real.
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
    // escolhemos a mais antiga ainda disponível (com margem de segurança), então continuamos
    // conservadores mesmo com a janela do repositório avançando. Se a consulta falhar por
    // qualquer motivo, caímos no comportamento anterior (mais recente) em vez de travar.
    const webVersionCache = await resolveWaVersionCache();
    if (minhaGeracao !== this.geracao) return; // connect()/disconnect() aconteceu enquanto resolvíamos a versão

    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: AUTH_DATA_PATH }),
      puppeteer: {
        headless: true,
        // As três flags abaixo evitam que o Chromium aplique power-saving throttling à aba
        // headless (tratada como "em segundo plano"). Sem elas, o app interno do WhatsApp Web
        // pode atrasar/descartar o processamento de eventos vindos do WebSocket — inclusive os
        // que disparam message_ack/message_create — mesmo com a conexão íntegra.
        args: [
          "--no-sandbox",
          "--disable-setuid-sandbox",
          "--disable-backgrounding-occluded-windows",
          "--disable-renderer-backgrounding",
          "--disable-background-timer-throttling",
        ],
        protocolTimeout: 120000,
      },
      webVersionCache,
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
      // do estado do socket logo após o QR ser escaneado, antes do evento "ready") — a lib trata
      // QUALQUER estado fora de [CONNECTED, OPENING, PAIRING, TIMEOUT] como desconexão fatal e
      // já derruba o browser sozinha, sem nenhuma tolerância a oscilações passageiras (ver
      // Client.js, onAppStateChangedEvent). Não tem como configurar isso na lib. Se ainda não
      // tínhamos chegado a "conectado" nesta tentativa, tratamos como falha transitória e
      // tentamos de novo automaticamente (com um QR novo) — só paramos sem retry quando a
      // desconexão acontece DEPOIS de já estar conectado (ex: logout pelo celular), que é uma
      // desconexão real.
      const statusAntesDaFalha = this.status;
      const aindaNaoConectouNestaTentativa = statusAntesDaFalha !== "conectado";
      const falhaLogoAposEscanear = statusAntesDaFalha === "autenticado";

      try {
        await client.destroy();
      } catch {
        // best-effort — já estamos tratando uma falha
      }
      if (this.client !== client) return; // uma tentativa mais nova já assumiu
      this.client = null;

      const deveTentarNovamente =
        minhaGeracao === this.geracao &&
        this.tentativa < MAX_TENTATIVAS_CONEXAO &&
        (ERRO_TRANSITORIO.test(message) || aindaNaoConectouNestaTentativa);

      if (deveTentarNovamente) {
        this.tentativa++;
        this.setState({
          status: "inicializando",
          lastError: falhaLogoAposEscanear
            ? `O WhatsApp desconectou logo após o escaneamento (${this.tentativa}/${MAX_TENTATIVAS_CONEXAO}) — gerando um novo QR Code automaticamente. Às vezes é preciso escanear mais de uma vez, é uma instabilidade conhecida e não indica erro no cadastro.`
            : `Falha temporária ao conectar (${message}), tentando novamente (${this.tentativa}/${MAX_TENTATIVAS_CONEXAO})…`,
          qrDataUrl: null,
        });
        setTimeout(() => this.iniciarTentativa(minhaGeracao), INTERVALO_ENTRE_TENTATIVAS_CONEXAO_MS);
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
      failAndCleanUp("falha", String(msg));
    });

    client.on("disconnected", (reason) => {
      failAndCleanUp("desconectado", String(reason));
    });

    // "message" só dispara para mensagens recebidas (não inclui as que o próprio bot envia).
    // Chega uma mensagem de QUALQUER conversa; o filtro por "está esperando resposta desse
    // telefone" acontece dentro de resolvePendingReplyForPhone.
    client.on("message", (message: Message) => {
      if (message.fromMe || message.from.endsWith("@g.us")) return;
      this.resolvePendingReplyForPhone(message.from, "mensagem", message.body ? message.body.slice(0, 300) : null).catch(
        (err) => console.error("Erro ao processar mensagem recebida:", err)
      );
    });

    // Só considera reações feitas em mensagens que NÓS enviamos (msgId.fromMe) — reações em
    // mensagens de terceiros na mesma conversa são ignoradas. reaction.reaction vem vazia
    // quando o cliente remove a reação, então também ignoramos esse caso.
    client.on("message_reaction", (reaction: Reaction) => {
      if (!reaction.msgId.fromMe || !reaction.reaction) return;
      this.resolvePendingReplyForPhone(reaction.senderId, "reacao", reaction.reaction).catch((err) =>
        console.error("Erro ao processar reação recebida:", err)
      );
    });

    // "message_create" dispara para toda mensagem criada, incluindo as que nós mesmos enviamos
    // (fromMe) — ao contrário do retorno de client.sendMessage(), que às vezes vem vazio mesmo
    // com o envio ok, esse evento chega por um caminho totalmente separado (o listener da
    // própria página do WhatsApp Web), então é o fallback usado para capturar o id real da
    // mensagem quando o retorno direto falha (ver sendMessage()/aguardarIdViaMessageCreate()).
      client.on("message_create", (message: Message) => {
      if (!message.fromMe) return;
      
      const toDigits = message.to.split("@")[0];
      console.log(`[WhatsApp] message_create detectado (fromMe) para: ${toDigits}`);

      // Match por dígitos para evitar problemas com @c.us vs @s.whatsapp.net
      const idx = this.enviosAguardandoId.findIndex((e) => e.chatId.split("@")[0] === toDigits);
      if (idx === -1) return;
      
      const [aguardando] = this.enviosAguardandoId.splice(idx, 1);
      console.log(`[WhatsApp] ID capturado via fallback para ${toDigits}: ${message.id._serialized}`);
      aguardando.resolve(message.id._serialized);
    });

    // "message_ack" dispara a cada mudança no status de confirmação de uma mensagem NOSSA
    // (✓ enviado ao servidor, ✓✓ cinza entregue no aparelho, ✓✓ azul lido). Associamos pelo id
    // da mensagem do WhatsApp, salvo tanto em send_logs quanto em pending_replies (quando há
    // monitoramento de resposta ativo) no momento do envio, em dispatchService.
    client.on("message_ack", (message: Message, ack: number) => {
      try {
        const messageId = message.id._serialized;
        console.log(`[WhatsApp] Evento message_ack recebido: ID=${messageId}, ACK=${ack}`);
        
        const log = updateLogAckByMessageId(messageId, ack);
        const pending = updatePendingReplyAckByMessageId(messageId, ack);

        if (log) {
          console.log(`[WhatsApp] Status do Log atualizado: ${messageId}`);
          emitEvent("send:ack-update", log);
        }
        if (pending) {
          console.log(`[WhatsApp] Status do Pendente atualizado: ${messageId}`);
          emitEvent("pendingReply:ack-update", pending);
        }

        // Se não encontrou nem log nem pendente, pode ser que o registro ainda não tenha sido
        // salvo no banco (race condition). Guardamos o ack para tentar aplicar logo em seguida.
        if (!log && !pending) {
          console.log(`[WhatsApp] ACK órfão detectado (race condition), guardando: ${messageId}`);
          this.acksPendentes.set(messageId, ack);
          // Limpa do cache após 30 segundos para não vazar memória
          setTimeout(() => this.acksPendentes.delete(messageId), 30000);
        }
      } catch (err) {
        console.error("Erro ao processar confirmação de entrega/leitura:", err);
      }
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
   * Tenta aplicar um ack que chegou antes do registro existir no banco.
   * Chamado por logsService/pendingRepliesService logo após o INSERT.
   */
  processarAckPendente(messageId: string) {
    const ack = this.acksPendentes.get(messageId);
    if (ack === undefined) return;

    const log = updateLogAckByMessageId(messageId, ack);
    const pending = updatePendingReplyAckByMessageId(messageId, ack);

    if (log) {
      emitEvent("send:ack-update", log);
      this.acksPendentes.delete(messageId);
    }
    if (pending) {
      emitEvent("pendingReply:ack-update", pending);
      this.acksPendentes.delete(messageId);
    }
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
    const promessaIdFallback = this.aguardarIdViaMessageCreate(chatId, mensagem);

    try {
      console.log(`[WhatsApp] Enviando mensagem para ${chatId}...`);
      const sent = await this.comRetryTransitorio(() => client.sendMessage(chatId, mensagem));
      
      // Pequena pausa para o WhatsApp Web processar o ID interno
      await new Promise(r => setTimeout(r, 500));

      // Prioridade 1: ID retornado diretamente pelo sendMessage
      if (sent?.id?._serialized) {
        console.log(`[WhatsApp] ID retornado no envio direto: ${sent.id._serialized}`);
        this.removerEnvioAguardando(chatId, mensagem);
        return sent.id._serialized;
      }
      
      // Prioridade 2: Fallback via message_create (evento disparado pela lib)
      const idFallback = await promessaIdFallback;
      if (idFallback) {
        console.log(`[WhatsApp] ID obtido via fallback de evento: ${idFallback}`);
        return idFallback;
      }

      // Prioridade 3: Verificação via Propriedade lastMessage (Mais fiável que fetchMessages)
      try {
        const chat = await client.getChatById(chatId);
        if (chat.lastMessage && chat.lastMessage.fromMe) {
          const bodyStart = chat.lastMessage.body.slice(0, 20);
          if (mensagem.includes(bodyStart)) {
            console.log(`[WhatsApp] ID capturado via lastMessage: ${chat.lastMessage.id._serialized}`);
            return chat.lastMessage.id._serialized;
          }
        }
      } catch (e) {
        console.warn(`[WhatsApp] Falha ao verificar lastMessage para ${chatId}`);
      }

      // Prioridade 4: Busca Persistente (Polling Fetch-back)
      try {
        console.log(`[WhatsApp] Iniciando busca persistente para ${chatId}...`);
        for (let i = 0; i < 4; i++) {
          await new Promise(resolve => setTimeout(resolve, 2000));
          const chat = await client.getChatById(chatId);
          const messages = await chat.fetchMessages({ limit: 5 });
          const lastSent = messages.reverse().find(m => m.fromMe && mensagem.includes(m.body.slice(0, 20)));
          
          if (lastSent && lastSent.id?._serialized) {
            console.log(`[WhatsApp] ID capturado na busca persistente (T${i+1}): ${lastSent.id._serialized}`);
            return lastSent.id._serialized;
          }
        }
      } catch (fetchErr) {
        console.error(`[WhatsApp] Erro na busca persistente para ${chatId}:`, fetchErr);
      }

      console.error(`[WhatsApp] FALHA TOTAL ao capturar ID para ${chatId}. Status ficará como "—".`);
      return null;
    } catch (err) {
      this.removerEnvioAguardando(chatId, mensagem);
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
   * Verifica, para cada pendente ainda "aguardando", se o cliente já respondeu por texto
   * enquanto a sessão estava fora do ar. Reações perdidas durante a desconexão não têm como
   * ser recuperadas por aqui (a lib não expõe reações antigas por mensagem de forma prática) —
   * ficam para o usuário resolver manualmente na tela de Pendentes de Resposta.
   */
  private async reconciliarPendentesAoReconectar(): Promise<void> {
    const client = this.client;
    if (!client) return;

    const pendentes = listPendingReplies().filter((p) => p.status === "aguardando");
    for (const pendente of pendentes) {
      try {
        await this.verificarMensagemPerdida(client, pendente);
      } catch (err) {
        console.error(`Erro ao verificar mensagens perdidas do pendente ${pendente.id}:`, err);
      }
    }
  }

  private async verificarMensagemPerdida(client: Client, pendente: PendingReply): Promise<void> {
    const numberId = await this.comRetryTransitorio(() => client.getNumberId(pendente.telefone_digits));
    if (!numberId) return;

    const chat = await client.getChatById(numberId._serialized);
    const mensagens = await chat.fetchMessages({ limit: 50, fromMe: false });

    // created_at do SQLite vem como "YYYY-MM-DD HH:MM:SS" em UTC, sem indicação de fuso —
    // sem o "Z", o Date trataria como horário local e compararia timestamps errado.
    const criadoEmMs = new Date(`${pendente.created_at.replace(" ", "T")}Z`).getTime();
    const resposta = mensagens.find((m) => m.timestamp * 1000 >= criadoEmMs);
    if (!resposta) return;

    await this.resolvePendingReplyForPhone(numberId._serialized, "mensagem", resposta.body ? resposta.body.slice(0, 300) : null);
  }

  /**
   * Casa o remetente de uma mensagem/reação recebida com um pendente "aguardando" pelo mesmo
   * telefone (criado em dispatchService ao enviar, quando há lista de confirmação configurada).
   * Sem pendente para esse telefone, a mensagem é apenas ignorada — não há nada para mover.
   */
  private async resolvePendingReplyForPhone(chatId: string, tipo: TipoResposta, preview: string | null): Promise<void> {
    const telefoneDigits = normalizePhone(chatId.split("@")[0]);
    const pending = findAwaitingByPhoneDigits(telefoneDigits);
    if (!pending) return;

    const resolved = resolvePendingReply(pending.id, tipo, preview);
    emitEvent("pendingReply:resolved", resolved);

    const trelloKey = getSetting("trello_key");
    const trelloToken = getSetting("trello_token");
    const confirmListId = getSetting("trello_confirm_list_id");
    if (trelloKey && trelloToken && confirmListId) {
      try {
        await moveCard(trelloKey, trelloToken, pending.card_id, confirmListId);
      } catch (err) {
        console.error(`Erro ao mover cartão ${pending.card_id} no Trello após resposta do cliente:`, err);
      }
    }
  }
}

export const whatsappManager = new WhatsappManager();
