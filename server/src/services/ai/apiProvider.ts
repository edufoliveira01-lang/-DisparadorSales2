import { AiInputError, providerName, requireModel, resolveApiKey, type AiApiProvider } from "./config";

const BASES = { openai: "https://api.openai.com/v1", anthropic: "https://api.anthropic.com/v1" } as const;
export class AiProviderError extends Error { constructor(message: string, public status = 502) { super(message); } }
async function request(provider: AiApiProvider, route: string, key: string, body?: object, signal?: AbortSignal): Promise<any> {
  try {
    const response = await fetch(`${BASES[provider]}${route}`, {
      method: body ? "POST" : "GET", redirect: "error",
      headers: { "Content-Type": "application/json", ...(provider === "openai" ? { Authorization: `Bearer ${key}` } : { "x-api-key": key, "anthropic-version": "2023-06-01" }) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.any([AbortSignal.timeout(body ? 180_000 : 20_000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) {
      await response.body?.cancel();
      const detail = response.status === 401 || response.status === 403 ? "Credencial recusada ou acesso não autorizado."
        : response.status === 429 ? "Limite de uso atingido. Aguarde ou confira os créditos da conta."
        : response.status === 400 || response.status === 404 || response.status === 422 ? "Modelo indisponível ou sem suporte à saída estruturada solicitada. Confira o modelo e teste a conexão."
        : "Serviço temporariamente indisponível.";
      throw new AiProviderError(`${providerName(provider)}: ${detail}`, response.status === 429 ? 429 : 502);
    }
    const reader = response.body?.getReader();
    if (!reader) throw new AiProviderError("A IA retornou uma resposta vazia.");
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) { const item = await reader.read(); if (item.done) break; size += item.value.byteLength;
        if (size > 2_000_000) { await reader.cancel(); throw new AiProviderError("A resposta da IA excedeu o limite permitido."); } chunks.push(item.value); }
    } finally { reader.releaseLock(); }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new AiProviderError("A IA retornou uma resposta inválida."); }
  } catch (error) {
    if (signal?.aborted) throw new AiProviderError("Análise interrompida.");
    if (error instanceof AiProviderError) throw error;
    // Nunca devolver erro bruto do provedor: ele pode conter chave, prompt ou dados do processo.
    throw new AiProviderError(`Não foi possível acessar ${providerName(provider)}. Confira a conexão e tente novamente.`);
  }
}
export async function listAiModels(provider: AiApiProvider, keyInput?: unknown) {
  const key = resolveApiKey(provider, keyInput);
  const models = new Map<string, { id: string; name: string }>(); let cursor = "";
  for (let page = 0; page < 10; page++) {
    const route = provider === "anthropic" ? `/models?limit=100${cursor ? `&after_id=${encodeURIComponent(cursor)}` : ""}` : "/models";
    const result = await request(provider, route, key);
    if (!Array.isArray(result.data)) throw new AiProviderError("O provedor não retornou uma lista de modelos válida.");
    for (const item of result.data) if (typeof item.id === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(item.id)) models.set(item.id, { id: item.id, name: typeof item.display_name === "string" ? item.display_name.slice(0, 160) : item.id });
    if (provider !== "anthropic" || !result.has_more) break;
    const next = result.last_id;
    if (typeof next !== "string" || next === cursor || page === 9) throw new AiProviderError("Não foi possível percorrer todo o catálogo de modelos. Tente novamente.");
    cursor = next;
  }
  return [...models.values()].sort((a, b) => a.id.localeCompare(b.id));
}
export async function executeApiStructured(provider: AiApiProvider, model: string, prompt: string, schema: object, signal?: AbortSignal, temporaryKey?: unknown, test = false): Promise<unknown> {
  model = requireModel(model);
  const key = resolveApiKey(provider, temporaryKey);
  const result = provider === "openai"
    ? await request(provider, "/responses", key, { model, input: prompt, store: false, max_output_tokens: test ? 512 : 16384, text: { format: { type: "json_schema", name: "analise_ia", strict: true, schema } } }, signal)
    : await request(provider, "/messages", key, { model, max_tokens: test ? 512 : 16384, messages: [{ role: "user", content: prompt }], output_config: { format: { type: "json_schema", schema } } }, signal);
  let text: string;
  if (provider === "openai") {
    if (result.status !== "completed" || !Array.isArray(result.output)) throw new AiProviderError("A análise não foi concluída pelo provedor. Confira os limites e tente novamente.");
    const content = result.output.filter((item: any) => item.type === "message").flatMap((item: any) => Array.isArray(item.content) ? item.content : []);
    if (content.some((item: any) => item.type === "refusal")) throw new AiProviderError("A IA recusou esta solicitação. Confira a publicação manualmente.");
    text = content.filter((item: any) => item.type === "output_text" && typeof item.text === "string").map((item: any) => item.text).join("");
  } else {
    if (result.stop_reason !== "end_turn" || !Array.isArray(result.content)) throw new AiProviderError("A análise não foi concluída pelo provedor. Confira o limite de saída e tente novamente.");
    text = result.content.filter((item: any) => item.type === "text" && typeof item.text === "string").map((item: any) => item.text).join("");
  }
  if (text.length > 500_000) throw new AiProviderError("A resposta da IA excedeu o limite permitido.");
  try { return JSON.parse(text); } catch { throw new AiProviderError("A IA não retornou JSON válido. Confira o modelo selecionado."); }
}
export async function testAiApi(provider: AiApiProvider, model: unknown, key?: unknown) {
  const result = await executeApiStructured(provider, requireModel(model), "Teste de conexão. Retorne apenas ok igual a true no formato solicitado.", { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false }, undefined, key, true);
  if (!result || typeof result !== "object" || (result as { ok?: unknown }).ok !== true) throw new AiInputError("A conexão respondeu, mas o modelo não concluiu o teste estruturado.");
  return { conectado: true, mensagem: "Conexão e resposta estruturada verificadas. O teste usa uma pequena requisição ao provedor." };
}
