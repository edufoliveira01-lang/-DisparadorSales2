import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Banco } from "./banco";
import type { ConfigPainel } from "./config";
import { ErroProvedor, type ProvedorCobranca } from "./asaas";
import { calcularStatus, montarCarga, somarDias, somarMes, hojeIso } from "./status";
import { assinarLicenca, type CargaLicenca } from "../licenca/token";
import { EntitlementInvalido, normalizarEntitlements, type Entitlements } from "../licenca/entitlements";

/** Subdomínios que já existem ou não podem ser usados por escritórios (ex.: a instalação atual, disparazap). */
export const ENDERECOS_RESERVADOS = new Set(["painel", "www", "api", "admin", "app", "mail", "webmail", "disparazap", "smtp", "imap", "pop", "ftp", "ns1", "ns2", "cpanel", "suporte", "status", "licenca", "licencas"]);

export class ErroPainel extends Error {
  constructor(mensagem: string, public status = 400) { super(mensagem); }
}

const agoraIso = (d: Date) => d.toISOString();
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const slugValido = (s: unknown): s is string => typeof s === "string" && /^[a-z0-9][a-z0-9-]{2,40}[a-z0-9]$/.test(s);
const dataValida = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s;
const texto = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const emailValido = (s: string) => /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/.test(s);
export const comparar = (a: string, b: string) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

interface LinhaEscritorio {
  id: string; slug: string; nome: string; documento: string | null; email: string; telefone: string | null; plano_id: string;
  entitlements_json: string; status_manual: string | null; teste_ate: string | null; pago_ate: string | null; carencia_dias: number | null;
  asaas_customer_id: string | null; asaas_subscription_id: string | null; link_fatura: string | null;
  chave_hash: string; chave_prefixo: string; ultimo_contato_em: string | null; ultima_versao: string | null; ultimo_ip: string | null;
  observacoes: string; criado_em: string; atualizado_em: string;
}
interface LinhaPlano { id: string; nome: string; preco_centavos: number; entitlements_json: string; ativo: number; criado_em: string }

export class ServicoPainel {
  constructor(
    private db: Banco,
    private cfg: ConfigPainel,
    private provedor: ProvedorCobranca,
    private chavePrivadaPem: string,
    private relogio: () => Date = () => new Date(),
  ) {}

  // ---------- auditoria ----------
  registrar(escritorioId: string | null, tipo: string, detalhe: unknown = {}) {
    this.db.prepare("INSERT INTO eventos(escritorio_id,tipo,detalhe_json,criado_em) VALUES (?,?,?,?)").run(escritorioId, tipo, JSON.stringify(detalhe), agoraIso(this.relogio()));
  }

