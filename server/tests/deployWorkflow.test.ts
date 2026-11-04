import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";

const roots: string[] = [];
afterEach(() => { for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(versionOnly = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "deploy-workflow-")); roots.push(root);
  const source = path.join(root, "source"), app = path.join(root, "app"), web = path.join(root, "web");
  const write = (name: string, value: string) => { fs.mkdirSync(path.dirname(name), { recursive: true }); fs.writeFileSync(name, value); };
  const git = (cwd: string, ...args: string[]) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  fs.mkdirSync(source);
  git(source, "init", "-b", "main"); git(source, "config", "user.name", "Test"); git(source, "config", "user.email", "test@example.invalid");
  write(path.join(source, ".gitignore"), "node_modules/\ndist/\ndata/\n");
  write(path.join(source, "package.json"), '{"name":"fixture","version":"1.0.0"}');
  const localLock = (version: string) => JSON.stringify({ version, packages: { "": { version }, "..": { name: "disparador-pericias", version } } });
  write(path.join(source, "server/package-lock.json"), localLock("1.0.0"));
  write(path.join(source, "client/package-lock.json"), localLock("1.0.0"));
  write(path.join(source, "server/src/index.ts"), "old-server"); write(path.join(source, "client/src/index.html"), "old-interface");
  git(source, "add", "."); git(source, "commit", "-qm", "old");
  const previous = git(source, "rev-parse", "HEAD");
  execFileSync("git", ["clone", source, app], { stdio: "pipe" });
  if (versionOnly) {
    write(path.join(source, "package.json"), '{"name":"fixture","version":"1.0.1"}');
    write(path.join(source, "server/package-lock.json"), localLock("1.0.1"));
    write(path.join(source, "client/package-lock.json"), localLock("1.0.1"));
  } else {
    write(path.join(source, "server/src/index.ts"), "new-server"); write(path.join(source, "client/src/index.html"), "new-interface");
  }
  git(source, "add", "."); git(source, "commit", "-qm", "new");
  const target = git(source, "rev-parse", "HEAD");
  for (const folder of ["node_modules", "server/node_modules", "client/node_modules"]) write(path.join(app, folder, "cached"), "cache");
  write(path.join(app, "server/dist/index.js"), "old-server");
  write(path.join(app, "server/data/preserve.txt"), "office-data");
  write(path.join(web, "index.html"), "old-interface");
  const bin = path.join(root, "bin"), trace = path.join(root, "trace");
  const executable = (name: string, code: string) => { const p = path.join(bin, name); write(p, `#!/bin/bash\nset -e\n${code}\n`); fs.chmodSync(p, 0o755); };
  executable("npm", `echo "npm $*" >> "$TRACE"
    case "$*" in
      'test --prefix server') test -n "$DATA_DIR"; test "$DATA_DIR" != "$APP_TEST/server/data"; if [ "$TEST_FAIL" = 1 ]; then exit 9; fi ;;
      'run build --prefix server') mkdir -p server/dist; cp server/src/index.ts server/dist/index.js ;;
      'run build --prefix client') mkdir -p client/dist; cp client/src/index.html client/dist/index.html ;;
    esac`);
  executable("pm2", 'echo "pm2 $*" >> "$TRACE"');
  executable("pgrep", "exit 1"); executable("sleep", ":");
  executable("curl", `echo "curl" >> "$TRACE"
    n=0; if [ -f "$CURL_COUNT" ]; then n=$(cat "$CURL_COUNT"); fi
    n=$((n+1)); echo "$n" > "$CURL_COUNT"
    if [ "$HEALTH_FAIL" = 1 ] && [ "$n" -le 30 ]; then exit 22; fi
    echo '{"ok":true}'`);
  const yaml = fs.readFileSync(path.resolve(__dirname, "../../.github/workflows/deploy-ubuntu.yml"), "utf8");
  let script = yaml.split("        run: |\n")[1].split("\n").map((line) => line.startsWith("          ") ? line.slice(10) : line).join("\n");
  script = script.replaceAll("/home/dropsales/disparador-sales2", app)
    .replaceAll("/home/dropsales/disparazap-backups", path.join(root, "backups"))
    .replaceAll("/home/dropsales/disparazap-build-", path.join(root, "build-"))
    .replaceAll("/home/dropsales/.disparazap-deploy.lock", path.join(root, "lock"))
    .replaceAll("/home/dropsales/.pm2", path.join(root, "pm2"))
    .replaceAll("/home/dropsales/.cache/disparazap-tmp", path.join(root, "tmp"))
    .replaceAll("/var/www/disparazap", web).replaceAll("-C /var/www disparazap", `-C '${root}' web`).replaceAll("-C /var/www", `-C '${root}'`);
  const scriptPath = path.join(root, "deploy.sh"); write(scriptPath, script);
  return {
    run: (extra: Record<string, string> = {}) => spawnSync("bash", [scriptPath], { cwd: root, encoding: "utf8", timeout: 20_000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_SHA: target, TRACE: trace, APP_TEST: app, CURL_COUNT: path.join(root, "curl-count"), TEST_FAIL: "0", HEALTH_FAIL: "0", ...extra } }),
    read: (file: string) => fs.readFileSync(path.join(app, file), "utf8"),
    web: () => fs.readFileSync(path.join(web, "index.html"), "utf8"),
    head: () => git(app, "rev-parse", "HEAD"), previous, target,
    trace: () => fs.existsSync(trace) ? fs.readFileSync(trace, "utf8") : "",
  };
}

describe("publicação seletiva com testes e restauração", () => {
  it("não reinstala bibliotecas quando muda apenas a versão do projeto e do vínculo file:..", () => {
    const f = fixture(true), result = f.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.trace()).not.toMatch(/npm (ci|install)/);
  });
  it("executa os testes antes de parar o serviço e publica somente após aprovação dos checks", () => {
    const f = fixture(), result = f.run();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(f.head()).toBe(f.target); expect(f.read("server/dist/index.js")).toBe("new-server"); expect(f.web()).toBe("new-interface");
    expect(f.trace().indexOf("npm test")).toBeLessThan(f.trace().indexOf("pm2 stop"));
    expect(f.read("server/data/preserve.txt")).toBe("office-data");
  });
  it("uma falha de teste deixa a versão publicada e o processo intactos", () => {
    const f = fixture(), result = f.run({ TEST_FAIL: "1" });
    expect(result.status).not.toBe(0); expect(f.head()).toBe(f.previous);
    expect(f.trace()).not.toContain("pm2 stop"); expect(f.web()).toBe("old-interface");
  });
  it("restaura código, artefatos e interface quando a API nova falha, sem apagar dados", () => {
    const f = fixture(), result = f.run({ HEALTH_FAIL: "1" });
    expect(result.status, result.stdout + result.stderr).not.toBe(0);
    expect(result.stdout + result.stderr).toContain("Versão anterior restaurada");
    expect(f.head()).toBe(f.previous); expect(f.read("server/dist/index.js")).toBe("old-server"); expect(f.web()).toBe("old-interface");
    expect(f.read("server/data/preserve.txt")).toBe("office-data");
  });
});
