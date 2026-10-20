// Autenticação local. Não recebe, armazena ou publica senha via aplicação web.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { spawn } = require("node:child_process");
if (!require("./ensure-codex.cjs").ensureCodex()) process.exit(1);
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
const authDir = path.resolve(
  process.env.DJEN_CODEX_HOME || path.join(os.homedir(), ".disparador-codex"),
);
fs.mkdirSync(authDir, { recursive: true, mode: 0o700 });
const env = { ...process.env, CODEX_HOME: authDir };
for (const key of [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "CODEX_ACCESS_TOKEN",
  "OPENAI_BASE_URL",
  "OPENAI_FEDERATION_RULE_ID",
  "OPENAI_IDENTITY_TOKEN_FILE",
])
  delete env[key];
console.log("Conecte a conta ChatGPT. Use o mesmo usuário que executa o PM2.");
console.log("Diretório de autenticação:", authDir);
const cli = path.resolve(
  __dirname,
  "../node_modules/@openai/codex/bin/codex.js",
);
const child = spawn(
  process.execPath,
  [
    cli,
    "-c",
    'forced_login_method="chatgpt"',
    "-c",
    'cli_auth_credentials_store="file"',
    "login",
    "--device-auth",
  ],
  { env, stdio: "inherit", shell: false },
);
child.on("error", () => {
  console.error("Codex não instalado. Execute npm run install:all.");
  process.exitCode = 1;
});
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
