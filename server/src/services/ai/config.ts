import { createHash } from "node:crypto";
import { db } from "../../db";
import { getSetting, setSetting } from "../settingsService";

export const AI_PROVIDERS = ["codex", "openai", "anthropic"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];
export type AiApiProvider = Exclude<AiProvider, "codex">;
export type AiMode = "economico" | "equilibrado" | "precisao";
export const AI_MODES: AiMode[] = ["economico", "equilibrado", "precisao"];
export interface AiConfiguration { provider: AiProvider; models: Record<AiProvider, Record<AiMode, string>>; revision: number }
export interface AiProfile { modo: AiMode; modelo: string; esforco: "low" | "medium"; provedor?: AiProvider; configuracao?: number }
export class AiInputError extends Error {}
export const providerName = (p: AiProvider) => ({ codex: "OpenAI · conta ChatGPT", openai: "OpenAI · API", anthropic: "Anthropic · API" })[p];
export const isProvider = (value: unknown): value is AiProvider => typeof value === "string" && (AI_PROVIDERS as readonly string[]).includes(value);
export const apiKeyName = (p: AiApiProvider) => `ai_${p}_api_key`;
const emptyModels = () => ({ economico: "", equilibrado: "", precisao: "" });
const defaults = (): AiConfiguration => ({ provider: "codex", revision: 0, models: {
  codex: { economico: "gpt-6-luna", equilibrado: "gpt-6.1-sol", precisao: "gpt-6.1-sol" }, openai: emptyModels(), anthropic: emptyModels(),
} });
export function aiConfiguration(): AiConfiguration {
  const raw = getSetting("ai_configuration");
  if (!raw) return defaults();
  try {
    const c = JSON.parse(raw) as AiConfiguration;
    if (!isProvider(c.provider) || !Number.isSafeInteger(c.revision) || c.revision < 0) throw new Error();
    for (const p of AI_PROVIDERS) for (const mode of AI_MODES) if (typeof c.models[p][mode] !== "string") throw new Error();
    return c;
  } catch { throw new AiInputError("A configuração da IA está inválida. Salve novamente em Configurações → Inteligência artificial."); }
}
export function aiProfile(modo: AiMode): AiProfile {
  const config = aiConfiguration();
  return { modo, modelo: config.models[config.provider][modo], esforco: modo === "precisao" ? "medium" : "low", provedor: config.provider, configuracao: config.revision };
}
export function profileIdentity(profile: AiProfile): string {
  // Nenhuma chave ou token participa do cache ou de sua descrição pública.
  return createHash("sha256").update(JSON.stringify([profile.provedor || "codex", profile.modelo, profile.esforco, profile.configuracao || 0])).digest("hex");
}
export function publicAiConfiguration() {
  const config = aiConfiguration();
  const hasKey = (provider: AiApiProvider) => Boolean(db.prepare("SELECT 1 FROM settings WHERE chave=? AND length(valor)>0").get(apiKeyName(provider)));
  return { ...config, credentials: { openai: hasKey("openai"), anthropic: hasKey("anthropic") },
    chatgpt_login_available: chatgptLocalLoginAllowed(),
    chatgpt_login_message: chatgptLocalLoginAllowed()
      ? "Autorização oficial para uso interno nesta instalação local."
      : "Login de conta ChatGPT indisponível neste modo hospedado. Use API ou configure a integração oficial autorizada para o aplicativo." };
}
export function chatgptLocalLoginAllowed() {
  const mode = process.env.AI_DEPLOYMENT_MODE || (process.env.OFFICE_ID ? "hosted" : "local");
  return mode === "local";
}
export function requireModel(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(value.trim())) throw new AiInputError("Informe um identificador de modelo válido.");
  return value.trim();
}
export function resolveApiKey(provider: AiApiProvider, temporary?: unknown): string {
  if (temporary !== undefined && (typeof temporary !== "string" || temporary.length > 4096 || /[\r\n\s]/.test(temporary))) throw new AiInputError("Chave de API inválida.");
  const key = (typeof temporary === "string" && temporary) || getSetting(apiKeyName(provider));
  if (!key) throw new AiInputError(`Cadastre uma chave para ${providerName(provider)}.`);
  return key;
}
export function saveAiConfiguration(input: Record<string, unknown>) {
  if (!isProvider(input.provider)) throw new AiInputError("Selecione um provedor de IA válido.");
  if (input.provider === "codex" && !chatgptLocalLoginAllowed()) throw new AiInputError("A conexão tradicional da conta ChatGPT não está habilitada neste modo hospedado. Selecione um provedor por API.");
  const previous = aiConfiguration();
  const supplied = input.models as Partial<Record<AiMode, unknown>> | undefined;
  if (!supplied || typeof supplied !== "object" || Array.isArray(supplied)) throw new AiInputError("Informe os modelos dos três modos de análise.");
  const models = Object.fromEntries(AI_MODES.map((mode) => [mode, requireModel(supplied[mode])])) as Record<AiMode, string>;
  const changed = previous.provider !== input.provider || AI_MODES.some((mode) => previous.models[input.provider as AiProvider][mode] !== models[mode]) || Boolean(input.api_key);
  const config: AiConfiguration = { provider: input.provider, revision: previous.revision + Number(changed), models: { ...previous.models, [input.provider]: models } };
  let key: string | undefined;
  if (input.provider !== "codex") {
    if (!process.env.ENCRYPTION_KEY || process.env.ENCRYPTION_KEY.length < 32) throw new AiInputError("Configure uma ENCRYPTION_KEY estável de pelo menos 32 caracteres antes de salvar credenciais de IA.");
    key = resolveApiKey(input.provider, input.api_key);
  }
  db.transaction(() => {
    if (key && config.provider !== "codex") setSetting(apiKeyName(config.provider), key);
    setSetting("ai_configuration", JSON.stringify(config));
  })();
  return publicAiConfiguration();
}
export function removeAiCredential(provider: AiApiProvider) {
  db.transaction(() => {
    db.prepare("DELETE FROM settings WHERE chave=?").run(apiKeyName(provider));
    const config = aiConfiguration();
    setSetting("ai_configuration", JSON.stringify({ ...config, revision: config.revision + 1 }));
    if (config.provider === provider) db.prepare("UPDATE djen_config SET ia_pausa=? WHERE id=1").run("Credencial da IA removida. Configure a conexão antes de retomar a fila.");
  })();
  return publicAiConfiguration();
}
