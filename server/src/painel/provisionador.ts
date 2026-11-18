/**
 * Provisionamento automático dos escritórios no servidor do painel.
 *
 * O painel executa, com o mesmo usuário do sistema (nunca root):
 *   1. scripts/instancia-aplicar.sh  → cria /srv/disparazap/<slug>/ e inicia dz-<slug> no PM2;
 *   2. grava <slug>.<domínio> → porta no arquivo "mapa" lido por um único bloco curinga do Nginx
 *      (por isso escritório novo NÃO exige arquivo nem alteração manual no Nginx);
 *   3. testa (nginx -t) e recarrega o Nginx via sudo restrito a esses dois comandos.
 *
 * Instância existente nunca é recriada: o .env dela (com a chave de criptografia dos dados)
 * é preservado e apenas "adotado" (porta lida do arquivo, mapa e PM2 conferidos).
 */
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { ConfigPainel } from "./config";

export interface ResultadoComando { code: number; stdout: string; stderr: string }
export type Executor = (cmd: string, args: string[], opcoes?: { env?: NodeJS.ProcessEnv; cwd?: string; timeoutMs?: number }) => Promise<ResultadoComando>;

export const executorReal: Executor = (cmd, args, opcoes = {}) =>
  new Promise((resolve) => {
    execFile(cmd, args, { env: opcoes.env ?? process.env, cwd: opcoes.cwd, timeout: opcoes.timeoutMs ?? 120_000, maxBuffer: 2 * 1024 * 1024 }, (erro, stdout, stderr) => {
      const code = erro ? (typeof (erro as NodeJS.ErrnoException & { code?: unknown }).code === "number" ? ((erro as unknown as { code: number }).code) : 1) : 0;
      resolve({ code, stdout: String(stdout || ""), stderr: String(stderr || (erro && !stdout ? erro.message : "")) });
    });
  });

export class ErroProvisionamento extends Error {}
export type StatusInstancia = "online" | "parada" | "ausente";
export interface ResultadoCriacao { url: string; porta: number; usuarioInicial: string | null; senhaInicial: string | null; adotada: boolean; avisos: string[] }

const SLUG = /^[a-z0-9][a-z0-9-]{2,40}[a-z0-9]$/;
const limpar = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 400);

export class Provisionador {
  constructor(private cfg: ConfigPainel, private executar: Executor = executorReal) {}

  get ativo() { return this.cfg.autoProvisionar; }
  private host(slug: string) { return `${slug}.${this.cfg.baseDomain}`; }
  private dir(slug: string) { return path.join(this.cfg.instanciasDir, slug); }
  private conferirSlug(slug: string) { if (!SLUG.test(slug)) throw new ErroProvisionamento("Endereço inválido."); }

  // ---------- mapa host → porta (lido pelo Nginx) ----------
  lerMapa(): Map<string, number> {
    const mapa = new Map<string, number>();
    try {
      for (const linha of fs.readFileSync(this.cfg.nginxMapaArquivo, "utf8").split("\n")) {
        const m = /^\s*([a-z0-9.-]+)\s+(\d{2,5});\s*$/.exec(linha);
        if (m) mapa.set(m[1], Number(m[2]));
      }
    } catch { /* arquivo ainda não existe */ }
    return mapa;
  }
  private gravarMapa(mapa: Map<string, number>) {
    fs.mkdirSync(path.dirname(this.cfg.nginxMapaArquivo), { recursive: true });
    const corpo = ["# Gerado pelo painel. Não edite à mão: host → porta da instância do escritório.", ...[...mapa].sort(([a], [b]) => a.localeCompare(b)).map(([h, p]) => `${h} ${p};`), ""].join("\n");
    const tmp = `${this.cfg.nginxMapaArquivo}.tmp`;
    fs.writeFileSync(tmp, corpo, { mode: 0o644 });
    fs.renameSync(tmp, this.cfg.nginxMapaArquivo);
  }
  private async recarregarNginx(): Promise<void> {
    const teste = await this.executar("sudo", ["-n", this.cfg.nginxBin, "-t"]);
    if (teste.code !== 0) throw new ErroProvisionamento(`O Nginx recusou a configuração: ${limpar(teste.stderr || teste.stdout)}`);
    const rec = await this.executar("sudo", ["-n", this.cfg.systemctlBin, "reload", "nginx"]);
    if (rec.code !== 0) throw new ErroProvisionamento(`Não consegui recarregar o Nginx (sudo não liberado?): ${limpar(rec.stderr || rec.stdout)}`);
  }
  /** Aplica a alteração no mapa e recarrega o Nginx; se falhar, restaura o mapa anterior. */
  private async alterarMapa(alterar: (m: Map<string, number>) => void) {
    const antes = this.lerMapa();
    const depois = new Map(antes);
    alterar(depois);
    if ([...antes].join() === [...depois].join()) return;
    this.gravarMapa(depois);
    try { await this.recarregarNginx(); } catch (e) { this.gravarMapa(antes); throw e; }
  }

