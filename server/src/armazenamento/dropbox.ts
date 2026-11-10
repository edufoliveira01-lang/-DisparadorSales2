/**
 * O provedor DROPBOX (API v2) — só a conversa com o Dropbox. As regras de pasta moram em `pastas.ts` e valem para qualquer provedor.
 *
 * A rede é injetável (`http`) para os testes provarem os pedidos sem acesso de verdade. Todo caminho que sai daqui passa por `dentroDaRaiz`:
 * o app tem acesso à conta inteira (o Dropbox não restringe a uma pasta só), então a trava de `/CLIENTES/` é do código.
 */
import { dentroDaRaiz, ErroArmazenamento, ErroItemNaoEncontrado, type PastaExistente } from "./pastas";

export class ErroDropbox extends ErroArmazenamento {
  constructor(message: string, status: number, public tag = "") { super(message, status); }
}

type Http = typeof fetch;

export const URL_DE_AUTORIZACAO = "https://www.dropbox.com/oauth2/authorize";
const API = "https://api.dropboxapi.com";
const CONTEUDO = "https://content.dropboxapi.com";
/** O envio simples do Dropbox vai até 150 MB; acima disso é preciso sessão de envio (não implementada: ficaria fora do uso real de documentos). */
export const TAMANHO_MAXIMO_DO_ENVIO = 140 * 1024 * 1024;

/** O endereço para onde mandar a pessoa autorizar. `token_access_type=offline` é o que devolve o refresh token (acesso que não expira em horas). */
export function urlDeAutorizacao(p: { appKey: string; redirectUri: string; state: string }): string {
  const q = new URLSearchParams({ client_id: p.appKey, response_type: "code", token_access_type: "offline", redirect_uri: p.redirectUri, state: p.state });
  return `${URL_DE_AUTORIZACAO}?${q.toString()}`;
}