  // ---------- planos ----------
  listarPlanos() {
    return (this.db.prepare("SELECT * FROM planos ORDER BY nome").all() as LinhaPlano[]).map((p) => ({ ...p, ativo: Boolean(p.ativo), entitlements: JSON.parse(p.entitlements_json) as Entitlements }));
  }
  private validarPlano(d: Record<string, unknown>, parcial: boolean) {
    const campos: { nome?: string; preco_centavos?: number; entitlements_json?: string; ativo?: number } = {};
    if (!parcial || d.nome !== undefined) { const nome = texto(d.nome, 80); if (nome.length < 2) throw new ErroPainel("Informe o nome do plano."); campos.nome = nome; }
    if (!parcial || d.preco_centavos !== undefined) {
      const p = Number(d.preco_centavos);
      if (!Number.isInteger(p) || p < 0 || p > 100_000_000) throw new ErroPainel("Informe o preço mensal em centavos (0 = sem cobrança automática).");
      campos.preco_centavos = p;
    }
    if (!parcial || d.entitlements !== undefined) {
      try { campos.entitlements_json = JSON.stringify(normalizarEntitlements(d.entitlements ?? {})); }
      catch (e) { if (e instanceof EntitlementInvalido) throw new ErroPainel(e.message); throw e; }
    }
    if (d.ativo !== undefined) campos.ativo = d.ativo ? 1 : 0;
    return campos;
  }
  criarPlano(d: Record<string, unknown>) {
    const c = this.validarPlano(d, false);
    const id = (texto(d.id, 40) || c.nome!).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
    if (id.length < 2) throw new ErroPainel("Identificador de plano inválido.");
    if (this.db.prepare("SELECT id FROM planos WHERE id=?").get(id)) throw new ErroPainel("Já existe um plano com esse identificador.", 409);
    this.db.prepare("INSERT INTO planos(id,nome,preco_centavos,entitlements_json,ativo,criado_em) VALUES (?,?,?,?,?,?)")
      .run(id, c.nome, c.preco_centavos, c.entitlements_json, c.ativo ?? 1, agoraIso(this.relogio()));
    this.registrar(null, "plano_criado", { id });
    return this.listarPlanos().find((p) => p.id === id)!;
  }
  async atualizarPlano(id: string, d: Record<string, unknown>) {
    if (!this.db.prepare("SELECT id FROM planos WHERE id=?").get(id)) throw new ErroPainel("Plano não encontrado.", 404);
    const c = this.validarPlano(d, true);
    const chaves = Object.keys(c) as (keyof typeof c)[];
    if (!chaves.length) throw new ErroPainel("Nada para atualizar.");
    this.db.prepare(`UPDATE planos SET ${chaves.map((k) => `${k}=?`).join(",")} WHERE id=?`).run(...chaves.map((k) => c[k]), id);
    this.registrar(null, "plano_atualizado", { id, campos: chaves });
    // O novo preço vale para as próximas cobranças dos escritórios do plano.
    if (c.preco_centavos !== undefined && this.provedor.configurado()) {
      const afetados = this.db.prepare("SELECT id,asaas_subscription_id FROM escritorios WHERE plano_id=? AND asaas_subscription_id IS NOT NULL AND status_manual IS NOT 'cancelada'").all(id) as { id: string; asaas_subscription_id: string }[];
      for (const e of afetados) {
        try { await this.provedor.atualizarValor(e.asaas_subscription_id, c.preco_centavos); }
        catch (err) { this.registrar(e.id, "cobranca_erro", { acao: "atualizar_valor", erro: (err as Error).message }); }
      }
    }
    return this.listarPlanos().find((p) => p.id === id)!;
  }

  // ---------- escritórios ----------
  private visao(l: LinhaEscritorio, plano?: LinhaPlano) {
    const p = plano ?? (this.db.prepare("SELECT * FROM planos WHERE id=?").get(l.plano_id) as LinhaPlano);
    const st = calcularStatus(l, this.relogio(), this.cfg.carenciaPadraoDias);
    const { chave_hash: _h, ...resto } = l;
    return {
      ...resto, plano_nome: p?.nome ?? l.plano_id, preco_centavos: p?.preco_centavos ?? 0,
      entitlements: JSON.parse(l.entitlements_json) as Entitlements,
      status: st.status, vence_em: st.vence_em, carencia_ate: st.carencia_ate,
      endereco: `https://${l.slug}.${this.cfg.baseDomain}`,
    };
  }
  listarEscritorios() {
    const planos = new Map((this.db.prepare("SELECT * FROM planos").all() as LinhaPlano[]).map((p) => [p.id, p]));
    return (this.db.prepare("SELECT * FROM escritorios ORDER BY nome").all() as LinhaEscritorio[]).map((l) => this.visao(l, planos.get(l.plano_id)));
  }
  private linha(id: string): LinhaEscritorio {
    const l = this.db.prepare("SELECT * FROM escritorios WHERE id=?").get(id) as LinhaEscritorio | undefined;
    if (!l) throw new ErroPainel("Escritório não encontrado.", 404);
    return l;
  }
  obterEscritorio(id: string) {
    const l = this.linha(id);
    return {
      ...this.visao(l),
      pagamentos: this.db.prepare("SELECT * FROM pagamentos WHERE escritorio_id=? ORDER BY id DESC LIMIT 50").all(id),
      eventos: (this.db.prepare("SELECT * FROM eventos WHERE escritorio_id=? ORDER BY id DESC LIMIT 100").all(id) as { detalhe_json: string }[]).map((e) => ({ ...e, detalhe: JSON.parse(e.detalhe_json) })),
    };
  }

