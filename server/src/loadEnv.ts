import fs from "node:fs";
import path from "node:path";
import dotenv from "dotenv";

// O PM2 pode manter `server/` como diretório de execução mesmo quando o projeto é atualizado
// pela raiz. Resolve o arquivo pelo local do código compilado para que a configuração canônica
// continue sendo `disparador-sales2/.env`, com fallback para o diretório de execução em
// instalações antigas.
const projectEnv = path.resolve(__dirname, "../../.env");
const workingDirectoryEnv = path.resolve(process.cwd(), ".env");
const candidates = Array.from(new Set([projectEnv, workingDirectoryEnv]));
const envPath = candidates.find((candidate) => fs.existsSync(candidate));

if (envPath) {
  dotenv.config({ path: envPath });
}
