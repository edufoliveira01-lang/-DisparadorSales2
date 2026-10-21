import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocked = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => ({ spawn: mocked.spawn }));
import {
  ambienteCodex,
  CONFIG_CODEX,
  executarCliCodex,
  analisarComCodex,
  dividirPublicacao,
  verificarConexaoCodex,
  invalidarConexaoCodex,
} from "../src/services/djen/codexRunner";
const laudo = "O laudo pericial foi juntado aos autos.";
function child() {
  const c = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  c.stdin = new PassThrough();
  c.stdin.resume();
  c.stdout = new PassThrough();
  c.stderr = new PassThrough();
  c.kill = vi.fn(() => {
    queueMicrotask(() => c.emit("close", 1));
    return true;
  });
  return c;
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("execução restrita do Codex CLI", () => {
  it("compartilha a checagem de login e reaproveita conexão válida entre análises", async () => {
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "djen-cache-test-"));
    vi.stubEnv("DJEN_CODEX_HOME", home);
    invalidarConexaoCodex();
    mocked.spawn.mockImplementation((_node: string, args: string[]) => {
      const c = child();
      c.stdin.on("finish", () => {
        if (args.includes("--version")) c.stdout.write("codex-cli 0.163.0");
        else c.stderr.write("Logged in using ChatGPT");
        c.emit("close", 0);
      });
      return c;
    });
    try {
      const r = await Promise.all([
        verificarConexaoCodex(),
        verificarConexaoCodex(),
      ]);
      expect(r.every((c) => c.conectado)).toBe(true);
      expect(mocked.spawn).toHaveBeenCalledTimes(2);
      await verificarConexaoCodex();
      expect(mocked.spawn).toHaveBeenCalledTimes(2);
      await verificarConexaoCodex(true);
      expect(mocked.spawn).toHaveBeenCalledTimes(4);
    } finally {
      invalidarConexaoCodex();
      await fs.rm(home, { recursive: true, force: true });
    }
  });

  it("é compatível com o binário instalado, sem autenticação nem chamada de IA", async () => {
    const real =
      await vi.importActual<typeof import("node:child_process")>(
        "node:child_process",
      );
    let diagnostic = "";
    mocked.spawn.mockImplementation(
      (...args: Parameters<typeof real.spawn>) => {
        const c = real.spawn(...args);
        c.stderr?.on("data", (d) => {
          diagnostic += d.toString();
        });
        return c;
      },
    );
    const home = await fs.mkdtemp(path.join(os.tmpdir(), "djen-codex-compat-"));
    vi.stubEnv("DJEN_CODEX_HOME", home);
    try {
      expect(await verificarConexaoCodex()).toMatchObject({
        instalado: true,
        conectado: false,
      });
      expect(diagnostic).toMatch(/Not logged in/);
      expect(diagnostic).not.toMatch(/unexpected argument/);
      const help = await executarCliCodex(
        ["exec", ...CONFIG_CODEX, "--help"],
        os.tmpdir(),
        "",
        undefined,
        5000,
      );
      expect(help.code).toBe(0);
      expect(help.stdout).toContain("--output-schema");
    } finally {
      await fs.rm(home, { recursive: true, force: true });
    }
  });
  it("não herda API keys ou tokens das integrações do servidor", () => {
    for (const name of [
      "OPENAI_API_KEY",
      "CODEX_API_KEY",
      "CODEX_ACCESS_TOKEN",
      "WHAPI_TOKEN",
      "OPENAI_BASE_URL",
      "OPENAI_FEDERATION_RULE_ID",
    ])
      vi.stubEnv(name, "segredo-sintetico-de-teste");
    const env = ambienteCodex();
    expect(env.CODEX_HOME).toBeTruthy();
    expect(Object.values(env)).not.toContain("segredo-sintetico-de-teste");
    expect(CONFIG_CODEX).toContain('forced_login_method="chatgpt"');
    expect(CONFIG_CODEX).toContain("features.shell_tool=false");
    expect(CONFIG_CODEX).toContain("features.multi_agent=false");
  });
  it("passa conteúdo pelo stdin sem shell ou interpolação de comando", async () => {
    const c = child();
    let input = "";
    c.stdin.on("data", (d) => {
      input += d;
    });
    mocked.spawn.mockReturnValueOnce(c);
    const job = executarCliCodex(
      ["exec", "-"],
      "/tmp",
      "Texto $(nao-executar); `comando` ",
    );
    c.emit("close", 0);
    await job;
    expect(input).toContain("$(nao-executar)");
    const options = mocked.spawn.mock.calls[0][2];
    expect(options.shell).toBe(false);
    expect(mocked.spawn.mock.calls[0][1]).not.toContain(input);
  });
  it("timeout encerra a execução e retorna erro legível", async () => {
    const c = child();
    mocked.spawn.mockReturnValueOnce(c);
    await expect(
      executarCliCodex(["exec", "-"], "/tmp", "", undefined, 5),
    ).rejects.toThrow(/tempo/);
    expect(c.kill).toHaveBeenCalled();
  });
  it("lembra cancelar o processo quando a solicitação é interrompida", async () => {
    const c = child();
    mocked.spawn.mockReturnValueOnce(c);
    const controller = new AbortController();
    const job = executarCliCodex(["exec", "-"], "/tmp", "", controller.signal);
    controller.abort();
    await expect(job).rejects.toThrow(/interrompida/);
    expect(c.kill).toHaveBeenCalled();
  });
  it("divide publicação extensa sem perder o começo, meio ou final", () => {
    const texto =
      "INÍCIO\n" +
      "Publicação judicial extensa.\n".repeat(8000) +
      "FINAL DA PUBLICAÇÃO";
    const partes = dividirPublicacao(texto);
    expect(partes.length).toBeGreaterThan(3);
    expect(partes.every((p) => p.length <= 60000)).toBe(true);
    let reconstruido = partes[0];
    for (const p of partes.slice(1)) reconstruido += p.slice(1500);
    expect(reconstruido).toBe(texto);
    expect(partes.at(-1)).toContain("FINAL DA PUBLICAÇÃO");
  });
  it("executa o contrato CLI completo e limpa arquivos temporários", async () => {
    const jobs: { args: string[]; cwd: string }[] = [];
    mocked.spawn.mockImplementation(
      (_node: string, args: string[], options: { cwd: string }) => {
        const c = child();
        jobs.push({ args, cwd: options.cwd });
        c.stdin.on("finish", () => {
          void (async () => {
            if (args.includes("--version")) c.stdout.write("codex-cli 0.163.0");
            else if (args.includes("status"))
              c.stderr.write("Logged in using ChatGPT");
            else {
              const output = args[args.indexOf("-o") + 1];
              await fs.writeFile(
                output,
                JSON.stringify({
                  categorias: ["laudo_juntado"],
                  resultado: "nao_identificado",
                  resumo: "Laudo juntado.",
                  justificativa: "Juntada confirmada no texto.",
                  evidencias: [{ categoria: "laudo_juntado", trecho: laudo }],
                  agendamento: { data: null, horario: null, local: null },
                  alertas: [],
                }),
              );
            }
            c.emit("close", 0);
          })();
        });
        return c;
      },
    );
    const authHome = await fs.mkdtemp(
      path.join(os.tmpdir(), "djen-codex-test-"),
    );
    vi.stubEnv("DJEN_CODEX_HOME", authHome);
    const textoLongo = (laudo + "\n").repeat(4000);
    const r = await analisarComCodex(textoLongo, "Intimação");
    expect(jobs.filter((j) => j.args.includes("exec")).length).toBeGreaterThan(
      3,
    );
    expect(r.alertas.join(" ")).toContain("trechos");
    expect(r.categorias).toEqual(["laudo_juntado"]);
    const exec = jobs.find((j) => j.args.includes("exec"))!;
    expect(exec.args).toContain("--output-schema");
    expect(exec.args).toContain("read-only");
    expect(exec.cwd).not.toContain("DisparadorSales2");
    await expect(fs.access(exec.cwd)).rejects.toThrow();
    await fs.rm(authHome, { recursive: true, force: true });
  });
});