  // ---------- portas ----------
  private portasEmUso(): Set<number> {
    const usadas = new Set<number>([...this.lerMapa().values()]);
    try {
      for (const nome of fs.readdirSync(this.cfg.instanciasDir)) {
        try {
          const m = /^PORT=(\d+)$/m.exec(fs.readFileSync(path.join(this.cfg.instanciasDir, nome, ".env"), "utf8"));
          if (m) usadas.add(Number(m[1]));
        } catch { /* sem .env */ }
      }
    } catch { /* diretório ainda não existe */ }
    return usadas;
  }
  /** Porta pedida (se livre) ou a primeira livre a partir de PAINEL_PORTA_INICIAL. */
  alocarPorta(pedida?: number, ocupadasNoBanco: number[] = []): number {
    const usadas = this.portasEmUso();
    for (const p of ocupadasNoBanco) usadas.add(p);
    usadas.add(this.cfg.porta);
    if (pedida) {
      if (!Number.isInteger(pedida) || pedida < 1024 || pedida > 65535) throw new ErroProvisionamento("Porta inválida.");
      if (usadas.has(pedida)) throw new ErroProvisionamento(`A porta ${pedida} já está em uso por outro escritório.`);
      return pedida;
    }
    for (let p = this.cfg.portaInicial; p < this.cfg.portaInicial + 2000; p++) if (!usadas.has(p)) return p;
    throw new ErroProvisionamento("Não há portas livres no intervalo configurado.");
  }
  /** Porta do .env de uma instância que já existe no disco (ou null). */
  portaExistente(slug: string): number | null {
    try {
      const m = /^PORT=(\d+)$/m.exec(fs.readFileSync(path.join(this.dir(slug), ".env"), "utf8"));
      return m ? Number(m[1]) : null;
    } catch { return null; }
  }

  // ---------- PM2 ----------
  async statusInstancia(slug: string): Promise<StatusInstancia> {
    this.conferirSlug(slug);
    const r = await this.executar("pm2", ["jlist"], { timeoutMs: 20_000 });
    if (r.code !== 0) return "ausente";
    try {
      const lista = JSON.parse(r.stdout.slice(r.stdout.indexOf("["))) as { name: string; pm2_env?: { status?: string } }[];
      const p = lista.find((x) => x.name === `dz-${slug}`);
      if (!p) return "ausente";
      return p.pm2_env?.status === "online" ? "online" : "parada";
    } catch { return "ausente"; }
  }
  async reiniciar(slug: string) {
    this.conferirSlug(slug);
    const r = await this.executar("pm2", ["restart", `dz-${slug}`]);
    if (r.code !== 0) throw new ErroProvisionamento(`Não consegui reiniciar a instância: ${limpar(r.stderr || r.stdout)}`);
  }

  // ---------- criação / adoção ----------
  async criarInstancia(slug: string, porta: number, envTexto: string): Promise<ResultadoCriacao> {
    this.conferirSlug(slug);
    const avisos: string[] = [];
    const existente = this.portaExistente(slug);
    if (existente !== null) return this.adotar(slug, existente);

    const tmp = path.join(this.cfg.dadosDir, `tmp-${slug}.env`);
    fs.mkdirSync(this.cfg.dadosDir, { recursive: true, mode: 0o700 });
    fs.writeFileSync(tmp, envTexto, { mode: 0o600 });
    let r: ResultadoComando;
    try {
      r = await this.executar("bash", [path.join(this.cfg.appDir, "scripts", "instancia-aplicar.sh"), slug, String(porta), tmp], {
        env: { ...process.env, APP_DIR: this.cfg.appDir, INSTANCIAS_DIR: this.cfg.instanciasDir, DOMINIO_BASE: this.cfg.baseDomain },
        cwd: this.cfg.appDir,
      });
    } finally {
      try { fs.writeFileSync(tmp, "0".repeat(envTexto.length)); } catch { /* ignore */ }
      try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    }
    if (r.code !== 0) throw new ErroProvisionamento(`Falha ao criar a instância: ${limpar(r.stderr || r.stdout)}`);

    try { await this.alterarMapa((m) => { m.set(this.host(slug), porta); }); }
    catch (e) { throw new ErroProvisionamento(`Instância criada, mas o endereço não foi ativado: ${(e as Error).message}`); }
    const senha = /^INITIAL_ADMIN_PASSWORD=(.+)$/m.exec(envTexto)?.[1] ?? null;
    const usuario = /^INITIAL_ADMIN_USERNAME=(.+)$/m.exec(envTexto)?.[1] ?? "admin";
    return { url: `https://${this.host(slug)}`, porta, usuarioInicial: usuario, senhaInicial: senha, adotada: false, avisos };
  }

