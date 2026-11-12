import { Router } from "express";
import { apagarLogsAntigos, listSystemLogs, recordSystemLog } from "../services/systemLogsService";
import { auditAccess, hasPermission } from "../services/accessService";

export const systemLogsRouter = Router();

systemLogsRouter.get("/", (req, res) => {
  const limit = Number(req.query.limit) || 500;
  res.json(listSystemLogs(limit));
});

/** Apaga registros antigos (?dias=30, ?dias=90 ou ?dias=todos). Só quem gerencia as integrações. */
systemLogsRouter.delete("/", (req, res) => {
  const usuario = req.accessUser;
  if (!usuario || !hasPermission(usuario, "integrations.manage")) { res.status(403).json({ error: "Você não tem permissão para apagar registros." }); return; }
  let apagados: number;
  try { apagados = apagarLogsAntigos(req.query.dias); } catch (e) { res.status(400).json({ error: (e as Error).message }); return; }
  auditAccess("logs_apagados", usuario.id, null, { dias: String(req.query.dias), apagados });
  recordSystemLog({ nivel: "info", categoria: "sistema", evento: "logs_apagados", titulo: "Registros antigos apagados", mensagem: `${apagados} registro(s) apagado(s) (${req.query.dias === "todos" ? "todos" : `mais de ${req.query.dias} dias`}).`, origem: "usuario" });
  res.json({ apagados });
});
