import { aiConfiguration, aiProfile, apiKeyName, chatgptLocalLoginAllowed } from "./config";
import { executeApiStructured, type ImagemParaIa } from "./apiProvider";
import { executarVisaoCodex, verificarConexaoCodex } from "../djen/codexRunner";
import { getSetting } from "../settingsService";
import { lerPdfParaIa } from "./pdf";

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

/** Como `caminhoDeVisao`, mas só devolve o caminho da conta ChatGPT se ela estiver de fato conectada. */
export async function caminhoDeVisaoPronto(): Promise<CaminhoDeVisao | null> {
  const cam = caminhoDeVisao();
  if (cam?.via !== "codex") return cam;
  try { return (await verificarConexaoCodex()).conectado ? cam : null; } catch { return null; }
}

export const ehPdf = (a: ImagemParaIa) => a.mime === "application/pdf";

/** O caminho aceita este arquivo? Pela chave de API, imagem e PDF; pela conta ChatGPT, imagem e PDF (este via texto/imagem extraídos no servidor). */
export const caminhoAceita = (_cam: CaminhoDeVisao, _arquivo: ImagemParaIa) => true;

export class PdfSemLeitorError extends Error { constructor() { super("Não consegui abrir este PDF no servidor (falta o pacote poppler-utils)."); } }

export async function perguntarComVisao(prompt: string, schema: object, arquivo: ImagemParaIa, cam: CaminhoDeVisao, signal?: AbortSignal): Promise<unknown> {
  if (cam.via === "api") return executeApiStructured(cam.provedor, cam.modelo, prompt, schema, signal, undefined, false, arquivo);
  if (ehPdf(arquivo)) {
    const pdf = await lerPdfParaIa(Buffer.from(arquivo.base64, "base64"));
    if (!pdf) throw new PdfSemLeitorError();
    if (pdf.tipo === "texto") return executarVisaoCodex(`${prompt}\n\nTexto extraído do PDF (use só ele; não há imagem):\n${pdf.texto}`, schema, null, cam.modelo, signal);
    return executarVisaoCodex(prompt, schema, { extensao: "png", conteudo: pdf.png }, cam.modelo, signal);
  }
  const extensao = arquivo.mime === "image/png" ? "png" : arquivo.mime === "image/webp" ? "webp" : "jpg";
  return executarVisaoCodex(prompt, schema, { extensao, conteudo: Buffer.from(arquivo.base64, "base64") }, cam.modelo, signal);
}