  /** Instância que já existe no disco: preserva o .env, garante mapa e PM2. */
  async adotar(slug: string, porta: number): Promise<ResultadoCriacao> {
    const avisos: string[] = [];
    if ((await this.statusInstancia(slug)) === "ausente") {
      const r = await this.executar("pm2", ["start", "dist/index.js", "--name", `dz-${slug}`, `--node-args=--env-file=${path.join(this.dir(slug), ".env")}`], { cwd: this.cfg.appDir });
      if (r.code !== 0) throw new ErroProvisionamento(`Não consegui iniciar a instância existente: ${limpar(r.stderr || r.stdout)}`);
      await this.executar("pm2", ["save"]);
      avisos.push("A instância existente foi iniciada no PM2.");
    }
    try { await this.alterarMapa((m) => { m.set(this.host(slug), porta); }); }
    catch (e) { throw new ErroProvisionamento(`Instância existente encontrada, mas o endereço não foi ativado: ${(e as Error).message}`); }
    return { url: `https://${this.host(slug)}`, porta, usuarioInicial: null, senhaInicial: null, adotada: true, avisos };
  }

  /** Para a instância e tira o endereço do ar. Os dados do escritório NÃO são apagados. */
  async remover(slug: string) {
    this.conferirSlug(slug);
    if ((await this.statusInstancia(slug)) !== "ausente") {
      const r = await this.executar("pm2", ["delete", `dz-${slug}`]);
      if (r.code !== 0) throw new ErroProvisionamento(`Não consegui parar a instância: ${limpar(r.stderr || r.stdout)}`);
      await this.executar("pm2", ["save"]);
    }
    await this.alterarMapa((m) => { m.delete(this.host(slug)); });
  }

  /**
   * APAGA POR COMPLETO: para a instância, tira o endereço do ar e remove a pasta do escritório (banco, arquivos, .env). Não tem volta.
   * Só mexe dentro de `instanciasDir/<slug>`; recusa caminho fora dele.
   */
  async excluirDefinitivamente(slug: string): Promise<{ pasta_removida: boolean }> {
    this.conferirSlug(slug);
    await this.remover(slug);
    const base = path.resolve(this.cfg.instanciasDir);
    const alvo = path.resolve(this.dir(slug));
    if (!alvo.startsWith(base + path.sep) || alvo === base) throw new ErroProvisionamento("Caminho da instância fora da pasta permitida; nada foi apagado.");
    if (!fs.existsSync(alvo)) return { pasta_removida: false };
    fs.rmSync(alvo, { recursive: true, force: true });
    return { pasta_removida: true };
  }

  /** Reinicia várias instâncias (uma falha não impede as demais). Quem não tem processo no servidor é ignorado, não é erro. */
  async reiniciarVarias(slugs: string[]): Promise<{ slug: string; ok: boolean; erro?: string; ignorado?: boolean }[]> {
    const saida: { slug: string; ok: boolean; erro?: string; ignorado?: boolean }[] = [];
    for (const slug of slugs) {
      try {
        if ((await this.statusInstancia(slug)) === "ausente") { saida.push({ slug, ok: true, ignorado: true, erro: "sem instância neste servidor" }); continue; }
        await this.reiniciar(slug); saida.push({ slug, ok: true });
      }
      catch (e) { saida.push({ slug, ok: false, erro: (e as Error).message }); }
    }
    return saida;
  }
  /** Reinicia o próprio painel depois de responder à requisição (o processo é encerrado pelo PM2). */
  reiniciarPainelDepois(atrasoMs = 800) {
    setTimeout(() => { void this.executar("pm2", ["restart", this.cfg.pm2NomePainel]); }, atrasoMs).unref();
  }

  /** Troca só a chave de licença no .env da instância existente e reinicia. */
  async atualizarChave(slug: string, chave: string) {
    this.conferirSlug(slug);
    if (!/^dz_[A-Za-z0-9_-]{20,80}$/.test(chave)) throw new ErroProvisionamento("Chave inválida.");
    const arq = path.join(this.dir(slug), ".env");
    let txt: string;
    try { txt = fs.readFileSync(arq, "utf8"); } catch { throw new ErroProvisionamento("A instância não existe neste servidor."); }
    txt = /^LICENSE_KEY=.*$/m.test(txt) ? txt.replace(/^LICENSE_KEY=.*$/m, `LICENSE_KEY=${chave}`) : `${txt.replace(/\n*$/, "\n")}LICENSE_KEY=${chave}\n`;
    fs.writeFileSync(arq, txt, { mode: 0o600 });
    await this.reiniciar(slug);
  }
}
