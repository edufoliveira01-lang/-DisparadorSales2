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
  const app = criarAppPainel({ db, cfg, servico: new ServicoPainel(db, cfg, provedor, privada), chavePublicaPem: publica, versao });
  app.listen(cfg.porta, () => console.log(`[painel] Painel de controle em http://localhost:${cfg.porta}`));
}
main().catch((e) => { console.error("[painel] falha ao iniciar:", e); process.exit(1); });
