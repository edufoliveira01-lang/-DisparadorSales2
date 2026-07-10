import { Router } from "express";
import type { Pericia } from "../services/parserService";
import {
  createTemplate,
  deleteTemplate,
  getTemplate,
  listTemplates,
  renderMessages,
  updateTemplate,
} from "../services/templateService";

export const templatesRouter = Router();

templatesRouter.get("/", (_req, res) => {
  res.json(listTemplates());
});

templatesRouter.post("/", (req, res) => {
  const {
    nome,
    conteudo_1_pericia,
    conteudo_2_pericias,
    conteudo_pericia_medica,
    conteudo_pericia_social,
    modo_envio_2_pericias,
  } = req.body;
  if (!nome?.trim() || !conteudo_1_pericia?.trim() || !conteudo_2_pericias?.trim()) {
    return res.status(400).json({ error: "Nome e os dois conteúdos de mensagem são obrigatórios." });
  }
  res.status(201).json(
    createTemplate({
      nome,
      conteudo_1_pericia,
      conteudo_2_pericias,
      conteudo_pericia_medica: conteudo_pericia_medica || null,
      conteudo_pericia_social: conteudo_pericia_social || null,
      modo_envio_2_pericias: modo_envio_2_pericias === "separadas" ? "separadas" : "combinada",
    })
  );
});

templatesRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getTemplate(id)) return res.status(404).json({ error: "Template não encontrado." });

  const {
    nome,
    conteudo_1_pericia,
    conteudo_2_pericias,
    conteudo_pericia_medica,
    conteudo_pericia_social,
    modo_envio_2_pericias,
  } = req.body;
  if (!nome?.trim() || !conteudo_1_pericia?.trim() || !conteudo_2_pericias?.trim()) {
    return res.status(400).json({ error: "Nome e os dois conteúdos de mensagem são obrigatórios." });
  }
  res.json(
    updateTemplate(id, {
      nome,
      conteudo_1_pericia,
      conteudo_2_pericias,
      conteudo_pericia_medica: conteudo_pericia_medica || null,
      conteudo_pericia_social: conteudo_pericia_social || null,
      modo_envio_2_pericias: modo_envio_2_pericias === "separadas" ? "separadas" : "combinada",
    })
  );
});

templatesRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getTemplate(id)) return res.status(404).json({ error: "Template não encontrado." });
  deleteTemplate(id);
  res.status(204).send();
});

templatesRouter.post("/preview", (req, res) => {
  const {
    templateId,
    nome,
    pericias,
    conteudo_1_pericia,
    conteudo_2_pericias,
    conteudo_pericia_medica,
    conteudo_pericia_social,
    modo_envio_2_pericias,
  } = req.body as {
    templateId?: number;
    nome: string;
    pericias: Pericia[];
    conteudo_1_pericia?: string;
    conteudo_2_pericias?: string;
    conteudo_pericia_medica?: string;
    conteudo_pericia_social?: string;
    modo_envio_2_pericias?: "combinada" | "separadas";
  };

  let templateData;
  if (templateId) {
    const template = getTemplate(templateId);
    if (!template) return res.status(404).json({ error: "Template não encontrado." });
    templateData = template;
  } else {
    if (!conteudo_1_pericia || !conteudo_2_pericias) {
      return res.status(400).json({ error: "Informe templateId ou os conteúdos para pré-visualizar." });
    }
    templateData = {
      conteudo_1_pericia,
      conteudo_2_pericias,
      conteudo_pericia_medica,
      conteudo_pericia_social,
      modo_envio_2_pericias: modo_envio_2_pericias || "combinada",
    };
  }

  try {
    const mensagens = renderMessages(templateData, nome || "Cliente Exemplo", pericias || []);
    res.json({ mensagens });
  } catch (err) {
    res.status(400).json({ error: `Erro ao renderizar template: ${(err as Error).message}` });
  }
});
