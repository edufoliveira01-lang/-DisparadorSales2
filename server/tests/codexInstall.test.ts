import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureCodex } from "../scripts/ensure-codex.cjs";
let serverDir: string;
const healthy = { status: 0, stdout: "codex-cli 0.163.0\n", stderr: "" };
const missing = {
  status: 1,
  stdout: "",
  stderr: "Error: Missing optional dependency @openai/codex-linux-x64",
};
const log = vi.fn(),
  error = vi.fn();
beforeEach(() => {
  serverDir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-install-test-"));
  const dir = path.join(serverDir, "node_modules/@openai/codex");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify({
      optionalDependencies: {
        "@openai/codex-linux-x64": "npm:@openai/codex@0.163.0-linux-x64",
      },
    }),
  );
  vi.clearAllMocks();
});
afterEach(() => fs.rmSync(serverDir, { recursive: true, force: true }));
const options = (run: ReturnType<typeof vi.fn>) => ({
  run,
  serverDir,
  platform: "linux",
  arch: "x64",
  log,
  error,
});
describe("instalação do executável Codex", () => {
  it("não reinstala quando a versão local já inicia", () => {
    const run = vi.fn().mockReturnValue(healthy);
    expect(ensureCodex(options(run))).toBe(true);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("recupera dependência omitida usando a versão exata sem salvar manifests", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(missing)
      .mockReturnValueOnce({ status: 0 })
      .mockReturnValueOnce(healthy);
    expect(ensureCodex(options(run))).toBe(true);
    const args = run.mock.calls[1][1];
    expect(args).toContain(
      "@openai/codex-linux-x64@npm:@openai/codex@0.163.0-linux-x64",
    );
    expect(args).toContain("--no-save");
    expect(args).toContain("--ignore-scripts");
    expect(args).toContain("--include=optional");
    expect(args).not.toContain("--package-lock=false");
    expect(args).not.toContain("-g");
    expect(run.mock.calls[1][2].shell).toBe(false);
  });
  it("não informa sucesso se a instalação falhar", () => {
    const run = vi
      .fn()
      .mockReturnValueOnce(missing)
      .mockReturnValueOnce({ status: 1 });
    expect(ensureCodex(options(run))).toBe(false);
    expect(run).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("instalação do executável falhou"),
    );
  });
  it("não reinstala por erro de permissão ou incompatibilidade", () => {
    const run = vi
      .fn()
      .mockReturnValue({ status: 1, stderr: "Permission denied" });
    expect(ensureCodex(options(run))).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
  it("não aceita pacote de origem diferente da versão do CLI", () => {
    fs.writeFileSync(
      path.join(serverDir, "node_modules/@openai/codex/package.json"),
      JSON.stringify({
        optionalDependencies: {
          "@openai/codex-linux-x64": "https://outro-host.invalid/pacote.tgz",
        },
      }),
    );
    const run = vi.fn().mockReturnValue(missing);
    expect(ensureCodex(options(run))).toBe(false);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
