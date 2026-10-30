import { activityLabel, beginRequestActivity } from "./requestActivity";

export class ApiError extends Error {
  status: number;
  data: Record<string, unknown> | null;
  constructor(message: string, status: number, data: Record<string, unknown> | null = null) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

interface RequestOptions extends RequestInit { background?: boolean }
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

export const api = {
  baseUrl: "/api",
  get: <T>(path: string, options?: RequestOptions) => request<T>(path, options),
  post: <T>(path: string, data?: unknown, options?: RequestOptions) => request<T>(path, { ...options, method: "POST", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) => request<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};


