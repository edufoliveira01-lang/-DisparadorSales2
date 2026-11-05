/**
 * Cliente de licença da instância.
 *
 * Sem LICENSE_SERVER_URL/LICENSE_KEY/LICENSE_PUBLIC_KEY(_B64) o sistema roda em "modo próprio":
 * nada é verificado, não há limites e nada é bloqueado (é o caso da instalação atual).
 * Com as três variáveis, a instância busca no painel uma licença assinada, guarda uma cópia no
 * DATA_DIR e passa a respeitar o plano: vencimento, carência, modo somente leitura e limites.
 */
import fs from "node:fs";
import path from "node:path";
import { avaliarLicenca, verificarLicenca, type CargaLicenca, type EstadoLicenca } from "./token";
import { combinarEntitlements, excedeLimite, ENTITLEMENTS, type ChaveEntitlement, type Entitlements, type ValorEntitlement } from "./entitlements";

export interface ConfigLicenca {
  urlServidor: string;
  chave: string;
  chavePublicaPem: string;
  escritorioId: string | null;
  arquivo: string;
  versao: string;
  intervaloMs: number;
  intervaloRestritoMs: number;
  /** Dias sem licença nenhuma (primeira instalação sem contato) antes de restringir. */
  carenciaInicialDias: number;
}

export function lerConfigLicenca(env: NodeJS.ProcessEnv, dataDir: string, versao = ""): ConfigLicenca | null {
  const url = (env.LICENSE_SERVER_URL || "").trim().replace(/\/+$/, "");
  const chave = (env.LICENSE_KEY || "").trim();
  const pem = env.LICENSE_PUBLIC_KEY_B64 ? Buffer.from(env.LICENSE_PUBLIC_KEY_B64, "base64").toString("utf8") : (env.LICENSE_PUBLIC_KEY || "").replace(/\\n/g, "\n");
  if (!url && !chave && !pem.trim()) return null; // modo próprio
  if (!url || !chave || !pem.includes("PUBLIC KEY"))
    throw new Error("Licença incompleta: defina LICENSE_SERVER_URL, LICENSE_KEY e LICENSE_PUBLIC_KEY_B64 (ou remova as três).");
  return { urlServidor: url, chave, chavePublicaPem: pem, escritorioId: env.OFFICE_ID || null, arquivo: path.join(dataDir, "license.json"), versao,
    intervaloMs: 6 * 3_600_000, intervaloRestritoMs: 15 * 60_000, carenciaInicialDias: 3 };
}

interface ArquivoLicenca { token?: string; primeira_tentativa_em?: string; ultimo_contato_ok_em?: string }

export type EstadoCompleto = EstadoLicenca & {
  modo: "proprio" | "licenciado";
  entitlements: Record<ChaveEntitlement, ValorEntitlement>;
  plano: string | null;
  ultima_verificacao_ok: string | null;
};

export class ClienteLicenca {
  private carga: CargaLicenca | null = null;
  private arq: ArquivoLicenca = {};
  private timer: NodeJS.Timeout | null = null;
  private ultimoErro: string | null = null;

  constructor(private cfg: ConfigLicenca | null, private http: typeof fetch = fetch, private relogio: () => Date = () => new Date(), private erroConfig: string | null = null) {
    if (cfg) this.carregarDoDisco();
  }

  private carregarDoDisco() {
    try {
      this.arq = JSON.parse(fs.readFileSync(this.cfg!.arquivo, "utf8")) as ArquivoLicenca;
      const c = verificarLicenca(this.arq.token, this.cfg!.chavePublicaPem);
      if (c && (!this.cfg!.escritorioId || c.slug === this.cfg!.escritorioId)) this.carga = c;
    } catch { /* primeiro uso ou arquivo inválido */ }
    if (!this.arq.primeira_tentativa_em) { this.arq.primeira_tentativa_em = this.relogio().toISOString(); this.salvar(); }
  }
  private salvar() {
    try { fs.mkdirSync(path.dirname(this.cfg!.arquivo), { recursive: true, mode: 0o700 }); fs.writeFileSync(this.cfg!.arquivo, JSON.stringify(this.arq), { mode: 0o600 }); }
    catch (e) { console.error("[Licença] Não foi possível salvar a cópia local:", (e as Error).message); }
  }

