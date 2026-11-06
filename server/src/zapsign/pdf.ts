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
      const medidas: { paginas: number; esquerda: number; topo: number }[] = await pagina.evaluate(() => {
        const altura = (297 * 96) / 25.4;
        return Array.from(document.querySelectorAll(".folha")).map((f) => {
          const r = f.getBoundingClientRect();
          const l = f.querySelector(".assina .linha");
          const paginas = Math.max(1, Math.ceil((r.height - 2) / altura));
          if (!l || paginas > 1) return { paginas, esquerda: -1, topo: -1 };
          const lr = l.getBoundingClientRect();
          return { paginas, esquerda: ((lr.left - r.left) / r.width) * 100, topo: ((lr.top - r.top) / altura) * 100 };
        });
      });
      const pdf = await pagina.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
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
