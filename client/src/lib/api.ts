import { activityLabel, beginRequestActivity } from "./requestActivity";
import { socket } from "./socket";

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown> | null;
  constructor(message: string, status: number, data: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

interface RequestOptions extends RequestInit { background?: boolean; fresh?: boolean }

/**
 * Leituras pesadas do acompanhamento processual ficam em memória por pouco tempo: ao voltar a uma
 * página (ou quando duas áreas pedem o mesmo dado) a resposta aparece na hora, sem novo cálculo no
 * servidor. Qualquer escrita e qualquer evento "djen:changed" descartam tudo, então os dados
 * continuam coerentes; `fresh: true` ignora o cache.
 */
const CACHEAVEL = /^\/djen\/(?:status|kanban|publicacoes(?:\?|$)|aguardando|pericias\/sem-laudo|prazos\/escritorio|processos\/parados|acompanhamentos\/diagnostico)/;
const TTL_CACHE_MS = 45_000;
const respostas = new Map<string, { em: number; dados: unknown }>();
const emVoo = new Map<string, Promise<unknown>>();
let versaoCache = 0;
export function limparCacheApi() { versaoCache++; respostas.clear(); emVoo.clear(); }
// Registrado na carga do módulo: roda antes dos ouvintes dos componentes, que recarregam em seguida.
socket.on("djen:changed", limparCacheApi);
socket.on("connect", limparCacheApi);
async function request<T>(path: string, options?: RequestOptions): Promise<T> {
  const { background, ...fetchOptions } = options ?? {};
  const finish = background || /\/(status|batches)(\?|$)/.test(path)
    ? () => {} : beginRequestActivity(activityLabel(path, options?.method));
  try {
    const response = await fetch(`/api${path}`, {
      headers: { "Content-Type": "application/json" },
      ...fetchOptions,
    });

    const isJson = response.headers.get("content-type")?.includes("application/json");
    const body = isJson ? await response.json().catch(() => null) : null;

    if (!response.ok) {
      if (response.status === 401 && !path.includes("/auth/login")) {
        // Redirecionar para login se não estiver autenticado (exceto na própria tela de login)
        window.location.href = "/login";
      }
      throw new ApiError(body?.error || `Erro na requisição (HTTP ${response.status})`, response.status, body);
    }
    return body as T;
  } finally {
    finish();
    if (options?.method && options.method !== "GET") window.dispatchEvent(new Event("services:refresh"));
  }
}

function lerComCache<T>(path: string, options?: RequestOptions): Promise<T> {
  if (options?.fresh || !CACHEAVEL.test(path)) return request<T>(path, options);
  const guardado = respostas.get(path);
  if (guardado && Date.now() - guardado.em < TTL_CACHE_MS) return Promise.resolve(guardado.dados as T);
  const pendente = emVoo.get(path);
  if (pendente) return pendente as Promise<T>;
  const versao = versaoCache;
  const promessa = request<T>(path, options).then((dados) => {
    if (versao === versaoCache) respostas.set(path, { em: Date.now(), dados });
    return dados;
  }).finally(() => { if (emVoo.get(path) === promessa) emVoo.delete(path); });
  emVoo.set(path, promessa);
  return promessa;
}
// Escrita: descarta o cache antes e depois, para a próxima leitura refletir a mudança.
const escrever = <T>(path: string, options: RequestOptions) => {
  limparCacheApi();
  return request<T>(path, options).finally(limparCacheApi);
};

export const api = {
  baseUrl: "/api",
  get: <T>(path: string, options?: RequestOptions) => lerComCache<T>(path, options),
  post: <T>(path: string, data?: unknown, options?: RequestOptions) => escrever<T>(path, { ...options, method: "POST", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) => escrever<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => escrever<T>(path, { method: "DELETE" }),
  /** Envia o conteúdo bruto de um arquivo (o nome vai na query da rota). */
  upload: <T>(path: string, file: Blob) => escrever<T>(path, { method: "POST", headers: { "Content-Type": "application/octet-stream" }, body: file }),
};


