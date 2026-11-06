import "../loadEnv";
import fs from "node:fs";
import path from "node:path";
import { abrirBancoPainel } from "./banco";
import { lerConfigPainel } from "./config";
import { AsaasProvider } from "./asaas";
import { ServicoPainel } from "./servico";
import { criarAppPainel } from "./app";
import { garantirAdmin } from "./auth";
import { gerarParDeChaves } from "../licenca/token";
import { Provisionador } from "./provisionador";
import { ClientePonte } from "../atendimento/ponte";
import { criarRotaContratos } from "../atendimento/rotaContratos";
import { bancoSupabase } from "../atendimento/banco";
import { criarRotaPonte, lerConfigPonteInterna } from "../atendimento/rotaPonte";

/** Painel de controle do SaaS: planos, escritórios, cobrança (Asaas) e emissão de licenças. */
async function main() {
  const cfg = lerConfigPainel();
  fs.mkdirSync(cfg.dadosDir, { recursive: true, mode: 0o700 });
  const arqPriv = path.join(cfg.dadosDir, "licenca-privada.pem");
  const arqPub = path.join(cfg.dadosDir, "licenca-publica.pem");
  if (!fs.existsSync(arqPriv)) {
    const par = gerarParDeChaves();
    fs.writeFileSync(arqPriv, par.privada, { mode: 0o600 });
    fs.writeFileSync(arqPub, par.publica, { mode: 0o644 });
    console.log("[painel] Par de chaves de licença gerado em", cfg.dadosDir, "(faça backup da chave privada).");
  }
  const privada = fs.readFileSync(arqPriv, "utf8");
  const publica = fs.readFileSync(arqPub, "utf8");
  const db = abrirBancoPainel(path.join(cfg.dadosDir, "painel.sqlite3"));
  const admin = await garantirAdmin(db, cfg);
  if (admin === "criado") console.log(`[painel] Administrador "${cfg.adminUsuario}" criado. Remova PAINEL_ADMIN_PASSWORD do ambiente.`);
  if (admin === "ausente") console.warn("[painel] Nenhum administrador. Defina PAINEL_ADMIN_PASSWORD (mínimo 12 caracteres) e reinicie.");
  const provedor = new AsaasProvider({ apiKey: cfg.asaasApiKey, baseUrl: cfg.asaasBaseUrl });
  if (!provedor.configurado()) console.warn("[painel] ASAAS_API_KEY ausente: cobranças automáticas desativadas (use pagamento manual).");
  if (!cfg.asaasWebhookToken) console.warn("[painel] ASAAS_WEBHOOK_TOKEN ausente: o webhook de pagamentos responde 503.");
  const versao = (JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../package.json"), "utf8")) as { version: string }).version;
  const ponte = cfg.atendimento ? new ClientePonte({ url: cfg.atendimento.url, segredo: cfg.atendimento.segredo }) : null;
  const servico = new ServicoPainel(db, cfg, provedor, privada, () => new Date(), ponte);
  let pi: ReturnType<typeof lerConfigPonteInterna> = null;
  try { pi = lerConfigPonteInterna(); } catch (e) { console.error("[painel] Ponte do atendimento NÃO ligada:", (e as Error).message); }
  const rotaPonte = pi ? criarRotaPonte(bancoSupabase(pi.supabaseUrl, pi.chaveServico), pi) : undefined;
  if (rotaPonte) console.log("[painel] Ponte do atendimento embutida ligada em /ponte");
  const segredoContratos = (process.env.CONTRATOS_SEGREDO || "").trim();
  const rotaContratos = cfg.atendimento && segredoContratos.length >= 32
    ? criarRotaContratos({ segredoDeskcomm: segredoContratos, segredoAtendimento: cfg.atendimento.segredo, porta: (slug) => servico.portaDoSlug(slug) })
    : undefined;
  if (rotaContratos) console.log("[painel] Contratos do atendimento ligados em /contratos");
  else if (cfg.atendimento) console.log("[painel] Contratos do atendimento DESLIGADOS (defina CONTRATOS_SEGREDO com 32+ caracteres para ligar).");
  const app = criarAppPainel({ db, cfg, servico: servico, chavePublicaPem: publica, versao, provisionador: new Provisionador(cfg), ponte: rotaPonte, contratos: rotaContratos });
  if (ponte) {
    console.log("[painel] Atendimento (DeskcommCRM) ligado pela ponte", cfg.atendimento!.url);
    // Vencimentos mudam com o tempo sem nenhum evento: confere de tempos em tempos e repete o que tiver falhado.
    setTimeout(() => void servico.reconciliarAtendimento().catch(() => undefined), 20_000).unref();
    setInterval(() => void servico.reconciliarAtendimento().catch(() => undefined), 15 * 60_000).unref();
  } else console.log("[painel] Atendimento desligado (defina ATENDIMENTO_PONTE_URL e ATENDIMENTO_SEGREDO para ligar).");
  if (cfg.autoProvisionar) console.log("[painel] Provisionamento automático de escritórios ligado.");
  app.listen(cfg.porta, () => console.log(`[painel] Painel de controle em http://localhost:${cfg.porta}`));
}
main().catch((e) => { console.error("[painel] falha ao iniciar:", e); process.exit(1); });
