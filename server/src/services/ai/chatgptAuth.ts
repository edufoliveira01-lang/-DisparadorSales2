import { getSession, getUserById } from "../authService";
import { hasPermission } from "../accessService";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import path from "node:path";
import os from "node:os";
import { ambienteCodex, invalidarConexaoCodex } from "../djen/codexRunner";
import { AiInputError, chatgptLocalLoginAllowed } from "./config";

class AccountClient {
  private child: ChildProcessWithoutNullStreams;
  private serial = 0;
  private closed = false;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
  onNotification?: (method: string, params: any) => void;
  onExit?: () => void;
  constructor() {
    const cli = path.resolve(__dirname, "../../../node_modules/@openai/codex/bin/codex.js");
    this.child = spawn(process.execPath, [cli, "app-server", "--listen", "stdio://", "-c", 'cli_auth_credentials_store="file"', "-c", 'forced_login_method="chatgpt"'], { cwd: os.tmpdir(), env: ambienteCodex(), shell: false, stdio: ["pipe", "pipe", "pipe"] });
    if (!this.child.stdin || !this.child.stdout || !this.child.stderr) {
      this.child.once("error", () => {});
      this.child.kill("SIGTERM");
      throw new AiInputError("O componente de conexão não pôde ser iniciado.");
    }
    this.child.stderr.on("data", () => {}); // Drena sem registrar segredos, códigos ou URLs do fluxo.
    this.child.stdin.on("error", () => this.close());
    const lines = createInterface({ input: this.child.stdout });
    lines.on("line", (line) => {
      if (line.length > 256_000) { this.close(); return; }
      let item: any; try { item = JSON.parse(line); } catch { return; }
      if (typeof item.id === "number") {
        const request = this.pending.get(item.id); if (!request) return;
        clearTimeout(request.timer); this.pending.delete(item.id);
        if (item.error) request.reject(new AiInputError("A conexão da conta ChatGPT não concluiu a operação. Atualize o componente ou tente novamente."));
        else request.resolve(item.result);
      } else if (typeof item.method === "string") this.onNotification?.(item.method, item.params);
    });
    this.child.once("error", () => this.close());
    this.child.once("close", () => { lines.close(); this.close(); this.onExit?.(); });
  }
  async initialize() {
    await this.request("initialize", { clientInfo: { name: "disparazap", title: "DisparaZap", version: "2.51.0" } });
    this.child.stdin.write(JSON.stringify({ method: "initialized" }) + "\n");
  }
  request(method: string, params: object = {}): Promise<any> {
    if (this.closed) return Promise.reject(new AiInputError("A conexão da conta ChatGPT foi encerrada. Tente novamente."));
    const id = ++this.serial;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new AiInputError("A autorização não respondeu a tempo. Tente novamente.")); }, 20_000); timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(JSON.stringify({ id, method, params }) + "\n");
    });
  }
  close() {
    if (this.closed) return; this.closed = true;
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new AiInputError("A conexão da conta ChatGPT foi encerrada.")); }
    this.pending.clear(); this.child.kill("SIGTERM");
    const kill = setTimeout(() => { if (this.child.exitCode === null && this.child.signalCode === null) this.child.kill("SIGKILL"); }, 1500); kill.unref();
  }
}
interface LoginAttempt {
  id: string; owner: number; state: "starting" | "waiting" | "completed" | "failed" | "cancelled";
  expires_at: string; verification_url?: string; user_code?: string; message?: string;
}
let attempt: LoginAttempt | null = null;
let client: AccountClient | null = null;
let loginId: string | null = null;
let maintenance = false;
let expiry: ReturnType<typeof setTimeout> | null = null;
let ownerCheck: ReturnType<typeof setInterval> | null = null;
const cleanup = () => { if (ownerCheck) clearInterval(ownerCheck); ownerCheck = null; if (expiry) clearTimeout(expiry); expiry = null; const old = client; client = null; old?.close(); };
function finish(state: LoginAttempt["state"], message: string) {
  if (attempt) { attempt.state = state; attempt.message = message; delete attempt.user_code; delete attempt.verification_url; }
  cleanup(); invalidarConexaoCodex();
}
export function chatgptLoginBusy() { return maintenance || Boolean(attempt && ["starting", "waiting"].includes(attempt.state)); }
export function chatgptLoginStatus(owner: number) {
  if (!attempt || attempt.owner !== owner) return { state: chatgptLoginBusy() ? "busy" : "idle", message: chatgptLoginBusy() ? "Outra pessoa está conectando a conta desta instalação." : "" };
  const { owner: _owner, ...publicAttempt } = attempt;
  return publicAttempt;
}
export async function startChatgptLogin(owner: number, sessionId: string) {
  const ownerAuthorized = () => {
    const session = sessionId && getSession(sessionId, false);
    const user = session && session.user_id === owner && getUserById(owner);
    return Boolean(user && hasPermission(user, "integrations.manage"));
  };
  if (!ownerAuthorized()) throw new AiInputError("A sessão não está autorizada a conectar a conta da IA.");
  if (!chatgptLocalLoginAllowed()) throw new AiInputError("Login de conta ChatGPT indisponível neste modo hospedado. Configure a integração oficial autorizada ou utilize API.");
  if (chatgptLoginBusy()) throw new AiInputError("Já existe uma autorização em andamento. Conclua ou cancele antes de iniciar outra.");
  attempt = { id: randomUUID(), owner, state: "starting", expires_at: new Date(Date.now() + 5 * 60_000).toISOString() };
  const current = attempt;
  let rpc: AccountClient;
  try { rpc = new AccountClient(); }
  catch { finish("failed", "O componente de conexão não pôde ser iniciado."); throw new AiInputError("O componente de conexão não pôde ser iniciado."); }
  client = rpc; loginId = null;
  expiry = setTimeout(() => { if (attempt === current) finish("failed", "A autorização expirou. Inicie uma nova conexão."); }, 5 * 60_000); expiry.unref();
  ownerCheck = setInterval(() => {
    if (attempt === current && !ownerAuthorized()) finish("failed", "A autorização foi interrompida porque a sessão ou permissão expirou.");
  }, 5000); ownerCheck.unref();
  let early: any;
  const completed = (params: any) => {
    if (attempt !== current || client !== rpc || !loginId || params?.loginId !== loginId) return;
    if (!ownerAuthorized()) {
      // Uma conclusão tardia não deve manter uma conta conectada por uma sessão revogada.
      if (params.success === true) void rpc.request("account/logout").catch(() => {}).finally(() => { if (attempt === current) finish("failed", "A sessão não está mais autorizada a conectar a conta da IA."); });
      else finish("failed", "A sessão não está mais autorizada a conectar a conta da IA.");
      return;
    }
    finish(params.success === true ? "completed" : "failed", params.success === true ? "Conta ChatGPT conectada." : "A autorização não foi concluída. Tente novamente.");
  };
  rpc.onNotification = (method, params) => { if (method === "account/login/completed") { if (!loginId) early = params; else completed(params); } };
  rpc.onExit = () => { if (client === rpc && chatgptLoginBusy()) finish("failed", "A conexão foi encerrada antes de concluir. Tente novamente."); };
  try {
    await rpc.initialize();
    const result = await rpc.request("account/login/start", { type: "chatgptDeviceCode" });
    if (!ownerAuthorized()) throw new AiInputError("A sessão não está mais autorizada a conectar a conta da IA.");
    if (client !== rpc || attempt !== current) throw new AiInputError("A autorização foi cancelada ou expirou.");
    if (typeof result.loginId !== "string" || result.verificationUrl !== "https://auth.openai.com/codex/device" || typeof result.userCode !== "string" || !/^[A-Z0-9-]{4,32}$/.test(result.userCode)) throw new AiInputError("A autorização não retornou um código oficial válido. Atualize o componente de conexão.");
    loginId = result.loginId; current.state = "waiting"; current.verification_url = result.verificationUrl; current.user_code = result.userCode;
    if (early) completed(early);
    return chatgptLoginStatus(owner);
  } catch (error) { if (attempt === current && chatgptLoginBusy()) finish("failed", "Não foi possível iniciar a autorização oficial da conta ChatGPT."); throw error instanceof AiInputError ? error : new AiInputError("Não foi possível iniciar a autorização. Confira a instalação do componente de conexão."); }
}
export async function cancelChatgptLogin(owner: number, id: unknown) {
  if (!attempt || attempt.owner !== owner || id !== attempt.id) throw new AiInputError("Autorização não encontrada para este usuário.");
  if (!["starting", "waiting"].includes(attempt.state)) return chatgptLoginStatus(owner);
  if (client && loginId) { try { await client.request("account/login/cancel", { loginId }); } catch { /* O encerramento do processo também interrompe o fluxo. */ } }
  finish("cancelled", "Autorização cancelada.");
  return chatgptLoginStatus(owner);
}
export async function disconnectChatgpt() {
  if (chatgptLoginBusy()) throw new AiInputError("Cancele a autorização pendente antes de desconectar.");
  maintenance = true;
  let rpc: AccountClient | undefined;
  try { rpc = new AccountClient(); await rpc.initialize(); await rpc.request("account/logout"); invalidarConexaoCodex(); return { ok: true }; }
  finally { rpc?.close(); maintenance = false; }
}
export async function listChatgptModels() {
  const rpc = new AccountClient();
  try {
    await rpc.initialize(); const result = await rpc.request("model/list", { limit: 100 });
    if (!Array.isArray(result.data)) throw new AiInputError("O catálogo de modelos não respondeu. Informe o modelo manualmente.");
    return result.data.filter((m: any) => typeof (m.model || m.id) === "string").map((m: any) => ({ id: m.model || m.id, name: m.displayName || m.model || m.id }));
  } finally { rpc.close(); }
}

export function stopChatgptAuth() {
  if (chatgptLoginBusy()) finish("cancelled", "Conexão interrompida pelo reinício do sistema.");
  else cleanup();
}
