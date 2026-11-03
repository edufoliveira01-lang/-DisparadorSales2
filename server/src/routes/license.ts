import { Router } from "express";
import { licenca } from "../licenca/cliente";

export const licenseRouter = Router();

/** Situação da assinatura para o aviso da interface. Nunca expõe a chave de licença. */
licenseRouter.get("/status", (_req, res) => {
  const e = licenca().estado();
  res.json({ modo: e.modo, status: e.status, restrito: e.restrito, aviso: e.aviso, vence_em: e.vence_em, dias_restantes: e.dias_restantes, plano: e.plano, entitlements: e.entitlements, ultima_verificacao_ok: e.ultima_verificacao_ok });
});
/** Força uma consulta ao painel (por exemplo, logo após regularizar o pagamento). */
licenseRouter.post("/verificar-agora", async (_req, res) => {
  const ok = await licenca().verificar();
  const e = licenca().estado();
  res.json({ ok, status: e.status, restrito: e.restrito, aviso: e.aviso });
});