  portasRegistradas(): number[] {
    return (this.db.prepare("SELECT porta FROM escritorios WHERE porta IS NOT NULL").all() as { porta: number }[]).map((r) => r.porta);
  }
  definirInstancia(id: string, porta: number | null, evento: string, detalhe: Record<string, unknown> = {}) {
    this.linha(id);
    this.db.prepare("UPDATE escritorios SET porta=?,instancia_em=?,atualizado_em=? WHERE id=?").run(porta, porta === null ? null : agoraIso(this.relogio()), agoraIso(this.relogio()), id);
    this.registrar(id, evento, { porta, ...detalhe });
  }
  slugDe(id: string): string { return this.linha(id).slug; }

  /** Usuário e senha iniciais do administrador do escritório (a senha nunca fica guardada no painel). */
  validarAdminInicial(usuario: unknown, senha: unknown): { adminUsuario: string; adminSenha?: string } {
    const u = typeof usuario === "string" && usuario.trim() ? usuario.trim() : "admin";
    if (!/^[A-Za-z0-9._@-]{3,60}$/.test(u)) throw new ErroPainel("O usuário do administrador deve ter de 3 a 60 caracteres (letras, números, ponto, hífen, sublinhado ou @).");
    if (senha === undefined || senha === null || senha === "") return { adminUsuario: u };
    if (typeof senha !== "string" || senha.length < 12 || senha.length > 100 || /\s/.test(senha)) throw new ErroPainel("A senha inicial deve ter de 12 a 100 caracteres, sem espaços (ou deixe em branco para o painel gerar uma).");
    return { adminUsuario: u, adminSenha: senha };
  }

  novaChave() { return `dz_${randomBytes(24).toString("base64url")}`; }

  async criarEscritorio(d: Record<string, unknown>) {
    const slug = texto(d.slug, 42).toLowerCase();
    if (!slugValido(slug)) throw new ErroPainel("O endereço deve ter de 4 a 42 letras minúsculas, números ou hífens.");
    if (ENDERECOS_RESERVADOS.has(slug)) throw new ErroPainel("Esse endereço é reservado.");
    const nome = texto(d.nome, 160); if (nome.length < 3) throw new ErroPainel("Informe o nome do escritório.");
    const email = texto(d.email, 254).toLowerCase(); if (!emailValido(email)) throw new ErroPainel("Informe um e-mail válido.");
    const plano = this.db.prepare("SELECT * FROM planos WHERE id=? AND ativo=1").get(texto(d.plano_id, 40) || "escritorio") as LinhaPlano | undefined;
    if (!plano) throw new ErroPainel("Plano inexistente ou inativo.");
    let overrides: Entitlements;
    try { overrides = normalizarEntitlements(d.entitlements ?? {}); } catch (e) { throw new ErroPainel((e as Error).message); }
    const testeDias = d.teste_dias === undefined || d.teste_dias === "" ? this.cfg.testePadraoDias : Number(d.teste_dias);
    if (!Number.isInteger(testeDias) || testeDias < 0 || testeDias > 365) throw new ErroPainel("Dias de teste inválidos (0 a 365).");
    if (this.db.prepare("SELECT id FROM escritorios WHERE slug=?").get(slug)) throw new ErroPainel("Já existe um escritório com esse endereço.", 409);
    const agora = this.relogio();
    const hoje = hojeIso(agora);
    const teste_ate = d.cortesia === true ? null : somarDias(hoje, testeDias);
    const chave = this.novaChave();
    const id = `off_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
    this.db.prepare(`INSERT INTO escritorios(id,slug,nome,documento,email,telefone,plano_id,entitlements_json,teste_ate,carencia_dias,chave_hash,chave_prefixo,observacoes,criado_em,atualizado_em)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(id, slug, nome, texto(d.documento, 30) || null, email, texto(d.telefone, 30) || null, plano.id,
        JSON.stringify(overrides), teste_ate, d.carencia_dias === undefined || d.carencia_dias === "" || d.carencia_dias === null ? null : Number(d.carencia_dias),
        sha256(chave), chave.slice(0, 8), texto(d.observacoes, 2000), agoraIso(agora), agoraIso(agora));
    this.registrar(id, "escritorio_criado", { slug, plano: plano.id, teste_ate });
    let aviso: string | null = null;
    if (d.cortesia !== true && plano.preco_centavos > 0) aviso = await this.criarCobrancaInterna(id).catch((e) => (e as Error).message);
    return { escritorio: this.visao(this.linha(id)), chave, aviso };
  }

