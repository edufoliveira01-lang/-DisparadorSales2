import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { abrirBancoPainel, type Banco } from "../src/painel/banco";
import { lerConfigPainel, type ConfigPainel } from "../src/painel/config";
import type { ProvedorCobranca } from "../src/painel/asaas";
import { ServicoPainel } from "../src/painel/servico";
import { criarAppPainel } from "../src/painel/app";
import { garantirAdmin } from "../src/painel/auth";
import { Provisionador, ErroProvisionamento, type Executor } from "../src/painel/provisionador";
import { gerarParDeChaves } from "../src/licenca/token";

const par = gerarParDeChaves();
const semCobranca: ProvedorCobranca = { nome: "x", configurado: () => false } as unknown as ProvedorCobranca;

let tmp: string;
let cfg: ConfigPainel;
let chamadas: string[][];
let falhas: Record<string, ResultadoFalso>;
type ResultadoFalso = { code: number; stdout?: string; stderr?: string };
let pm2Lista: string[];

/** Executor falso: simula instancia-aplicar.sh (cria o .env), pm2 e sudo/nginx. */
const executor: Executor = async (cmd, args) => {
  chamadas.push([cmd, ...args]);
  const chave = [cmd, ...args.slice(0, 2)].join(" ");
  for (const [padrao, r] of Object.entries(falhas)) if (chave.includes(padrao)) return { code: r.code, stdout: r.stdout || "", stderr: r.stderr || "" };
  if (cmd === "bash") {
    const [, slug, porta, arq] = args;
    const dir = path.join(cfg.instanciasDir, slug);
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    fs.copyFileSync(arq, path.join(dir, ".env"));
    pm2Lista.push(`dz-${slug}`);
    return { code: 0, stdout: `ok ${porta}`, stderr: "" };
  }
  if (cmd === "pm2" && args[0] === "jlist") return { code: 0, stdout: JSON.stringify(pm2Lista.map((name) => ({ name, pm2_env: { status: "online" } }))), stderr: "" };
  if (cmd === "pm2" && args[0] === "delete") { pm2Lista = pm2Lista.filter((n) => n !== args[1]); return { code: 0, stdout: "", stderr: "" }; }
  if (cmd === "pm2" && args[0] === "start") { pm2Lista.push(args[args.indexOf("--name") + 1]); return { code: 0, stdout: "", stderr: "" }; }
  return { code: 0, stdout: "", stderr: "" };
};

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dz-prov-"));
  cfg = lerConfigPainel({
    PAINEL_BASE_DOMAIN: "exemplo.com.br", PAINEL_PUBLIC_URL: "https://painel.exemplo.com.br", PAINEL_ADMIN_PASSWORD: "senha-forte-12345",
    PAINEL_DATA_DIR: path.join(tmp, "painel", "data"), PAINEL_INSTANCIAS_DIR: path.join(tmp, "inst"), PAINEL_APP_DIR: path.join(tmp, "app"),
    PAINEL_AUTO_PROVISIONAR: "1", PAINEL_PORTA_INICIAL: "3401",
  } as NodeJS.ProcessEnv);
  chamadas = []; falhas = {}; pm2Lista = [];
});
afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const envDe = (slug: string, porta: number) => `OFFICE_ID=${slug}\nPORT=${porta}\nINITIAL_ADMIN_PASSWORD=SenhaInicial123\nLICENSE_KEY=dz_${"a".repeat(30)}\nENCRYPTION_KEY=${"b".repeat(64)}\n`;

