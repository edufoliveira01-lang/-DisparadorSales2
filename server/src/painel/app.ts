import express, { type NextFunction, type Request, type RequestHandler, type Response } from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import type { Banco } from "./banco";
import type { ConfigPainel } from "./config";
import { ErroPainel, ServicoPainel, comparar } from "./servico";
import { criarLimitador, entrar, sair, usuarioDaSessao } from "./auth";
import { ENTITLEMENTS } from "../licenca/entitlements";

const COOKIE = "painel_sessao";
const IP = (req: Request) => (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");

export interface DepsPainel { db: Banco; cfg: ConfigPainel; servico: ServicoPainel; chavePublicaPem: string; versao: string; webDir?: string }

export function criarAppPainel(deps: DepsPainel) {
  const { db, cfg, servico } = deps;
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    next();
  });
  app.use(cookieParser());
  app.use(express.json({ limit: "100kb" }));

  const tentativasLogin = criarLimitador(10, 15 * 60_000);
  const consultasLicenca = criarLimitador(120, 60_000);
  const seguro = cfg.urlPublica.startsWith("https://");
  const rota = (fn: (req: Request, res: Response) => unknown | Promise<unknown>): RequestHandler => async (req, res, next) => {
    try { const r = await fn(req, res); if (r !== undefined && !res.headersSent) res.json(r); }
    catch (e) {
      if (e instanceof ErroPainel) return res.status(e.status).json({ error: e.message });
      next(e);
    }
  };

  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // ---------- consultado pelas instâncias ----------
  app.post("/api/v1/licenca/verificar", rota((req, res) => {
    if (!consultasLicenca(IP(req))) { res.status(429).json({ error: "Muitas consultas." }); return; }
    const cab = String(req.headers.authorization || "");
    const chave = cab.startsWith("Bearer ") ? cab.slice(7).trim() : "";
    const r = servico.emitirLicenca(chave, { ip: IP(req), versao: typeof req.body?.versao === "string" ? req.body.versao : undefined });
    if (!r) { res.status(401).json({ error: "Licença inválida." }); return; }
    return { token: r.token, status: r.carga.status };
  }));

  // ---------- webhook do Asaas ----------
  app.post("/webhooks/asaas", (req, res, next) => {
    try {
      if (!cfg.asaasWebhookToken) return res.status(503).json({ error: "Webhook não configurado (ASAAS_WEBHOOK_TOKEN)." });
      if (!comparar(String(req.headers["asaas-access-token"] || ""), cfg.asaasWebhookToken)) return res.status(401).json({ error: "Token inválido." });
      res.json(servico.processarWebhook(req.body)); // falha → 500 e o Asaas reenvia
    } catch (e) { next(e); }
  });

  // ---------- administração ----------
  app.post("/api/admin/login", rota(async (req, res) => {
    if (!tentativasLogin(IP(req))) { res.status(429).json({ error: "Muitas tentativas. Aguarde alguns minutos." }); return; }
    const token = await entrar(db, cfg, String(req.body?.usuario || "").slice(0, 80), String(req.body?.senha || "").slice(0, 200));
    if (!token) { res.status(401).json({ error: "Usuário ou senha inválidos." }); return; }
    res.cookie(COOKIE, token, { httpOnly: true, sameSite: "strict", secure: seguro, maxAge: cfg.sessaoHoras * 3_600_000, path: "/" });
    return { ok: true };
  }));

  const admin = express.Router();
  admin.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    const usuario = usuarioDaSessao(db, req.cookies?.[COOKIE]);
    if (!usuario) return res.status(401).json({ error: "Sessão expirada. Entre novamente." });
    // Proteção contra requisições forjadas de outros sites: alterações exigem este cabeçalho.
    if (!["GET", "HEAD"].includes(req.method) && req.headers["x-requested-with"] !== "painel") return res.status(403).json({ error: "Requisição não autorizada." });
    (req as Request & { usuario?: string }).usuario = usuario;
    next();
  });
  admin.post("/logout", rota((req, res) => { sair(db, req.cookies?.[COOKIE]); res.clearCookie(COOKIE, { path: "/" }); return { ok: true }; }));
  admin.get("/me", rota((req) => ({ usuario: (req as Request & { usuario?: string }).usuario, versao: deps.versao })));
  admin.get("/config", rota(() => ({
    chave_publica: deps.chavePublicaPem,
    base_domain: cfg.baseDomain,
    provedor: { configurado: true },
    cobranca_configurada: Boolean(cfg.asaasApiKey),
    webhook_configurado: Boolean(cfg.asaasWebhookToken),
    webhook_url: cfg.urlPublica ? `${cfg.urlPublica}/webhooks/asaas` : null,
    carencia_padrao_dias: cfg.carenciaPadraoDias,
    teste_padrao_dias: cfg.testePadraoDias,
    entitlements: Object.fromEntries(Object.entries(ENTITLEMENTS).map(([k, v]) => [k, { tipo: v.tipo, rotulo: v.rotulo, padrao: v.padrao }])),
  })));
  admin.get("/planos", rota(() => servico.listarPlanos()));
  admin.post("/planos", rota((req, res) => { res.status(201); return servico.criarPlano(req.body || {}); }));
  admin.put("/planos/:id", rota((req) => servico.atualizarPlano(String(req.params.id), req.body || {})));
  admin.get("/escritorios", rota(() => servico.listarEscritorios()));
  admin.post("/escritorios", rota(async (req, res) => {
    const r = await servico.criarEscritorio(req.body || {});
    res.status(201);
    const porta = Number(req.body?.porta) || undefined;
    return { ...r, provisionamento: servico.provisionamento(r.escritorio.id, r.chave, { novaInstancia: true, porta, chavePublicaPem: deps.chavePublicaPem }) };
  }));
  admin.get("/escritorios/:id", rota((req) => servico.obterEscritorio(String(req.params.id))));
  admin.put("/escritorios/:id", rota((req) => servico.atualizarEscritorio(String(req.params.id), req.body || {})));
  admin.post("/escritorios/:id/suspender", rota((req) => servico.suspender(String(req.params.id), String(req.body?.motivo || ""))));
  admin.post("/escritorios/:id/reativar", rota((req) => servico.reativar(String(req.params.id))));
  admin.post("/escritorios/:id/cancelar", rota((req) => servico.cancelar(String(req.params.id))));
  admin.post("/escritorios/:id/pagamento-manual", rota((req) => servico.registrarPagamentoManual(String(req.params.id), req.body?.ate, String(req.body?.observacao || ""))));
  admin.post("/escritorios/:id/cobranca", rota((req) => servico.criarCobranca(String(req.params.id))));
  admin.post("/escritorios/:id/nova-chave", rota((req) => {
    const id = String(req.params.id);
    const { chave } = servico.rotacionarChave(id);
    return { chave, provisionamento: servico.provisionamento(id, chave, { novaInstancia: req.body?.nova_instancia === true, porta: Number(req.body?.porta) || undefined, chavePublicaPem: deps.chavePublicaPem }) };
  }));
  app.use("/api/admin", admin);

  // ---------- interface ----------
  const web = deps.webDir ?? path.resolve(__dirname, "../../painel-web");
  app.use(express.static(web, { index: "index.html", maxAge: 0 }));

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[painel] erro", err);
    res.status(500).json({ error: "Erro interno do painel." });
  });
  return app;
}
