// Garante o binário da mesma versão do CLI local, sem instalação global ou alteração dos manifests.
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
function ensureCodex({
  serverDir = path.resolve(__dirname, ".."),
  run = spawnSync,
  platform = process.platform,
  arch = process.arch,
  log = console.log,
  error = console.error,
} = {}) {
  const cli = path.join(serverDir, "node_modules/@openai/codex/bin/codex.js");
  const check = () =>
    run(process.execPath, [cli, "--version"], {
      cwd: serverDir,
      encoding: "utf8",
      timeout: 15000,
      maxBuffer: 256000,
      shell: false,
    });
  const ok = (r) => r.status === 0 && /codex-cli\s+\S+/.test(r.stdout || "");
  const initial = check();
  if (ok(initial)) {
    log(`[Codex] ${initial.stdout.trim()} disponível.`);
    return true;
  }
  const os = platform === "android" ? "linux" : platform;
  if (
    !["linux", "darwin", "win32"].includes(os) ||
    !["x64", "arm64"].includes(arch)
  ) {
    error(`[Codex] Plataforma não suportada: ${platform}/${arch}.`);
    return false;
  }
  const pkg = `@openai/codex-${os}-${arch}`;
  let spec;
  try {
    spec = JSON.parse(
      fs.readFileSync(
        path.join(serverDir, "node_modules/@openai/codex/package.json"),
        "utf8",
      ),
    ).optionalDependencies[pkg];
  } catch {
    error(
      "[Codex] Pacote CLI ausente. Execute npm run install:all na raiz do projeto.",
    );
    return false;
  }
  if (
    typeof spec !== "string" ||
    !/^npm:@openai\/codex@\d+\.\d+\.\d+-(?:linux|darwin|win32)-(?:x64|arm64)$/.test(
      spec,
    )
  ) {
    error(
      "[Codex] Dependência de plataforma inválida. Reinstale as dependências do projeto.",
    );
    return false;
  }
  if (
    !/Missing optional dependency/.test(
      (initial.stderr || "") + (initial.stdout || ""),
    )
  ) {
    error(
      "[Codex] O executável não iniciou. Verifique permissões e compatibilidade do servidor.",
    );
    return false;
  }
  log(`[Codex] Instalando o executável ${pkg} da versão fixada no projeto…`);
  // --no-save preserva package.json e package-lock.json. O lock existente continua sendo lido.
  const args = [
    "install",
    "--prefix",
    serverDir,
    "--no-save",
    "--ignore-scripts",
    "--include=optional",
    `${pkg}@${spec}`,
  ];
  const npmCli = process.env.npm_execpath;
  const install = npmCli
    ? run(process.execPath, [npmCli, ...args], {
        cwd: serverDir,
        stdio: "inherit",
        timeout: 180000,
        shell: false,
      })
    : run(platform === "win32" ? "npm.cmd" : "npm", args, {
        cwd: serverDir,
        stdio: "inherit",
        timeout: 180000,
        shell: false,
      });
  if (install.status !== 0) {
    error(
      "[Codex] A instalação do executável falhou. Confira o acesso ao registro npm e execute npm run codex:install --prefix server novamente.",
    );
    return false;
  }
  const final = check();
  if (!ok(final)) {
    error(
      "[Codex] O executável ainda não iniciou após a instalação. Confira permissões e compatibilidade do servidor.",
    );
    return false;
  }
  log(`[Codex] ${final.stdout.trim()} instalado e verificado.`);
  return true;
}
module.exports = { ensureCodex };
if (require.main === module) process.exitCode = ensureCodex() ? 0 : 1;
