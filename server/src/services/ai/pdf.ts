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

/** Os JPEGs embutidos no PDF, do maior para o menor (documento fotografado ou escaneado e salvo como PDF: frente e verso viram imagens), sem precisar de ferramenta. */
export function jpegsEmbutidosNoPdf(pdf: Buffer): Buffer[] {
  const achados: Buffer[] = [];
  let pos = 0;
  while (pos < pdf.length && achados.length < 12) {
    const ini = pdf.indexOf(Buffer.from([0xff, 0xd8, 0xff]), pos);
    if (ini < 0) break;
    const fimStream = pdf.indexOf("endstream", ini);
    const limite = fimStream < 0 ? pdf.length : fimStream;
    const fim = pdf.lastIndexOf(Buffer.from([0xff, 0xd9]), limite);
    if (fim > ini) { const img = pdf.subarray(ini, fim + 2); if (img.length >= 5_000) achados.push(Buffer.from(img)); pos = fim + 2; }
    else pos = ini + 3;
  }
  return achados.sort((x, y) => y.length - x.length);
}
export const jpegEmbutidoNoPdf = (pdf: Buffer): Buffer | null => jpegsEmbutidosNoPdf(pdf)[0] ?? null;

/** As imagens candidatas a conter o retrato: os JPEGs embutidos (até 3) ou, se não houver, a primeira página desenhada pelo pdftoppm. */
export async function imagensDoPdf(pdf: Buffer): Promise<Buffer[]> {
  const jpegs = jpegsEmbutidosNoPdf(pdf).slice(0, 3);
  if (jpegs.length) return jpegs;
  const p = await lerPdfParaIa(pdf);
  return p?.tipo === "imagem" ? [p.png] : [];
}