  private async criarCobrancaInterna(id: string): Promise<string | null> {
    const l = this.linha(id);
    const plano = this.db.prepare("SELECT * FROM planos WHERE id=?").get(l.plano_id) as LinhaPlano;
    if (l.asaas_subscription_id) return null;
    if (plano.preco_centavos <= 0) throw new ErroPainel("O plano não tem preço definido; defina o valor mensal para criar a cobrança.");
    if (!this.provedor.configurado()) return "Cobrança automática não configurada (ASAAS_API_KEY). Use “Registrar pagamento” para liberar manualmente.";
    try {
      const hoje = hojeIso(this.relogio());
      const cliente = l.asaas_customer_id ? { id: l.asaas_customer_id } : await this.provedor.criarCliente({ nome: l.nome, documento: l.documento, email: l.email, telefone: l.telefone, referencia: l.id });
      this.db.prepare("UPDATE escritorios SET asaas_customer_id=? WHERE id=?").run(cliente.id, id);
      const primeiro = l.teste_ate && l.teste_ate > hoje ? l.teste_ate : hoje;
      const ass = await this.provedor.criarAssinatura({ clienteId: cliente.id, valorCentavos: plano.preco_centavos, proximoVencimento: primeiro, descricao: `DisparaZap — ${plano.nome} (${l.nome})`, referencia: l.id });
      this.db.prepare("UPDATE escritorios SET asaas_subscription_id=?,link_fatura=?,atualizado_em=? WHERE id=?").run(ass.id, ass.linkFatura, agoraIso(this.relogio()), id);
      this.registrar(id, "cobranca_criada", { assinatura: ass.id, vencimento: primeiro, valor_centavos: plano.preco_centavos });
      return null;
    } catch (e) {
      const msg = e instanceof ErroProvedor ? e.message : (e as Error).message;
      this.registrar(id, "cobranca_erro", { acao: "criar", erro: msg });
      return `Escritório criado, mas a cobrança não foi criada: ${msg}`;
    }
  }
  async criarCobranca(id: string) {
    const aviso = await this.criarCobrancaInterna(id);
    return { escritorio: this.obterEscritorio(id), aviso };
  }

  async atualizarEscritorio(id: string, d: Record<string, unknown>) {
    const atual = this.linha(id);
    const sets: string[] = []; const vals: unknown[] = [];
    const put = (col: string, v: unknown) => { sets.push(`${col}=?`); vals.push(v); };
    if (d.nome !== undefined) { const n = texto(d.nome, 160); if (n.length < 3) throw new ErroPainel("Informe o nome do escritório."); put("nome", n); }
    if (d.email !== undefined) { const e = texto(d.email, 254).toLowerCase(); if (!emailValido(e)) throw new ErroPainel("Informe um e-mail válido."); put("email", e); }
    if (d.documento !== undefined) put("documento", texto(d.documento, 30) || null);
    if (d.telefone !== undefined) put("telefone", texto(d.telefone, 30) || null);
    if (d.observacoes !== undefined) put("observacoes", texto(d.observacoes, 2000));
    if (d.carencia_dias !== undefined) {
      const n = d.carencia_dias === null || d.carencia_dias === "" ? null : Number(d.carencia_dias);
      if (n !== null && (!Number.isInteger(n) || n < 0 || n > 90)) throw new ErroPainel("Carência inválida (0 a 90 dias).");
      put("carencia_dias", n);
    }
    if (d.entitlements !== undefined) { try { put("entitlements_json", JSON.stringify(normalizarEntitlements(d.entitlements))); } catch (e) { throw new ErroPainel((e as Error).message); } }
    if (d.teste_ate !== undefined) { if (d.teste_ate !== null && !dataValida(d.teste_ate)) throw new ErroPainel("Data de teste inválida."); put("teste_ate", d.teste_ate); }
    let novoPlano: LinhaPlano | undefined;
    if (d.plano_id !== undefined && d.plano_id !== atual.plano_id) {
      novoPlano = this.db.prepare("SELECT * FROM planos WHERE id=? AND ativo=1").get(String(d.plano_id)) as LinhaPlano | undefined;
      if (!novoPlano) throw new ErroPainel("Plano inexistente ou inativo.");
      put("plano_id", novoPlano.id);
    }
    if (!sets.length) throw new ErroPainel("Nada para atualizar.");
    put("atualizado_em", agoraIso(this.relogio()));
    this.db.prepare(`UPDATE escritorios SET ${sets.join(",")} WHERE id=?`).run(...vals, id);
    this.registrar(id, "escritorio_atualizado", { campos: Object.keys(d) });
    if (novoPlano && atual.asaas_subscription_id && this.provedor.configurado()) {
      try { await this.provedor.atualizarValor(atual.asaas_subscription_id, novoPlano.preco_centavos); }
      catch (e) { this.registrar(id, "cobranca_erro", { acao: "atualizar_valor", erro: (e as Error).message }); }
    }
    return this.obterEscritorio(id);
  }

