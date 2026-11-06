import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { kitDocx } from "../services/gestao/docx";
import { kitHtml, type Kit } from "../services/gestao/documentos";

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

/**
 * Gera o PDF do kit pelo MESMO HTML da impressão (cabeçalho, rodapé, assinatura), usando o Chromium que o próprio sistema já tem
 * (o do motor do WhatsApp). Se ele não estiver disponível, cai no LibreOffice (se instalado).
 */
export async function pdfDoKit(kit: Kit): Promise<Buffer> {
  let falhaDoChromium: unknown = null;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const puppeteer = require("puppeteer");
    const navegador = await puppeteer.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"] });
    try {
      const pagina = await navegador.newPage();
      await pagina.setContent(kitHtml(kit), { waitUntil: "load", timeout: 60_000 });
      const pdf = await pagina.pdf({ format: "A4", printBackground: true, preferCSSPageSize: true });
      return Buffer.from(pdf);
    } finally {
      await navegador.close().catch(() => undefined);
    }
  } catch (e) {
    falhaDoChromium = e;
  }
  try {
    return await docxParaPdf(kitDocx(kit));
  } catch (e) {
    console.error("[contratos] não foi possível gerar o PDF. Chromium:", falhaDoChromium instanceof Error ? falhaDoChromium.message : falhaDoChromium, "| LibreOffice:", e instanceof Error ? e.message : e);
    throw e;
  }
}
