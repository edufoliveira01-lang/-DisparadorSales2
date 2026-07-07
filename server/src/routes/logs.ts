import { Router } from "express";
import { dispatchSingle } from "../services/dispatchService";
import { getLog, listLogs } from "../services/logsService";
import type { Pericia } from "../services/parserService";

export const logsRouter = Router();

logsRouter.get("/", (_req, res) => {
  res.json(listLogs());
});

logsRouter.post("/:id/reenviar", async (req, res) => {
  const id = Number(req.params.id);
  const log = getLog(id);
  if (!log) return res.status(404).json({ error: "Registro de envio não encontrado." });

  const { templateId } = req.body as { templateId: number };
  if (!templateId) return res.status(400).json({ error: "Selecione um template de mensagem." });
  if (!log.telefone) return res.status(400).json({ error: "Este registro não tem telefone associado." });

  let pericias: Pericia[] = [];
  try {
    pericias = log.pericias_json ? JSON.parse(log.pericias_json) : [];
  } catch {
    return res.status(400).json({ error: "Não foi possível reconstruir os dados da perícia deste registro." });
  }

  try {
    const novoLog = await dispatchSingle(
      {
        cardId: log.card_id,
        cardNome: log.card_nome || "",
        telefone: log.telefone,
        contactId: log.contact_id,
        pericias,
      },
      templateId
    );
    res.json({ ok: true, log: novoLog });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
