import { Router } from "express";
import { dispatchSingle } from "../services/dispatchService";
import { deleteLog, deleteLogs, getLog, listLogs } from "../services/logsService";
import type { Pericia } from "../services/parserService";
import { resendStoredInformation } from "../services/informationResendService";

const reenviosEmAndamento = new Set<string>();
const reenviosRecentes = new Map<string, number>();
const INTERVALO_REENVIO_MS = 30000;

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
        nomeCliente: log.card_nome || "",
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

logsRouter.post("/:id/reenviar-informacoes", async (req, res) => {
  const id = Number(req.params.id);
  const log = getLog(id);
  if (!log) return res.status(404).json({ error: "Registro de envio não encontrado." });
  if (log.tipo_envio === "lembrete") return res.status(400).json({ error: "Este registro é um lembrete, não uma mensagem de perícia." });
  if (!log.telefone) return res.status(400).json({ error: "Este registro não tem telefone associado." });
  if (!log.mensagem_enviada?.trim()) return res.status(400).json({ error: "Este registro não possui uma mensagem para reenviar." });

  const chave = log.telefone.replace(/\D/g, "");
  for (const [telefone, ate] of reenviosRecentes) if (ate <= Date.now()) reenviosRecentes.delete(telefone);
  if (reenviosEmAndamento.has(chave) || reenviosRecentes.has(chave)) {
    return res.status(409).json({ error: "Um reenvio para este telefone está em andamento ou acabou de ser tentado. Aguarde 30 segundos e confira a conversa." });
  }

  reenviosEmAndamento.add(chave);
  try {
    const novoLog = await resendStoredInformation(log);
    res.json({ ok: true, log: novoLog });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : "Erro ao reenviar as informações da perícia." });
  } finally {
    reenviosEmAndamento.delete(chave);
    reenviosRecentes.set(chave, Date.now() + INTERVALO_REENVIO_MS);
  }
});

logsRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!getLog(id)) return res.status(404).json({ error: "Registro de envio não encontrado." });
  deleteLog(id);
  res.json({ ok: true });
});

logsRouter.post("/apagar-em-massa", (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Nenhum registro selecionado." });
  }

  const apagados = deleteLogs(ids.filter((id) => Number.isInteger(id)));
  res.json({ ok: true, apagados });
});
