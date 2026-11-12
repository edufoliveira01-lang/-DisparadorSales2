import { Router } from "express";
import { atendimentoDaInstancia, enderecoDeEntrada } from "../atendimento/instancia";
import { auditAccess, hasPermission } from "../services/accessService";
import { ErroEquipe, sincronizarEquipe } from "../atendimento/equipe";
import { configPublicaZapSign, salvarConfigZapSign } from "../zapsign/config";

/** Atendimento e vendas por WhatsApp com IA (DeskcommCRM, em outro servidor). Permissão: atendimento.use. */
export const atendimentoRouter = Router();

atendimentoRouter.get("/info", (_req, res) => {
  const a = atendimentoDaInstancia();
  res.json({ disponivel: Boolean(a), url: a?.url || null });
});

/** Leva a pessoa logada ao atendimento, sem pedir outra senha. Ela precisa existir como membro lá (mesmo e-mail). */
atendimentoRouter.get("/entrar", (req, res) => {
  const a = atendimentoDaInstancia();
  if (!a) return void res.status(404).type("text").send("O atendimento não está liberado para este escritório.");
  const email = req.accessUser?.email?.trim();
  if (!email) return void res.status(400).type("text").send("Cadastre o seu e-mail em Minha conta para entrar no atendimento.");
  auditAccess("atendimento_entrada", req.accessUser!.id, null, { slug: a.slug });
  res.setHeader("Cache-Control", "no-store");
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  res.redirect(302, enderecoDeEntrada(a, email, String(req.query.telefone ?? ""), host ? `https://${host}` : ""));
});

/** Envia ao atendimento as pessoas da equipe que têm e-mail (papel traduzido). Só quem gerencia a equipe. */
atendimentoRouter.post("/equipe/sincronizar", async (req, res) => {
  if (!req.accessUser || !hasPermission(req.accessUser, "team.manage")) return void res.status(403).json({ error: "Somente quem gerencia a equipe pode sincronizá-la com o atendimento." });
  if (!atendimentoDaInstancia()) return void res.status(404).json({ error: "O atendimento não está liberado para este escritório." });
  try {
    const r = await sincronizarEquipe();
    auditAccess("atendimento_equipe", req.accessUser.id, null, { enviados: r.enviados, ok: r.ok });
    res.json(r);
  } catch (e) {
    if (e instanceof ErroEquipe) return void res.status(e.status).json({ error: e.message });
    throw e;
  }
});

/** ZapSign (assinatura dos contratos): o token fica criptografado e nunca volta inteiro para a tela. Só quem gerencia a equipe. */
atendimentoRouter.get("/zapsign", (req, res) => {
  if (!req.accessUser || !hasPermission(req.accessUser, "team.manage")) return void res.status(403).json({ error: "Somente quem gerencia a equipe pode ver esta configuração." });
  res.json(configPublicaZapSign());
});
atendimentoRouter.put("/zapsign", (req, res) => {
  if (!req.accessUser || !hasPermission(req.accessUser, "team.manage")) return void res.status(403).json({ error: "Somente quem gerencia a equipe pode alterar esta configuração." });
  try {
    const r = salvarConfigZapSign(req.body || {});
    auditAccess("zapsign_configurado", req.accessUser.id, null, { ambiente: r.ambiente });
    res.json(r);
  } catch (e) { res.status(400).json({ error: e instanceof Error ? e.message : "Configuração inválida." }); }
});
