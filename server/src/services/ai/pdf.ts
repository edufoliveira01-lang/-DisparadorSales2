import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * PDF para a conta ChatGPT (que só recebe imagem e texto): extrai o TEXTO da primeira páginas e, se for escaneado, gera uma IMAGEM da página 1.
 * Usa as ferramentas `pdftotext` e `pdftoppm` (pacote poppler-utils) quando o servidor as tem; sem elas devolve null e o arquivo fica como comum.
 */
function rodar(cmd: string, args: string[], timeoutMs = 30_000): Promise<{ ok: boolean; saida: string }> {
  return new Promise((resolve) => {
    let saida = ""; let fim = false;
    const fechar = (ok: boolean) => { if (!fim) { fim = true; resolve({ ok, saida }); } };
    let c;
    try { c = spawn(cmd, args, { stdio: ["ignore", "pipe", "ignore"] }); } catch { return fechar(false); }
    const t = setTimeout(() => { c.kill("SIGKILL"); fechar(false); }, timeoutMs); t.unref();
    c.stdout.on("data", (d: Buffer) => { if (saida.length < 200_000) saida += d.toString("utf8"); });
    c.on("error", () => { clearTimeout(t); fechar(false); });
    c.on("close", (code) => { clearTimeout(t); fechar(code === 0); });
  });
}

export type PdfLegivel = { tipo: "texto"; texto: string } | { tipo: "imagem"; png: Buffer } | null;

export async function lerPdfParaIa(conteudo: Buffer): Promise<PdfLegivel> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "pdf-ia-"));
  try {
    const arq = path.join(dir, "documento.pdf");
    await fs.writeFile(arq, conteudo, { mode: 0o600 });
    const t = await rodar("pdftotext", ["-l", "3", "-layout", "-enc", "UTF-8", arq, "-"]);
    const texto = t.saida.replace(/\s+/g, " ").trim();
    if (t.ok && texto.length >= 80) return { tipo: "texto", texto: texto.slice(0, 9000) };
    const img = await rodar("pdftoppm", ["-png", "-r", "110", "-f", "1", "-l", "1", "-singlefile", arq, path.join(dir, "pagina")]);
    if (img.ok) { try { return { tipo: "imagem", png: await fs.readFile(path.join(dir, "pagina.png")) }; } catch { return null; } }
    return null;
  } finally { await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined); }
}