/** O cabeçalho `Dropbox-API-Arg` só aceita ASCII: todo caractere acima de 0x7e (acentos!) vira `\uXXXX`. Sem isto, "PARTE MÉDICA" quebra o envio. */
export function argEmCabecalho(obj: unknown): string {
  return JSON.stringify(obj).replace(/[\u007f-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
}

async function lerErro(r: Response): Promise<ErroDropbox | ErroItemNaoEncontrado> {
  let resumo = "";
  try {
    const t = await r.text();
    try { const j = JSON.parse(t) as { error_summary?: string; error_description?: string; error?: string }; resumo = j.error_summary || j.error_description || j.error || t; }
    catch { resumo = t; }
  } catch { /* sem corpo */ }
  if (r.status === 409 && /not_found/.test(resumo)) return new ErroItemNaoEncontrado();
  const tag = resumo.split("/").slice(0, 2).join("/").replace(/\.+$/, "");
  const frase = r.status === 401 ? "O acesso ao Dropbox expirou ou foi revogado. Conecte de novo em Configurações."
    : r.status === 429 ? "O Dropbox pediu para esperar um pouco (muitas chamadas). O envio será tentado de novo."
    : r.status === 507 || /insufficient_space/.test(resumo) ? "O Dropbox está sem espaço."
    : `O Dropbox recusou o pedido (${r.status}): ${resumo.slice(0, 200)}`;
  return new ErroDropbox(frase, r.status, resumo);
}

export interface TokensDropbox { refreshToken: string; accessToken: string; expiraEmSeg: number; contaId: string }

/** Troca o código que o Dropbox devolveu pelo acesso duradouro (refresh token). */
export async function trocarCodigo(p: { appKey: string; appSecret: string; code: string; redirectUri: string; http?: Http }): Promise<TokensDropbox> {
  const http = p.http ?? fetch;
  const corpo = new URLSearchParams({ code: p.code, grant_type: "authorization_code", redirect_uri: p.redirectUri, client_id: p.appKey, client_secret: p.appSecret });
  const r = await http(`${API}/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo.toString(), signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw await lerErro(r);
  const j = (await r.json()) as { access_token?: string; refresh_token?: string; expires_in?: number; account_id?: string };
  if (!j.access_token || !j.refresh_token) throw new ErroDropbox("O Dropbox não devolveu o acesso duradouro. Confira se o app permite acesso offline.", 502);
  return { refreshToken: j.refresh_token, accessToken: j.access_token, expiraEmSeg: j.expires_in ?? 14_400, contaId: j.account_id ?? "" };
}

export interface ContaDropbox { id: string; nome: string; email: string; tipo: string; ehEquipe: boolean; raizDeNomes: string }
export interface MetadadosDeItem { id: string; nome: string; caminho: string; tipo: "folder" | "file" | string }

export interface ConfigDoCliente { appKey: string; appSecret: string; refreshToken: string; http?: Http; agora?: () => number; raizDeNomes?: string }

export function criarClienteDropbox(cfg: ConfigDoCliente) {
  const http = cfg.http ?? fetch;
  const agora = cfg.agora ?? (() => Date.now());
  let acesso: { valor: string; expiraEm: number } | null = null;
  let raiz = cfg.raizDeNomes ?? "";

  async function renovar(): Promise<string> {
    const corpo = new URLSearchParams({ grant_type: "refresh_token", refresh_token: cfg.refreshToken, client_id: cfg.appKey, client_secret: cfg.appSecret });
    const r = await http(`${API}/oauth2/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: corpo.toString(), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw await lerErro(r);
    const j = (await r.json()) as { access_token?: string; expires_in?: number };
    if (!j.access_token) throw new ErroDropbox("O Dropbox não renovou o acesso.", 502);
    acesso = { valor: j.access_token, expiraEm: agora() + (j.expires_in ?? 14_400) * 1000 - 60_000 };
    return acesso.valor;
  }
  const token = async () => (acesso && acesso.expiraEm > agora() ? acesso.valor : renovar());

  const cabecalhoDaRaiz = (): Record<string, string> => (raiz ? { "Dropbox-API-Path-Root": JSON.stringify({ ".tag": "root", root: raiz }) } : {});

  /** Chamada RPC (corpo JSON). Um 401 com o acesso expirado renova e tenta UMA vez de novo. */
  async function rpc<T>(caminho: string, corpo?: unknown, tentouRenovar = false): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${await token()}`, ...cabecalhoDaRaiz() };
    if (corpo !== undefined) headers["Content-Type"] = "application/json";
    const r = await http(`${API}${caminho}`, { method: "POST", headers, body: corpo === undefined ? undefined : JSON.stringify(corpo), signal: AbortSignal.timeout(30_000) });
    if (r.status === 401 && !tentouRenovar) { acesso = null; return rpc<T>(caminho, corpo, true); }
    if (!r.ok) throw await lerErro(r);
    return (await r.json()) as T;
  }

  const referencia = (ref: string) => (ref.startsWith("id:") ? ref : dentroDaRaiz(ref));
  const comoMetadados = (e: { id: string; name: string; path_display?: string; ".tag"?: string }): MetadadosDeItem => ({ id: e.id, nome: e.name, caminho: e.path_display ?? "", tipo: e[".tag"] ?? "" });

  return {
    /** Dados da conta conectada. Conta de EQUIPE (raiz diferente da pasta pessoal) passa a mandar o cabeçalho de raiz em todas as chamadas. */
    async conta(): Promise<ContaDropbox> {
      const j = await rpc<{ account_id: string; name?: { display_name?: string }; email?: string; account_type?: { ".tag"?: string }; root_info?: { root_namespace_id?: string; home_namespace_id?: string } }>("/2/users/get_current_account");
      const ehEquipe = Boolean(j.root_info?.root_namespace_id && j.root_info.root_namespace_id !== j.root_info.home_namespace_id);
      if (ehEquipe) raiz = j.root_info!.root_namespace_id!;
      return { id: j.account_id, nome: j.name?.display_name ?? "", email: j.email ?? "", tipo: j.account_type?.[".tag"] ?? "", ehEquipe, raizDeNomes: ehEquipe ? raiz : "" };
    },

    /** As pastas DIRETAS de `caminho` (uma página por chamada, até acabar). */
    async listarPastas(caminho: string): Promise<PastaExistente[]> {
      const alvo = dentroDaRaiz(caminho);
      const saida: PastaExistente[] = [];
      type Pagina = { entries: Array<{ ".tag": string; id: string; name: string; path_display?: string }>; has_more: boolean; cursor: string };
      let pagina = await rpc<Pagina>("/2/files/list_folder", { path: alvo, recursive: false, include_deleted: false, limit: 2000 });
      for (;;) {
        for (const e of pagina.entries) if (e[".tag"] === "folder") saida.push({ id: e.id, nome: e.name, caminho: e.path_display ?? `${alvo}/${e.name}` });
        if (!pagina.has_more) break;
        pagina = await rpc<Pagina>("/2/files/list_folder/continue", { cursor: pagina.cursor });
      }
      return saida;
    },

    /** Cria a pasta. Já existindo, devolve a que existe (idempotente). */
    async criarPasta(caminho: string): Promise<MetadadosDeItem> {
      const alvo = dentroDaRaiz(caminho);
      try {
        const j = await rpc<{ metadata: { id: string; name: string; path_display?: string } }>("/2/files/create_folder_v2", { path: alvo, autorename: false });
        return comoMetadados({ ...j.metadata, ".tag": "folder" });
      } catch (e) {
        if (e instanceof ErroDropbox && e.status === 409 && /path\/conflict\/folder/.test(e.tag)) return this.metadados(alvo);
        throw e;
      }
    },

    /** Dados de uma pasta/arquivo por caminho (dentro de `/CLIENTES`) ou por identificador (`id:…`, que sobrevive a renomeação). */
    async metadados(ref: string): Promise<MetadadosDeItem> {
      const j = await rpc<{ id: string; name: string; path_display?: string; ".tag"?: string }>("/2/files/get_metadata", { path: referencia(ref) });
      return comoMetadados(j);
    },

    /** Grava o arquivo. `autorename`: se o nome já existir, o Dropbox acrescenta "(1)" em vez de sobrescrever. */
    async enviar(caminho: string, conteudo: Buffer): Promise<{ id: string; caminho: string }> {
      const alvo = dentroDaRaiz(caminho);
      if (!Buffer.isBuffer(conteudo) || conteudo.length === 0) throw new ErroArmazenamento("O arquivo está vazio.");
      if (conteudo.length > TAMANHO_MAXIMO_DO_ENVIO) throw new ErroArmazenamento("O arquivo é grande demais para o envio ao Dropbox (limite de 140 MB).", 413);
      const enviarUmaVez = async () => http(`${CONTEUDO}/2/files/upload`, {
        method: "POST",
        headers: { Authorization: `Bearer ${await token()}`, "Dropbox-API-Arg": argEmCabecalho({ path: alvo, mode: "add", autorename: true, mute: true }), "Content-Type": "application/octet-stream", ...cabecalhoDaRaiz() },
        body: new Uint8Array(conteudo),
        signal: AbortSignal.timeout(120_000),
      });
      let r = await enviarUmaVez();
      if (r.status === 401) { acesso = null; r = await enviarUmaVez(); }
      if (!r.ok) throw await lerErro(r);
      const j = (await r.json()) as { id: string; path_display?: string };
      return { id: j.id, caminho: j.path_display ?? alvo };
    },
  };
}

export type ClienteDropbox = ReturnType<typeof criarClienteDropbox>;
