import { Router } from "express";
import { getAllSettings, getSetting, setSetting } from "../services/settingsService";
import { detectarChatId, enviarMensagemTelegram, TelegramError } from "../services/telegramService";
import { enviarMensagemWhapi, WhapiError } from "../services/whapiService";
import {
  AUDIENCIA_HIBRIDA_MENSAGEM_PADRAO,
  AUDIENCIA_ONLINE_MENSAGEM_PADRAO,
  AUDIENCIA_PRESENCIAL_MENSAGEM_PADRAO,
  COBRANCA_AUDIENCIA_MENSAGEM_PADRAO,
  COBRANCA_MENSAGEM_PADRAO,
} from "../services/templateService";

export const settingsRouter = Router();

const DEFAULTS: Record<string, string> = {
  send_interval_min: "5",
  send_interval_max: "15",
  telegram_alerta_horas: "48",
  telegram_alerta_horas_resposta: "48",
  cobranca_mensagem: COBRANCA_MENSAGEM_PADRAO,
  cobranca_audiencia_mensagem: COBRANCA_AUDIENCIA_MENSAGEM_PADRAO,
  audiencia_presencial_mensagem: AUDIENCIA_PRESENCIAL_MENSAGEM_PADRAO,
  audiencia_online_mensagem: AUDIENCIA_ONLINE_MENSAGEM_PADRAO,
  audiencia_hibrida_mensagem: AUDIENCIA_HIBRIDA_MENSAGEM_PADRAO,
};

settingsRouter.get("/", (_req, res) => {
  const settings = getAllSettings();
  res.json({ ...DEFAULTS, ...settings });
});

settingsRouter.put("/", (req, res) => {
  const body = req.body as Record<string, string>;
  const allowedKeys = [
    "trello_key",
    "trello_token",
    "trello_board_id",
    "trello_board_nome",
    "trello_list_id",
    "trello_list_nome",
    "send_interval_min",
    "send_interval_max",
    "template_ativo_id",
    "trello_move_list_id",
    "trello_move_list_nome",
    "trello_confirm_list_id",
    "trello_confirm_list_nome",
    "telegram_bot_token",
    "telegram_chat_id",
    "telegram_alerta_horas",
    "telegram_alerta_horas_resposta",
    "whapi_token",
    "whapi_api_url",
    "whapi_numero_notificacao",
    "cobranca_mensagem",
    "cobranca_audiencia_mensagem",
    "audiencia_presencial_mensagem",
    "audiencia_online_mensagem",
    "audiencia_hibrida_mensagem",
  ];

  for (const key of allowedKeys) {
    if (typeof body[key] === "string") {
      setSetting(key, body[key]);
    }
  }

  res.json({ ok: true });
});

settingsRouter.get("/trello-status", (_req, res) => {
  const key = getSetting("trello_key");
  const token = getSetting("trello_token");
  res.json({ configurado: Boolean(key && token) });
});

function handleTelegramError(res: import("express").Response, err: unknown) {
  if (err instanceof TelegramError) {
    return res.status(err.status && err.status >= 400 && err.status < 500 ? err.status : 502).json({ error: err.message });
  }
  return res.status(502).json({ error: "Erro inesperado ao consultar o Telegram." });
}

// O Telegram só deixa um bot mandar mensagem pra alguém que já iniciou uma conversa com ele
// (proteção contra spam) — então não tem como descobrir o chat_id sem o usuário mandar pelo
// menos uma mensagem pro bot primeiro. getUpdates devolve o histórico recente de mensagens
// recebidas, de onde extraímos o chat_id mais recente.
settingsRouter.post("/telegram/detectar-chat-id", async (req, res) => {
  try {
    const token = (req.body?.token as string) || getSetting("telegram_bot_token") || "";
    if (!token) return res.status(400).json({ error: "Informe o token do bot." });
    const chatId = await detectarChatId(token);
    if (!chatId) {
      return res
        .status(404)
        .json({ error: "Nenhuma conversa encontrada. Mande uma mensagem qualquer para o bot no Telegram e tente de novo." });
    }
    res.json({ chatId });
  } catch (err) {
    handleTelegramError(res, err);
  }
});

settingsRouter.post("/telegram/testar", async (req, res) => {
  try {
    const token = (req.body?.token as string) || getSetting("telegram_bot_token") || "";
    const chatId = (req.body?.chatId as string) || getSetting("telegram_chat_id") || "";
    if (!token || !chatId) return res.status(400).json({ error: "Configure o token do bot e o chat_id antes de testar." });
    await enviarMensagemTelegram(token, chatId, "🔔 Teste do DisparaZap: as notificações estão funcionando!");
    res.json({ ok: true });
  } catch (err) {
    handleTelegramError(res, err);
  }
});

function handleWhapiError(res: import("express").Response, err: unknown) {
  if (err instanceof WhapiError) {
    return res.status(err.status && err.status >= 400 && err.status < 500 ? err.status : 502).json({ error: err.message });
  }
  return res.status(502).json({ error: "Erro inesperado ao consultar a Whapi." });
}

settingsRouter.post("/whapi/testar", async (req, res) => {
  try {
    const apiUrl = (req.body?.apiUrl as string) || getSetting("whapi_api_url") || "";
    const token = (req.body?.token as string) || getSetting("whapi_token") || "";
    const numero = (req.body?.numero as string) || getSetting("whapi_numero_notificacao") || "";
    if (!apiUrl || !token || !numero) {
      return res.status(400).json({ error: "Configure a URL da API, o token e o número de notificação antes de testar." });
    }
    await enviarMensagemWhapi(apiUrl, token, numero, "🔔 Teste do DisparaZap: as notificações via WhatsApp (Whapi) estão funcionando!");
    res.json({ ok: true });
  } catch (err) {
    handleWhapiError(res, err);
  }
});