  suspender(id: string, motivo = "") { this.linha(id); this.db.prepare("UPDATE escritorios SET status_manual='suspensa',atualizado_em=? WHERE id=?").run(agoraIso(this.relogio()), id); this.registrar(id, "suspenso", { motivo }); return this.obterEscritorio(id); }
  reativar(id: string) { this.linha(id); this.db.prepare("UPDATE escritorios SET status_manual=NULL,atualizado_em=? WHERE id=?").run(agoraIso(this.relogio()), id); this.registrar(id, "reativado"); return this.obterEscritorio(id); }
  async cancelar(id: string) {
    const l = this.linha(id);
    this.db.prepare("UPDATE escritorios SET status_manual='cancelada',atualizado_em=? WHERE id=?").run(agoraIso(this.relogio()), id);
    this.registrar(id, "cancelado");
    if (l.asaas_subscription_id && this.provedor.configurado()) {
      try { await this.provedor.cancelarAssinatura(l.asaas_subscription_id); }
      catch (e) { this.registrar(id, "cobranca_erro", { acao: "cancelar", erro: (e as Error).message }); }
    }
    return this.obterEscritorio(id);
  }
  /** Libera o uso até a data informada (pagamento fora do Asaas, cortesia, acerto comercial). */
  registrarPagamentoManual(id: string, ate: unknown, observacao = "") {
    this.linha(id);
    if (!dataValida(ate)) throw new ErroPainel("Informe a data até a qual o uso está pago (AAAA-MM-DD).");
    this.db.prepare("UPDATE escritorios SET pago_ate=?,atualizado_em=? WHERE id=?").run(ate, agoraIso(this.relogio()), id);
    this.registrar(id, "pagamento_manual", { ate, observacao: texto(observacao, 300) });
    return this.obterEscritorio(id);
  }
  rotacionarChave(id: string) {
    this.linha(id);
    const chave = this.novaChave();
    this.db.prepare("UPDATE escritorios SET chave_hash=?,chave_prefixo=?,atualizado_em=? WHERE id=?").run(sha256(chave), chave.slice(0, 8), agoraIso(this.relogio()), id);
    this.registrar(id, "chave_rotacionada");
    return { chave };
  }

