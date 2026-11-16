import { aiConfiguration, aiProfile, apiKeyName, chatgptLocalLoginAllowed } from "./config";
import { executeApiStructured, type ImagemParaIa } from "./apiProvider";
import { executarVisaoCodex } from "../djen/codexRunner";
import { getSetting } from "../settingsService";

/** Como o Sales consegue «olhar» uma imagem ou PDF: pela chave de API (imagem e PDF) ou pela conta ChatGPT conectada (só imagem). null = sem como. */
export type CaminhoDeVisao = { via: "api"; provedor: "openai" | "anthropic"; modelo: string } | { via: "codex"; modelo: string };

export function caminhoDeVisao(): CaminhoDeVisao | null {
  try {
    const c = aiConfiguration();
    const modelo = aiProfile("economico").modelo;
    if (!modelo) return null;
    if (c.provider === "codex") return chatgptLocalLoginAllowed() ? { via: "codex", modelo } : null;
    return (getSetting(apiKeyName(c.provider)) ?? "").trim() ? { via: "api", provedor: c.provider, modelo } : null;
  } catch { return null; }
}

export const ehPdf = (a: ImagemParaIa) => a.mime === "application/pdf";

/** O caminho aceita este arquivo? (a conta ChatGPT não lê PDF) */
export const caminhoAceita = (cam: CaminhoDeVisao, arquivo: ImagemParaIa) => cam.via === "api" || !ehPdf(arquivo);

export async function perguntarComVisao(prompt: string, schema: object, arquivo: ImagemParaIa, cam: CaminhoDeVisao, signal?: AbortSignal): Promise<unknown> {
  if (cam.via === "api") return executeApiStructured(cam.provedor, cam.modelo, prompt, schema, signal, undefined, false, arquivo);
  const extensao = arquivo.mime === "image/png" ? "png" : arquivo.mime === "image/webp" ? "webp" : "jpg";
  return executarVisaoCodex(prompt, schema, { extensao, conteudo: Buffer.from(arquivo.base64, "base64") }, cam.modelo, signal);
}
