import fs from "node:fs";
import path from "node:path";

/** Isolamento por instância durante a transição; não seleciona escritórios por dados da requisição. */
export function validateOfficeStorage(dataDirectory: string, env: NodeJS.ProcessEnv = process.env): void {
  const identityFile = path.join(dataDirectory, "office-identity.json");
  const existing = fs.existsSync(identityFile) ? JSON.parse(fs.readFileSync(identityFile, "utf8")) as { office_id?: string } : undefined;
  const officeId = env.OFFICE_ID;
  if (!officeId) {
    if (existing) throw new Error("Este diretório pertence a um escritório. Configure o OFFICE_ID correspondente.");
    return; // Instalações existentes continuam com os mesmos caminhos e dados.
  }
  if (!/^[a-z0-9][a-z0-9_-]{2,63}$/.test(officeId)) throw new Error("OFFICE_ID deve conter de 3 a 64 letras minúsculas, números, traço ou sublinhado.");
  if (!env.DATA_DIR || !path.isAbsolute(env.DATA_DIR)) throw new Error("Escritórios isolados exigem DATA_DIR absoluto e exclusivo.");
  if (!env.ENCRYPTION_KEY || env.ENCRYPTION_KEY.length < 32) throw new Error("Configure uma ENCRYPTION_KEY exclusiva de pelo menos 32 caracteres para este escritório.");
  if (!env.DJEN_CODEX_HOME || !path.isAbsolute(env.DJEN_CODEX_HOME)) throw new Error("Configure DJEN_CODEX_HOME absoluto dentro do DATA_DIR do escritório.");
  fs.mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
  fs.mkdirSync(env.DJEN_CODEX_HOME, { recursive: true, mode: 0o700 });
  const relative = path.relative(fs.realpathSync(dataDirectory), fs.realpathSync(env.DJEN_CODEX_HOME));
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === ".." || path.isAbsolute(relative))
    throw new Error("DJEN_CODEX_HOME deve estar dentro do DATA_DIR exclusivo deste escritório.");
  if (existing) {
    if (existing.office_id !== officeId) throw new Error("DATA_DIR já pertence a outro escritório; inicialização interrompida.");
    return;
  }
  // Nunca atribui silenciosamente um banco legado a um novo escritório.
  if (fs.existsSync(path.join(dataDirectory, "disparador.sqlite3"))) throw new Error("Este DATA_DIR já contém dados legados. Use um diretório vazio para um novo escritório; migração de dados requer procedimento próprio.");
  try { fs.writeFileSync(identityFile, JSON.stringify({ office_id: officeId, version: 1 }), { flag: "wx", mode: 0o600 }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const claimed = JSON.parse(fs.readFileSync(identityFile, "utf8")) as { office_id: string };
    if (claimed.office_id !== officeId) throw new Error("DATA_DIR foi atribuído a outro escritório.");
  }
}
