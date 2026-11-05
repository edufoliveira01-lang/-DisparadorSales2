import { Router } from "express";
import { atendimentoDaInstancia, enderecoDeEntrada } from "../atendimento/instancia";
import { auditAccess } from "../services/accessService";

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
  res.redirect(302, enderecoDeEntrada(a, email));
});
