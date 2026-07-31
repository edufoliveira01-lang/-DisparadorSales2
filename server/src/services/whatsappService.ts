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
      
      // Procuramos o envio pendente mais antigo para este destinatário.
      // Removemos a comparação exata de texto (message.body) porque o WhatsApp pode
      // alterar a formatação (ex: links, emojis, espaços) invalidando o match.
      const idx = this.enviosAguardandoId.findIndex((e) => e.chatId === message.to);
      if (idx === -1) return;
      
      const [aguardando] = this.enviosAguardandoId.splice(idx, 1);
      console.log(`[WhatsApp] ID capturado via fallback para ${message.to}: ${message.id._serialized}`);
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
      const sent = await this.comRetryTransitorio(() => client.sendMessage(chatId, mensagem));
      
      // Prioridade 1: ID retornado diretamente pelo sendMessage
      if (sent?.id?._serialized) {
        this.removerEnvioAguardando(chatId, mensagem);
        return sent.id._serialized;
      }
      
      // Prioridade 2: Fallback via message_create (evento disparado pela lib)
      const idFallback = await promessaIdFallback;
      if (idFallback) return idFallback;

      // Prioridade 3: Verificação Ativa (Fetch-back)
      // Envolvido em try-catch para que qualquer erro aqui não falhe o envio da mensagem.
      try {
        console.log(`[WhatsApp] Tentando verificação ativa para ${chatId}...`);
        await new Promise(resolve => setTimeout(resolve, 2000)); // Aguarda o WhatsApp processar
        
        const chat = await client.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: 5 });
        
        // Procuramos a mensagem mais recente enviada por nós
        const lastSent = messages.reverse().find(m => m.fromMe);
        
        if (lastSent && lastSent.id?._serialized) {
          console.log(`[WhatsApp] ID capturado via verificação ativa: ${lastSent.id._serialized}`);
          return lastSent.id._serialized;
        }
      } catch (fetchErr) {
        console.error(`[WhatsApp] Erro na verificação ativa para ${chatId}:`, fetchErr);
      }

      return null;
    } catch (err) {
      this.removerEnvioAguardando(chatId, mensagem);
      throw err;
    }
  }

  private removerEnvioAguardando(chatId: string, texto: string) {
    // Removemos o match mais antigo para este chat e texto para manter a fila limpa
    const idx = this.enviosAguardandoId.findIndex((e) => e.chatId === chatId && e.texto === texto);
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