  /** Instruções de implantação. A chave de criptografia dos dados é gerada aqui e NÃO fica guardada no painel. */
  provisionamento(id: string, chave: string, opcoes: { novaInstancia: boolean; porta?: number; chavePublicaPem: string; adminUsuario?: string; adminSenha?: string }) {
    const l = this.linha(id);
    const dir = `${this.cfg.instanciasDir}/${l.slug}`;
    const porta = opcoes.porta && Number.isInteger(opcoes.porta) ? opcoes.porta : 3400;
    const licenca = [
      `LICENSE_SERVER_URL=${this.cfg.licencaUrlInterna || this.cfg.urlPublica || "https://painel.seudominio.com.br"}`,
      `LICENSE_KEY=${chave}`,
      `LICENSE_PUBLIC_KEY_B64=${Buffer.from(opcoes.chavePublicaPem).toString("base64")}`,
    ];
    if (!opcoes.novaInstancia) return { env: licenca.join("\n"), pm2: "", nginx: "", observacao: "Atualize apenas estas linhas no .env da instância existente e reinicie o processo." };
    const env = [
      `OFFICE_ID=${l.slug}`,
      `DATA_DIR=${dir}/data`,
      `DJEN_CODEX_HOME=${dir}/data/codex`,
      `PORT=${porta}`,
      `APP_URL=https://${l.slug}.${this.cfg.baseDomain}`,
      "NODE_ENV=production",
      `ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`,
      `INITIAL_ADMIN_USERNAME=${opcoes.adminUsuario || "admin"}`,
      `INITIAL_ADMIN_PASSWORD=${opcoes.adminSenha || randomBytes(15).toString("base64url")}`,
      "INITIAL_ADMIN_MUST_CHANGE=1",
      ...licenca,
    ].join("\n");
    const pm2 = [
      `sudo install -d -m 700 -o $USER ${dir} ${dir}/data`,
      `# Salve o bloco acima em ${dir}/.env (chmod 600) e inicie:`,
      `cd ${this.cfg.appDir} && pm2 start dist/index.js --name dz-${l.slug} --node-args="--env-file=${dir}/.env"`,
      "pm2 save",
    ].join("\n");
    const nginx = [
      "server {",
      `  server_name ${l.slug}.${this.cfg.baseDomain};`,
      "  listen 80;  # use a mesma porta dos seus outros sites (ex.: 8081 atrás do Cloudflare Tunnel)",
      "  client_max_body_size 25m;",
      "  root /var/www/disparazap;  # interface única, compartilhada por todos os escritórios",
      "  index index.html;",
      "  location / { try_files $uri $uri/ /index.html; }",
      "  location /api/ {",
      `    proxy_pass http://127.0.0.1:${porta};`,
      "    proxy_http_version 1.1;",
      "    proxy_set_header Host $host;",
      "    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;",
      "    proxy_set_header X-Forwarded-Proto https;",
      "  }",
      "  location /socket.io/ {",
      `    proxy_pass http://127.0.0.1:${porta};`,
      "    proxy_http_version 1.1;",
      "    proxy_set_header Upgrade $http_upgrade;",
      '    proxy_set_header Connection "upgrade";',
      "    proxy_set_header Host $host;",
      "    proxy_read_timeout 3600s;",
      "  }",
      "}",
    ].join("\n");
    return { env, pm2, nginx, observacao: "Guarde o ENCRYPTION_KEY com segurança: ele não é armazenado no painel e sem ele os dados criptografados do escritório não podem ser lidos. A senha inicial deve ser trocada no primeiro acesso." };
  }

  // ---------- licença ----------
  emitirLicenca(chaveBruta: string, meta: { ip?: string; versao?: string } = {}): { token: string; carga: CargaLicenca } | null {
    if (typeof chaveBruta !== "string" || chaveBruta.length < 20 || chaveBruta.length > 100) return null;
    const l = this.db.prepare("SELECT * FROM escritorios WHERE chave_hash=?").get(sha256(chaveBruta)) as LinhaEscritorio | undefined;
    if (!l) return null;
    const agora = this.relogio();
    this.db.prepare("UPDATE escritorios SET ultimo_contato_em=?,ultima_versao=?,ultimo_ip=? WHERE id=?").run(agoraIso(agora), texto(meta.versao, 40) || null, texto(meta.ip, 64) || null, l.id);
    const plano = this.db.prepare("SELECT * FROM planos WHERE id=?").get(l.plano_id) as LinhaPlano;
    const carga = montarCarga({ ...l, entitlements_plano: plano.entitlements_json, entitlements_escritorio: l.entitlements_json }, agora,
      { carenciaPadraoDias: this.cfg.carenciaPadraoDias, validadeHoras: this.cfg.validadeLicencaHoras, toleranciaOfflineDias: this.cfg.toleranciaOfflineDias });
    return { token: assinarLicenca(carga, this.chavePrivadaPem), carga };
  }

