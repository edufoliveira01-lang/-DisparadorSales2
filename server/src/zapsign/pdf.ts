import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

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