describe("Provisionador", () => {
  it("escolhe portas livres considerando mapa, instâncias no disco e as já registradas", () => {
    const p = new Provisionador(cfg, executor);
    expect(p.alocarPorta()).toBe(3401);
    fs.mkdirSync(path.join(cfg.instanciasDir, "velho"), { recursive: true });
    fs.writeFileSync(path.join(cfg.instanciasDir, "velho", ".env"), "PORT=3401\n");
    expect(p.alocarPorta()).toBe(3402);
    expect(p.alocarPorta(undefined, [3402, 3403])).toBe(3404);
    expect(() => p.alocarPorta(3401)).toThrow(/em uso/);
    expect(() => p.alocarPorta(80)).toThrow(/inválida/);
    expect(p.alocarPorta(3500)).toBe(3500);
  });

  it("cria a instância, registra no mapa e recarrega o Nginx só com os comandos liberados", async () => {
    const p = new Provisionador(cfg, executor);
    const r = await p.criarInstancia("banca-alfa", 3401, envDe("banca-alfa", 3401));
    expect(r).toMatchObject({ url: "https://banca-alfa.exemplo.com.br", porta: 3401, senhaInicial: "SenhaInicial123", adotada: false });
    expect(fs.readFileSync(cfg.nginxMapaArquivo, "utf8")).toContain("banca-alfa.exemplo.com.br 3401;");
    expect(chamadas.some((c) => c[0] === "sudo" && c[1] === "-n" && c[3] === "-t")).toBe(true);
    expect(chamadas.some((c) => c[0] === "sudo" && c.slice(3).join(" ") === "reload nginx")).toBe(true);
    // o arquivo temporário com segredos não sobra
    expect(fs.readdirSync(cfg.dadosDir).filter((n) => n.startsWith("tmp-"))).toEqual([]);
    expect(await p.statusInstancia("banca-alfa")).toBe("online");
  });

  it("não recria instância existente: preserva o .env e apenas adota", async () => {
    const p = new Provisionador(cfg, executor);
    const dir = path.join(cfg.instanciasDir, "ja-existe");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".env"), "PORT=3777\nENCRYPTION_KEY=segredo-antigo\n");
    const r = await p.criarInstancia("ja-existe", 3401, envDe("ja-existe", 3401));
    expect(r).toMatchObject({ adotada: true, porta: 3777, senhaInicial: null });
    expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toContain("segredo-antigo");
    expect(chamadas.some((c) => c[0] === "bash")).toBe(false);
    expect(chamadas.some((c) => c[0] === "pm2" && c[1] === "start")).toBe(true);
    expect(p.lerMapa().get("ja-existe.exemplo.com.br")).toBe(3777);
  });

  it("restaura o mapa quando o Nginx recusa a configuração", async () => {
    const p = new Provisionador(cfg, executor);
    await p.criarInstancia("primeiro", 3401, envDe("primeiro", 3401));
    const antes = fs.readFileSync(cfg.nginxMapaArquivo, "utf8");
    falhas["sudo -n"] = { code: 1, stderr: "nginx: [emerg] erro" };
    await expect(p.criarInstancia("segundo", 3402, envDe("segundo", 3402))).rejects.toThrow(/Nginx/);
    expect(fs.readFileSync(cfg.nginxMapaArquivo, "utf8")).toBe(antes);
  });

  it("informa falha do script de criação sem registrar o endereço", async () => {
    const p = new Provisionador(cfg, executor);
    falhas["bash"] = { code: 1, stderr: "ERRO: A porta 3401 já está em uso." };
    await expect(p.criarInstancia("falhou", 3401, envDe("falhou", 3401))).rejects.toThrow(/já está em uso/);
    expect(p.lerMapa().has("falhou.exemplo.com.br")).toBe(false);
    expect(fs.readdirSync(cfg.dadosDir).filter((n) => n.startsWith("tmp-"))).toEqual([]);
  });

  it("remove do ar mantendo os dados e troca a chave de licença no .env", async () => {
    const p = new Provisionador(cfg, executor);
    await p.criarInstancia("saindo", 3401, envDe("saindo", 3401));
    const nova = `dz_${"z".repeat(30)}`;
    await p.atualizarChave("saindo", nova);
    expect(fs.readFileSync(path.join(cfg.instanciasDir, "saindo", ".env"), "utf8")).toContain(`LICENSE_KEY=${nova}`);
    expect(chamadas.some((c) => c[0] === "pm2" && c[1] === "restart" && c[2] === "dz-saindo")).toBe(true);
    await p.remover("saindo");
    expect(await p.statusInstancia("saindo")).toBe("ausente");
    expect(p.lerMapa().has("saindo.exemplo.com.br")).toBe(false);
    expect(fs.existsSync(path.join(cfg.instanciasDir, "saindo", ".env"))).toBe(true);
    await expect(p.atualizarChave("saindo", "chave-ruim")).rejects.toBeInstanceOf(ErroProvisionamento);
    await expect(p.criarInstancia("../x", 3402, "")).rejects.toThrow(/inválido/);
  });
});