  // ---------- webhook do Asaas ----------
  private escritorioDoPagamento(p: { subscription?: string; customer?: string; externalReference?: string }): LinhaEscritorio | undefined {
    if (p.subscription) { const l = this.db.prepare("SELECT * FROM escritorios WHERE asaas_subscription_id=?").get(p.subscription) as LinhaEscritorio | undefined; if (l) return l; }
    if (p.externalReference) { const l = this.db.prepare("SELECT * FROM escritorios WHERE id=?").get(p.externalReference) as LinhaEscritorio | undefined; if (l) return l; }
    if (p.customer) return this.db.prepare("SELECT * FROM escritorios WHERE asaas_customer_id=?").get(p.customer) as LinhaEscritorio | undefined;
    return undefined;
  }

  processarWebhook(corpo: unknown): { ok: true; ignorado?: string } {
    const b = corpo as { event?: string; payment?: Record<string, unknown>; subscription?: Record<string, unknown> } | null;
    const evento = typeof b?.event === "string" ? b.event : "";
    if (!evento) return { ok: true, ignorado: "sem_evento" };
    if (evento.startsWith("SUBSCRIPTION_")) {
      const s = b?.subscription as { id?: string } | undefined;
      const l = s?.id ? (this.db.prepare("SELECT * FROM escritorios WHERE asaas_subscription_id=?").get(s.id) as LinhaEscritorio | undefined) : undefined;
      if (l) this.registrar(l.id, `asaas_${evento.toLowerCase()}`, { assinatura: s?.id });
      return { ok: true };
    }
    const p = b?.payment as { id?: string; subscription?: string; customer?: string; externalReference?: string; status?: string; value?: number; dueDate?: string; paymentDate?: string; invoiceUrl?: string } | undefined;
    if (!evento.startsWith("PAYMENT_") || !p?.id) return { ok: true, ignorado: "evento_nao_tratado" };
    const l = this.escritorioDoPagamento(p);
    if (!l) return { ok: true, ignorado: "escritorio_nao_encontrado" };
    const agora = agoraIso(this.relogio());
    const ins = this.db.prepare(`INSERT OR IGNORE INTO pagamentos(escritorio_id,asaas_payment_id,evento,status,valor_centavos,vencimento,pago_em,link_fatura,criado_em)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(l.id, p.id, evento, p.status ?? null, typeof p.value === "number" ? Math.round(p.value * 100) : null,
        dataValida(p.dueDate) ? p.dueDate : null, dataValida(p.paymentDate) ? p.paymentDate : null, p.invoiceUrl ?? null, agora);
    if (ins.changes === 0) return { ok: true, ignorado: "duplicado" }; // reentrega do mesmo evento
    if (p.invoiceUrl) this.db.prepare("UPDATE escritorios SET link_fatura=? WHERE id=?").run(p.invoiceUrl, l.id);
    if ((evento === "PAYMENT_CONFIRMED" || evento === "PAYMENT_RECEIVED") && dataValida(p.dueDate)) {
      const novo = somarMes(p.dueDate);
      if (!l.pago_ate || novo > l.pago_ate) this.db.prepare("UPDATE escritorios SET pago_ate=?,atualizado_em=? WHERE id=?").run(novo, agora, l.id);
      this.registrar(l.id, "pagamento_recebido", { pagamento: p.id, vencimento: p.dueDate, pago_ate: novo });
    } else if (evento === "PAYMENT_OVERDUE") {
      this.registrar(l.id, "pagamento_vencido", { pagamento: p.id, vencimento: p.dueDate });
    } else if (evento === "PAYMENT_REFUNDED" || evento === "PAYMENT_CHARGEBACK_REQUESTED" || evento === "PAYMENT_CHARGEBACK_DISPUTE") {
      this.db.prepare("UPDATE escritorios SET status_manual='suspensa',atualizado_em=? WHERE id=?").run(agora, l.id);
      this.registrar(l.id, "suspenso_por_estorno", { pagamento: p.id, evento });
    } else {
      this.registrar(l.id, `asaas_${evento.toLowerCase()}`, { pagamento: p.id });
    }
    return { ok: true };
  }
}
