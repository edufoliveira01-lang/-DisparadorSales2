import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {
  ESQUEMA_ANALISE_CODEX,
  promptAnaliseCodex,
  validarAnaliseCodex,
} from "./classifier";

export const codexHome = () =>
  path.resolve(
    process.env.DJEN_CODEX_HOME || path.join(os.homedir(), ".disparador-codex"),
  );
const cli = path.resolve(
  __dirname,
  "../../../node_modules/@openai/codex/bin/codex.js",
);
export function ambienteCodex(): NodeJS.ProcessEnv {
  // Não herdar tokens do WhatsApp, banco, API keys ou credenciais do processo do servidor.
  const env: NodeJS.ProcessEnv = {};
  for (const key of [
    "PATH",
    "HOME",
    "USERPROFILE",
    "SystemRoot",
    "TEMP",
    "TMP",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
  ])
    if (process.env[key]) env[key] = process.env[key];
  env.CODEX_HOME = codexHome();
  return env;
}
export const CONFIG_CODEX = [
  "--ignore-user-config",
  "--strict-config",
  "-c",
  'forced_login_method="chatgpt"',
  "-c",
  'cli_auth_credentials_store="file"',
  "-c",
  'web_search="disabled"',
  "-c",
  "project_doc_max_bytes=0",
  ...[
    "shell_tool",
    "shell_snapshot",
    "apps",
    "plugins",
    "hooks",
    "browser_use",
    "computer_use",
    "image_generation",
    "view_image",
    "multi_agent",
    "remote_plugin",
    "code_mode_host",
    "workspace_dependencies",
    "daemon_auto_start",
  ].flatMap((f) => ["-c", `features.${f}=false`]),
];
export async function executarCliCodex(
  args: string[],
  cwd: string,
  input = "",
  signal?: AbortSignal,
  timeoutMs = 180000,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("Análise interrompida."));
    const child = spawn(process.execPath, [cli, ...args], {
      cwd,
      env: ambienteCodex(),
      shell: false,
      windowsHide: true,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      failure: Error | null = null;
    const stop = (message: string) => {
      failure ||= new Error(message);
      try {
        if (process.platform !== "win32" && child.pid)
          process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        /* already closed */
      }
    };
    const abort = () => stop("Análise interrompida. Tente novamente.");
    const timer = setTimeout(
      () => stop("O Codex excedeu o tempo de análise. Tente novamente."),
      timeoutMs,
    );
    signal?.addEventListener("abort", abort, { once: true });
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.length > 2_000_000)
        stop("Resposta do Codex excedeu o limite.");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
      if (stderr.length > 2_000_000) stop("Saída do Codex excedeu o limite.");
    });
    child.on("error", () => {
      cleanup();
      reject(
        new Error(
          "Não foi possível iniciar o Codex. Execute npm run install:all no servidor.",
        ),
      );
    });
    child.on("close", (code) => {
      cleanup();
      if (failure) reject(failure);
      else resolve({ code: code ?? 1, stdout, stderr });
    });
    child.stdin.on("error", () => {
      /* CLI may exit before reading the prompt */
    });
    child.stdin.end(input);
  });
}
export async function verificarConexaoCodex() {
  try {
    await fs.mkdir(codexHome(), { recursive: true, mode: 0o700 });
    await fs.access(cli);
    const r = await executarCliCodex(
      [
        "-c",
        'cli_auth_credentials_store="file"',
        "login",
        "status",
      ],
      os.tmpdir(),
      "",
      undefined,
      15000,
    );
    const conectado = r.code === 0 && /chatgpt/i.test(r.stdout + r.stderr);
    return {
      instalado: true,
      conectado,
      mensagem: conectado
        ? "Conectado ao Codex com a conta ChatGPT."
        : "Conecte sua conta no servidor: npm run codex:login --prefix server",
    };
  } catch {
    return {
      instalado: false,
      conectado: false,
      mensagem:
        "Não foi possível verificar o Codex. Confira a instalação e a permissão do usuário do servidor.",
    };
  }
}
export async function analisarComCodex(
  texto: string,
  tipoDocumento: string,
  signal?: AbortSignal,
) {
  if (texto.length > 120000)
    throw new Error(
      "Publicação muito extensa para esta análise (limite de 120 mil caracteres). Confira o inteiro teor; o texto não foi truncado.",
    );
  if (!(await verificarConexaoCodex()).conectado)
    throw new Error(
      "Codex sem conexão ChatGPT. Execute npm run codex:login --prefix server com o mesmo usuário do PM2.",
    );
  const workdir = await fs.mkdtemp(path.join(os.tmpdir(), "djen-codex-"));
  try {
    const schema = path.join(workdir, "schema.json"),
      output = path.join(workdir, "analise.json");
    await fs.writeFile(schema, JSON.stringify(ESQUEMA_ANALISE_CODEX), {
      mode: 0o600,
    });
    const r = await executarCliCodex(
      [
        "exec",
        ...CONFIG_CODEX,
        "--ignore-rules",
        "--ephemeral",
        "--skip-git-repo-check",
        "--sandbox",
        "read-only",
        "--color",
        "never",
        "--output-schema",
        schema,
        "-o",
        output,
        "-",
      ],
      workdir,
      promptAnaliseCodex(texto, tipoDocumento),
      signal,
    );
    if (r.code !== 0) {
      // Nunca retornar stderr bruto: pode conter o texto do processo e detalhes da sessão.
      if (
        /rate.limit|usage.limit|quota|limit.*reached|try again at/i.test(
          r.stderr,
        )
      )
        throw new Error(
          "Limite de uso do Codex atingido. Aguarde a liberação e retome as análises.",
        );
      throw new Error(
        "O Codex não concluiu a análise. Confira a conexão, os limites da conta e o acesso à internet; depois retome a fila.",
      );
    }
    let parsed: unknown;
    try {
      const stat = await fs.stat(output);
      if (stat.size > 100000) throw new Error("Saída excessiva.");
      parsed = JSON.parse(await fs.readFile(output, "utf8"));
    } catch {
      throw new Error(
        "O Codex não retornou uma análise JSON válida. Tente novamente.",
      );
    }
    return validarAnaliseCodex(parsed, texto);
  } finally {
    await fs.rm(workdir, { recursive: true, force: true });
  }
}