describe("API do painel com provisionamento automático", () => {
  let db: Banco; let server: Server; let base: string;
  beforeEach(async () => {
    db = abrirBancoPainel(":memory:");
    await garantirAdmin(db, cfg);
    const servico = new ServicoPainel(db, cfg, semCobranca, par.privada);
    server = criarAppPainel({ db, cfg, servico, chavePublicaPem: par.publica, versao: "test", webDir: __dirname, provisionador: new Provisionador(cfg, executor) }).listen(0);
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterEach(() => { server.close(); db.close(); });
  const entrar = async () => {
    const r = await fetch(`${base}/api/admin/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usuario: "admin", senha: "senha-forte-12345" }) });
    return (r.headers.get("set-cookie") || "").split(";")[0];
  };
  const adm = (cookie: string, metodo: string, caminho: string, corpo?: unknown) => fetch(`${base}/api/admin${caminho}`, { method: metodo, headers: { "Content-Type": "application/json", Cookie: cookie, "X-Requested-With": "painel" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
  const novo = { nome: "Banca Beta", slug: "banca-beta", email: "beta@exemplo.com", cortesia: true };

  it("criar o escritório já entrega o sistema no ar, com link e senha inicial", async () => {
    const c = await entrar();
    const r = await adm(c, "POST", "/escritorios", novo);
    expect(r.status).toBe(201);
    const j = await r.json() as { instancia: { ok: boolean; url: string; senha_inicial: string }; escritorio: { id: string } };
    expect(j.instancia).toMatchObject({ ok: true, url: "https://banca-beta.exemplo.com.br" });
    expect(j.instancia.senha_inicial.length).toBeGreaterThan(10);
    const env = fs.readFileSync(path.join(cfg.instanciasDir, "banca-beta", ".env"), "utf8");
    expect(env).toContain("LICENSE_SERVER_URL=http://127.0.0.1:3340"); // instância no mesmo servidor fala com o painel localmente
    expect(env).toContain("PORT=3401");
    const st = await (await adm(c, "GET", `/escritorios/${j.escritorio.id}/instancia`)).json() as { status: string; porta: number; no_mapa: boolean };
    expect(st).toMatchObject({ status: "online", porta: 3401, no_mapa: true });
    // segundo escritório pega a próxima porta
    const r2 = await (await adm(c, "POST", "/escritorios", { ...novo, nome: "Banca Gama", slug: "banca-gama", email: "g@exemplo.com" })).json() as { instancia: { ok: boolean } };
    expect(r2.instancia.ok).toBe(true);
    expect(fs.readFileSync(path.join(cfg.instanciasDir, "banca-gama", ".env"), "utf8")).toContain("PORT=3402");
  });

  it("usa o usuário e a senha inicial informados e exige a troca no primeiro acesso", async () => {
    const c = await entrar();
    const ruim = await adm(c, "POST", "/escritorios", { ...novo, admin_senha: "curta" });
    expect(ruim.status).toBe(400);
    expect((await adm(c, "POST", "/escritorios", { ...novo, admin_usuario: "a b" })).status).toBe(400);
    const j = await (await adm(c, "POST", "/escritorios", { ...novo, admin_usuario: "dra.maria", admin_senha: "SenhaTemporaria99" })).json() as { instancia: { ok: boolean; usuario: string; senha_inicial: string } };
    expect(j.instancia).toMatchObject({ ok: true, usuario: "dra.maria", senha_inicial: "SenhaTemporaria99" });
    const env = fs.readFileSync(path.join(cfg.instanciasDir, "banca-beta", ".env"), "utf8");
    expect(env).toContain("INITIAL_ADMIN_USERNAME=dra.maria");
    expect(env).toContain("INITIAL_ADMIN_PASSWORD=SenhaTemporaria99");
    expect(env).toContain("INITIAL_ADMIN_MUST_CHANGE=1");
  });

  it("se a criação falhar, o escritório continua cadastrado e dá para tentar de novo", async () => {
    const c = await entrar();
    falhas["bash"] = { code: 1, stderr: "ERRO: build ausente" };
    const j = await (await adm(c, "POST", "/escritorios", novo)).json() as { instancia: { ok: boolean; erro: string }; escritorio: { id: string } };
    expect(j.instancia.ok).toBe(false);
    expect(j.instancia.erro).toMatch(/build ausente/);
    delete falhas["bash"];
    const r = await (await adm(c, "POST", `/escritorios/${j.escritorio.id}/instancia`, {})).json() as { ok: boolean; senha_inicial: string; url: string };
    expect(r).toMatchObject({ ok: true, url: "https://banca-beta.exemplo.com.br" });
    expect(r.senha_inicial).toBeTruthy();
  });

  it("escritório antigo (criado à mão) é adotado sem mexer nos dados e remover tira do ar", async () => {
    const c = await entrar();
    falhas["bash"] = { code: 1, stderr: "x" };
    const j = await (await adm(c, "POST", "/escritorios", novo)).json() as { escritorio: { id: string } };
    delete falhas["bash"];
    const dir = path.join(cfg.instanciasDir, "banca-beta");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, ".env"), "PORT=3400\nENCRYPTION_KEY=nao-mexer\nLICENSE_KEY=dz_antiga\n");
    const a = await (await adm(c, "POST", `/escritorios/${j.escritorio.id}/instancia`, {})).json() as { adotada: boolean };
    expect(a.adotada).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toContain("nao-mexer");
    // nova chave é aplicada na instância existente, sem blocos manuais
    const nc = await (await adm(c, "POST", `/escritorios/${j.escritorio.id}/nova-chave`, {})).json() as { instancia_atualizada: boolean; chave: string };
    expect(nc.instancia_atualizada).toBe(true);
    expect(fs.readFileSync(path.join(dir, ".env"), "utf8")).toContain(`LICENSE_KEY=${nc.chave}`);
    expect((await adm(c, "POST", `/escritorios/${j.escritorio.id}/instancia/remover`, {})).status).toBe(200);
    const st = await (await adm(c, "GET", `/escritorios/${j.escritorio.id}/instancia`)).json() as { status: string; no_mapa: boolean };
    expect(st).toMatchObject({ status: "ausente", no_mapa: false });
  });
});
