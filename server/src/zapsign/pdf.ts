import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kitDocx } from "../services/gestao/docx";
import { kitHtml, type Kit } from "../services/gestao/documentos";
import type { PosicaoAssinatura } from "./api";

/** Converte um .docx em PDF com o LibreOffice (instalado no servidor). Cada chamada usa um perfil próprio, para não travar em execuções simultâneas. */
export async function docxParaPdf(docx: Buffer, executavel = process.env.SOFFICE_BIN || "soffice"): Promise<Buffer> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "contrato-"));
  try {
    const entrada = path.join(dir, "documento.docx");
    fs.writeFileSync(entrada, docx);
    await new Promise<void>((resolve, reject) => {
      execFile(
        executavel,
        [`-env:UserInstallation=file://${path.join(dir, "perfil")}`, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", dir, entrada],
        { timeout: 120_000 },
        (erro) => (erro ? reject(erro) : resolve()),
      );
    });
    const saida = path.join(dir, "documento.pdf");
    if (!fs.existsSync(saida)) throw new Error("O LibreOffice não gerou o PDF.");
    return fs.readFileSync(saida);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const PREFIXO_MARCA = "https://sales.invalid/assinatura/";

export interface PdfDoKit { pdf: Buffer; assinaturas: PosicaoAssinatura[] }

/**
 * Gera o PDF do kit pelo MESMO HTML da impressão (cabeçalho, rodapé, assinatura), usando o Chromium que o próprio sistema já tem
 * (o do motor do WhatsApp), e mede onde fica a linha de assinatura do cliente em cada documento — para o campo de assinatura cair EM CIMA da linha.
 * Se o Chromium não estiver disponível, cai no LibreOffice (sem posições).
 */
export async function pdfDoKit(kit: Kit): Promise<PdfDoKit> {
  let falhaDoChromium: unknown = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteer = require("puppeteer");
    const navegador = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
    try {
      const pagina = await navegador.newPage();
      await pagina.setContent(kitHtml(kit), { waitUntil: "load", timeout: 60_000 });
      await pagina.emulateMediaType("print");
      // Marca a linha de assinatura de cada documento com um link invisível (sem mexer no layout): o Chromium grava no PDF a página e a
      // posição exatas do link — assim vale para documento de qualquer tamanho, de qualquer escritório e com qualquer estilo.
      const medidas: { paginas: number; esquerda: number; topo: number }[] = await pagina.evaluate((prefixo: string) => {
        const altura = (297 * 96) / 25.4;
        return Array.from(document.querySelectorAll(".folha")).map((f, i) => {
          const r = f.getBoundingClientRect();
          const l = f.querySelector(".assina .linha") as HTMLElement | null;
          const paginas = Math.max(1, Math.ceil((r.height - 2) / altura));
          if (!l) return { paginas, esquerda: -1, topo: -1 };
          if (getComputedStyle(l).position === "static") l.style.position = "relative";
          const a = document.createElement("a");
          a.href = `${prefixo}${i}`;
          a.style.cssText = "position:absolute;left:0;top:0;width:100%;height:2px;display:block";
          l.appendChild(a);
          const lr = l.getBoundingClientRect();
          return { paginas, esquerda: ((lr.left - r.left) / r.width) * 100, topo: paginas > 1 ? -1 : ((lr.top - r.top) / altura) * 100 };
        });
      }, PREFIXO_MARCA);
      const pdf = await pagina.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
      const marcadas = posicoesPorMarcadores(Buffer.from(pdf));
      if (marcadas.size > 0) return { pdf: Buffer.from(pdf), assinaturas: Array.from(marcadas.entries()).sort((x, y) => x[0] - y[0]).map(([, v]) => v) };
      return { pdf: Buffer.from(pdf), assinaturas: posicoesDasAssinaturas(medidas) };
    } finally {
      await navegador.close().catch(() => undefined);
    }
  } catch (e) {
    falhaDoChromium = e;
  }
  try {
    return { pdf: await docxParaPdf(kitDocx(kit)), assinaturas: [] };
  } catch (e) {
    console.error("[contratos] não foi possível gerar o PDF. Chromium:", falhaDoChromium instanceof Error ? falhaDoChromium.message : falhaDoChromium, "| LibreOffice:", e instanceof Error ? e.message : e);
    throw e;
  }
}

/**
 * Converte as medidas (em % da folha, topo da linha de cima para baixo) nas posições do ZapSign (origem embaixo à esquerda):
 * o campo fica com a borda de baixo logo acima da linha e um pouco à direita do início dela. Documento que passa de uma página fica de fora.
 */
export function posicoesDasAssinaturas(medidas: { paginas: number; esquerda: number; topo: number }[]): PosicaoAssinatura[] {
  const saida: PosicaoAssinatura[] = [];
  let pagina = 0;
  for (const m of medidas) {
    if (m.esquerda >= 0 && m.topo >= 0) saida.push({ pagina, esquerda: m.esquerda + 1, baixo: 100 - m.topo + 0.4 });
    pagina += m.paginas;
  }
  return saida;
}

/**
 * Lê do PDF gerado pelo Chromium os links invisíveis que marcam a linha de assinatura de cada documento (índice → página e posição).
 * Posição em % da folha, origem embaixo à esquerda, já com o ajuste para o campo cair em cima da linha.
 */
export function posicoesPorMarcadores(pdf: Buffer): Map<number, PosicaoAssinatura> {
  const t = pdf.toString("latin1");
  const marcas = new Map<number, { x: number; y: number }>(); // nº do objeto da anotação -> topo-esquerdo do link (pt)
  const indices = new Map<number, number>();
  for (const m of t.matchAll(/(\d+) 0 obj\s*<<((?:(?!endobj)[\s\S])*?)>>\s*endobj/g)) {
    const corpo = m[2]!;
    if (!/\/Subtype\s*\/Link/.test(corpo)) continue;
    const uri = /\/URI\s*\(([^)]*)\)/.exec(corpo)?.[1];
    const rect = /\/Rect\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s*\]/.exec(corpo);
    if (!uri?.startsWith(PREFIXO_MARCA) || !rect) continue;
    const n = Number(m[1]);
    indices.set(n, Number(uri.slice(PREFIXO_MARCA.length)));
    marcas.set(n, { x: Math.min(Number(rect[1]), Number(rect[3])), y: Math.max(Number(rect[2]), Number(rect[4])) });
  }
  const saida = new Map<number, PosicaoAssinatura>();
  let pagina = -1;
  for (const m of t.matchAll(/\/Type\s*\/Page(?![s\w])([\s\S]*?)(?=\/Type\s*\/Page(?![s\w])|\/Type\s*\/Pages|$)/g)) {
    pagina++;
    const lista = /\/Annots\s*\[([^\]]*)\]/.exec(m[1]!)?.[1] ?? "";
    for (const r of lista.matchAll(/(\d+) 0 R/g)) {
      const n = Number(r[1]);
      const marca = marcas.get(n);
      if (!marca) continue;
      saida.set(indices.get(n)!, { pagina, esquerda: (marca.x / A4_LARGURA_PT) * 100 + 1, baixo: (marca.y / A4_ALTURA_PT) * 100 + 0.4 });
    }
  }
  return saida;
}
const A4_LARGURA_PT = 595.28, A4_ALTURA_PT = 841.89;
