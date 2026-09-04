import { Router } from "express";
import { deletePericiaAgendada, listPericiasAgendadas } from "../services/periciasAgendadasService";
import { sincronizarPericiasDoTrello } from "../services/periciasTrelloSyncService";
import {
  enviarLembretePorId,
  enviarLembretesEmMassa,
  loteLembretesEmAndamento,
} from "../services/lembreteService";
import { getSetting } from "../services/settingsService";
import { TrelloError } from "../services/trelloService";

export const periciasAgendadasRouter = Router();

// Sem filtros de mês/ano aqui de propósito: a retenção de 3 meses (ver podarPericiasAgendadasAntigas
// em index.ts) já limita o volume, e agrupar por dia/mês fica mais simples no fuso do navegador do
// usuário (America/Sao_Paulo) do que recalculando limites de mês em UTC no servidor.
periciasAgendadasRouter.get("/", (_req, res) => {
  res.json(listPericiasAgendadas());
});

periciasAgendadasRouter.post("/sincronizar-trello", async (_req, res) => {
  const key = getSetting("trello_key");
  const token = getSetting("trello_token");
  const listId = getSetting("trello_arquivo_list_id");

  if (!key || !token) return res.status(400).json({ error: "Configure as credenciais do Trello antes de sincronizar." });
  if (!listId) {
    return res.status(400).json({ error: 'Selecione a "lista de casos antigos" em Configurações antes de sincronizar.' });
  }

  try {
    const resultado = await sincronizarPericiasDoTrello(key, token, listId);
    res.json({ ok: true, ...resultado });
  } catch (err) {
    const message = err instanceof TrelloError ? err.message : "Erro ao sincronizar com o Trello.";
    res.status(502).json({ error: message });
  }
});

periciasAgendadasRouter.post("/:id/lembrete", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Identificador de evento inválido." });

  try {
    const forcar = req.body?.forcar === true;
    const resultado = await enviarLembretePorId(id, forcar);
    if (resultado.status === "ignorado") {
      return res.status(409).json({ error: "Este compromisso já recebeu um lembrete. Use a opção de reenviar para confirmar um novo envio." });
    }
    res.json({ ok: true, resultado });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message || "Erro ao enviar lembrete." });
  }
});

// Roda em background: o progresso é acompanhado via WebSocket (lembrete:update / lembrete:batch-*),
// mesmo padrão do envio em lote principal (/send/batch).
periciasAgendadasRouter.post("/lembrete-em-massa", (req, res) => {
  const { ids } = req.body as { ids?: number[] };
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: "Nenhum evento selecionado." });
  }
  const idsValidos = ids.filter((id) => Number.isInteger(id) && id > 0);
  if (idsValidos.length === 0) return res.status(400).json({ error: "Nenhum evento selecionado." });
  if (idsValidos.length > 500) return res.status(400).json({ error: "Selecione no máximo 500 eventos por lote." });
  if (loteLembretesEmAndamento()) {
    return res.status(409).json({ error: "Já existe um lote de lembretes em andamento." });
  }

  const min = Number(getSetting("send_interval_min")) || 5;
  const max = Number(getSetting("send_interval_max")) || 15;
  const idsUnicos = Array.from(new Set(idsValidos));
  enviarLembretesEmMassa(idsUnicos, min, max).catch((err) => {
    console.error("[Lembretes] Falha inesperada no lote:", err);
  });
  res.json({ ok: true, total: idsUnicos.length });
});

periciasAgendadasRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "Identificador de evento inválido." });

  try {
    const apagou = deletePericiaAgendada(id);
    if (!apagou) return res.status(404).json({ error: "Registro não encontrado." });
    res.json({ ok: true });
  } catch (err) {
    console.error(`[Calendário] Erro ao apagar evento ${id}:`, err);
    res.status(500).json({ error: "Não foi possível apagar o evento do calendário." });
  }
});
