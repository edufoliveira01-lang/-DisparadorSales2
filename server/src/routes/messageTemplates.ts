import { Router } from "express";
import Handlebars from "handlebars";
import { GROUPS, initializeMessageTemplates, listMessageTemplates, saveMessageTemplate, deleteMessageTemplate } from "../services/messageTemplateService";

export const messageTemplatesRouter = Router();
initializeMessageTemplates();

messageTemplatesRouter.get("/", (req, res) => {
  const categoria = String(req.query.categoria || "");
  if (!GROUPS[categoria]) return res.status(400).json({ error: "Categoria inválida." });
  res.json({ templates: listMessageTemplates(categoria), scopes: GROUPS[categoria] });
});
messageTemplatesRouter.post("/preview", (req, res) => {
  try {
    if (typeof req.body.mensagem !== "string") throw new Error("Informe uma mensagem.");
    res.json({ mensagem: Handlebars.compile(req.body.mensagem, { noEscape: true })(req.body.variables || {}) });
  } catch (error) { res.status(400).json({ error: (error as Error).message }); }
});
messageTemplatesRouter.post("/", (req, res) => {
  try { res.status(201).json(saveMessageTemplate(req.body)); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); }
});
messageTemplatesRouter.put("/:id", (req, res) => {
  try { res.json(saveMessageTemplate(req.body, Number(req.params.id))); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); }
});
messageTemplatesRouter.delete("/:id", (req, res) => {
  try { deleteMessageTemplate(Number(req.params.id)); res.status(204).send(); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); }
});