  /** Consulta o painel. Retorna true se uma licença válida foi recebida. */
  async verificar(): Promise<boolean> {
    if (!this.cfg) return true;
    try {
      const r = await this.http(`${this.cfg.urlServidor}/api/v1/licenca/verificar`, {
        method: "POST", headers: { Authorization: `Bearer ${this.cfg.chave}`, "Content-Type": "application/json" },
        body: JSON.stringify({ versao: this.cfg.versao }), signal: AbortSignal.timeout(15_000),
      });
      if (r.status === 401) { this.ultimoErro = "Chave de licença inválida ou revogada."; return false; }
      if (!r.ok) { this.ultimoErro = `Painel de licenças respondeu HTTP ${r.status}.`; return false; }
      const { token } = (await r.json()) as { token?: string };
      const carga = verificarLicenca(token, this.cfg.chavePublicaPem);
      if (!carga) { this.ultimoErro = "Licença recebida com assinatura inválida."; return false; }
      if (this.cfg.escritorioId && carga.slug !== this.cfg.escritorioId) { this.ultimoErro = "A licença pertence a outro escritório."; return false; }
      this.carga = carga; this.arq.token = token; this.arq.ultimo_contato_ok_em = this.relogio().toISOString(); this.ultimoErro = null;
      this.salvar();
      return true;
    } catch (e) { this.ultimoErro = `Sem conexão com o painel de licenças: ${(e as Error).message}`; return false; }
  }

  estado(): EstadoCompleto {
    // Configuração parcial: restringe e explica, em vez de liberar sem licença ou derrubar o servidor.
    if (this.erroConfig) return { modo: "licenciado", status: "sem_contato", restrito: true, aviso: this.erroConfig, vence_em: null, dias_restantes: null, entitlements: combinarEntitlements({}), plano: null, ultima_verificacao_ok: null };
    if (!this.cfg) return { modo: "proprio", status: "ativa", restrito: false, aviso: null, vence_em: null, dias_restantes: null, entitlements: combinarEntitlements({}), plano: null, ultima_verificacao_ok: null };
    const agora = this.relogio();
    if (!this.carga) {
      const desde = Date.parse(this.arq.primeira_tentativa_em || agora.toISOString());
      const dentro = agora.getTime() - desde < this.cfg.carenciaInicialDias * 86_400_000;
      return { modo: "licenciado", status: "sem_contato", restrito: !dentro, vence_em: null, dias_restantes: null, plano: null, ultima_verificacao_ok: null,
        aviso: this.ultimoErro || (dentro ? "Aguardando a primeira validação da licença." : "Licença não validada. Verifique LICENSE_KEY e a conexão com o painel de licenças."),
        entitlements: combinarEntitlements({}) };
    }
    const e = avaliarLicenca(this.carga, agora);
    // Restrito por falta de contato: o motivo mais útil é o último erro conhecido.
    const aviso = e.status === "sem_contato" && this.ultimoErro ? `${e.aviso} (${this.ultimoErro})` : e.aviso;
    return { ...e, aviso, modo: "licenciado", entitlements: combinarEntitlements(this.carga.entitlements), plano: this.carga.plano, ultima_verificacao_ok: this.arq.ultimo_contato_ok_em ?? null };
  }

  /** Dados do atendimento enviados pelo painel (null se o plano não inclui o módulo). */
  atendimento(): NonNullable<CargaLicenca["atendimento"]> | null { return this.carga?.atendimento ?? null; }

  iniciar() {
    if (!this.cfg || this.timer) return;
    const ciclo = async () => {
      await this.verificar();
      const restrito = this.estado().restrito;
      this.timer = setTimeout(() => void ciclo(), restrito ? this.cfg!.intervaloRestritoMs : this.cfg!.intervaloMs);
      this.timer.unref();
    };
    this.timer = setTimeout(() => void ciclo(), 3_000);
    this.timer.unref();
  }
  parar() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}

// ---------- instância global ----------
let global: ClienteLicenca | null = null;
export function licenca(): ClienteLicenca {
  if (!global) {
    const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.resolve(__dirname, "../../data");
    let versao = "";
    try { versao = (JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as { version: string }).version; } catch { /* versão informativa */ }
    try { global = new ClienteLicenca(lerConfigLicenca(process.env, dataDir, versao)); }
    catch (e) { console.error("[Licença]", (e as Error).message); global = new ClienteLicenca(null, fetch, () => new Date(), (e as Error).message); }
  }
  return global;
}
export function definirLicencaParaTestes(c: ClienteLicenca | null) { global = c; }

/** Rotinas automáticas e envios só rodam com a licença em dia (ou em modo próprio). */
export const licencaPermiteOperar = () => !licenca().estado().restrito;
export const entitlementsAtuais = (): Entitlements => licenca().estado().entitlements;
export const recursoLiberadoNaLicenca = (chave: ChaveEntitlement) => entitlementsAtuais()[chave] !== false;

/** Mensagem de bloqueio quando criar mais um item excede o limite do plano; null = pode criar. */
export function mensagemSeExcederLimite(chave: ChaveEntitlement, usoAtual: number): string | null {
  const { excede, limite } = excedeLimite(entitlementsAtuais(), chave, usoAtual);
  if (!excede) return null;
  const rotulo = ENTITLEMENTS[chave].rotulo.toLowerCase();
  return `O plano atual permite até ${limite} (${rotulo}). Fale com o suporte para ampliar o plano.`;
}
