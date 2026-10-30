"use strict";
// Diagnóstico manual: não é executado pelo servidor nem pelo deploy.
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { once } = require("node:events");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));

async function targets() {
  try {
    const response = await fetch("http://127.0.0.1:9229/json/list", {signal: AbortSignal.timeout(1500)});
    return response.ok ? await response.json() : null;
  } catch { return null; }
}

async function collect(pid, duration = 20000, outputFile) {
  const before = await targets();
  const opened = !before?.length;
  if (opened) process.kill(pid, "SIGUSR1");
  let list = before;
  for (let i = 0; !list?.length && i < 40; i++) {
    await pause(250);
    list = await targets();
  }
  const target = list?.find(item => item.webSocketDebuggerUrl);
  if (!target) throw new Error("O diagnóstico local não respondeu. Nenhum serviço foi reiniciado.");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  const pending = new Map();
  let sequence = 0, verified = false, profiling = false;
  function call(method, params = {}, timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error("Tempo esgotado: " + method));
      }, timeoutMs);
      pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); }
      });
      ws.send(JSON.stringify({id, method, params}));
    });
  }
  ws.addEventListener("message", event => {
    const response = JSON.parse(String(event.data));
    const item = pending.get(response.id);
    if (!item) return;
    pending.delete(response.id);
    if (response.error) item.reject(new Error(response.error.message));
    else item.resolve(response.result);
  });
  ws.addEventListener("close", () => {
    for (const item of pending.values()) item.reject(new Error("Conexão de diagnóstico encerrada."));
    pending.clear();
  });
  try {
    await Promise.race([
      once(ws, "open"),
      pause(10000).then(() => { throw new Error("Timeout ao conectar ao diagnóstico local."); })
    ]);
    const check = await call("Runtime.evaluate", {expression: "process.pid", returnByValue: true});
    if (check.result?.value !== pid) throw new Error("A porta de diagnóstico pertence a outro processo; coleta cancelada.");
    verified = true;
    await call("Profiler.enable");
    await call("Profiler.setSamplingInterval", {interval: 2000});
    await call("Profiler.start");
    profiling = true;
    console.log("Coletando CPU por " + duration / 1000 + " segundos, sem reiniciar...");
    await pause(duration);
    const { profile } = await call("Profiler.stop");
    profiling = false;
    if (outputFile) {
      fs.mkdirSync(path.dirname(outputFile), {recursive: true, mode: 0o700});
      fs.writeFileSync(outputFile, JSON.stringify(profile), {mode: 0o600, flag: "wx"});
      console.log("Perfil salvo em: " + outputFile);
    }
    return profile;
  } finally {
    if (verified && profiling && ws.readyState === WebSocket.OPEN) {
      await call("Profiler.stop", {}, 3000).catch(() => {});
    }
    if (verified && opened && ws.readyState === WebSocket.OPEN) {
      await call("Runtime.evaluate", {
        expression: "setTimeout(() => process.getBuiltinModule('node:inspector').close(), 100).unref(); true",
        returnByValue: true
      }, 3000).catch(() => {});
    }
    ws.close();
  }
}

function summarize(profile) {
  const nodes = new Map(profile.nodes.map(node => [node.id, node]));
  const parent = new Map();
  for (const node of profile.nodes) for (const child of node.children || []) parent.set(child, node.id);
  const self = new Map(), inclusive = new Map();
  let total = 0;
  for (let i = 0; i < (profile.samples || []).length; i++) {
    const id = profile.samples[i], time = profile.timeDeltas?.[i] || 2000;
    total += time;
    self.set(id, (self.get(id) || 0) + time);
    for (let cursor = id; cursor !== undefined; cursor = parent.get(cursor)) {
      inclusive.set(cursor, (inclusive.get(cursor) || 0) + time);
    }
  }
  function table(title, values, onlyApplication) {
    console.log("\n" + title);
    let shown = 0;
    for (const [id, time] of [...values].sort((a,b) => b[1] - a[1])) {
      const frame = nodes.get(id)?.callFrame;
      if (!frame) continue;
      if (onlyApplication && (!frame.url.includes("/server/dist/") || frame.url.includes("/node_modules/"))) continue;
      console.log((100 * time / (total || 1)).toFixed(1).padStart(5) + "% | " +
        (frame.functionName || "(anônimo)") + " | " +
        frame.url.replace("file://", "").replace("/home/dropsales/disparador-sales2/", "") +
        ":" + (frame.lineNumber + 1));
      if (++shown === 15) break;
    }
  }
  table("TEMPO DIRETO NAS FUNÇÕES", self, false);
  table("FUNÇÕES DO SISTEMA, INCLUINDO CHAMADAS INTERNAS (percentuais não somam 100%)", inclusive, true);
}

if (require.main === module) {
  (async () => {
    const raw = execFileSync("pm2", ["pid", "disparador-backend"], {encoding: "utf8"}).trim();
    if (!/^[1-9]\d*$/.test(raw)) throw new Error("Backend não está em execução ou há mais de uma instância.");
    const pid = Number(raw);
    const command = fs.readFileSync("/proc/" + pid + "/cmdline", "utf8");
    if (!command.includes("/home/dropsales/disparador-sales2/server/dist/index.js")) {
      throw new Error("O PID não corresponde ao backend esperado; nada alterado.");
    }
    const output = "/home/dropsales/disparazap-backups/diagnosticos/cpu-" + Date.now() + ".cpuprofile";
    summarize(await collect(pid, 20000, output));
    console.log("\nColeta concluída. Envie somente o resumo deste terminal.");
  })().catch(error => { console.error("Diagnóstico:", error.message); process.exitCode = 1; });
}
module.exports = {collect, summarize};
