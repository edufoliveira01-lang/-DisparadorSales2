const TELEGRAM_API = "https://api.telegram.org";

export class TelegramError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TelegramError";
    this.status = status;
  }
}

interface TelegramApiResponse<T> {
  ok: boolean;
  description?: string;
  result?: T;
}

async function telegramFetch<T>(token: string, method: string, body?: Record<string, unknown>): Promise<T> {
  const url = `${TELEGRAM_API}/bot${token}/${method}`;

  let response: Response;
  try {
    response = await fetch(url, {
      method: body ? "POST" : "GET",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new TelegramError(`Falha de rede ao conectar com o Telegram: ${(err as Error).message}`);
  }

  let payload: TelegramApiResponse<T>;
  try {
    payload = (await response.json()) as TelegramApiResponse<T>;
  } catch {
    throw new TelegramError(`Resposta inesperada do Telegram (HTTP ${response.status}).`, response.status);
  }

  if (response.status === 401 || response.status === 404) {
    throw new TelegramError("Token do bot inválido ou não encontrado.", response.status);
  }
  if (!response.ok || !payload.ok) {
    throw new TelegramError(payload.description || `Erro ao consultar o Telegram (HTTP ${response.status}).`, response.status);
  }
  return payload.result as T;
}

interface TelegramUpdate {
  message?: { chat?: { id?: number } };
}

/**
 * Descobre o chat_id a partir das mensagens que o usuário já mandou pro bot (o Telegram exige
 * que o usuário inicie a conversa antes de qualquer bot poder mandar mensagem pra ele — não tem
 * como "adivinhar" o chat_id sem isso). Pega o mais recente encontrado.
 */
export async function detectarChatId(token: string): Promise<string | null> {
  const updates = await telegramFetch<TelegramUpdate[]>(token, "getUpdates");
  for (let i = updates.length - 1; i >= 0; i--) {
    const chatId = updates[i].message?.chat?.id;
    if (chatId !== undefined) return String(chatId);
  }
  return null;
}

export async function enviarMensagemTelegram(token: string, chatId: string, texto: string): Promise<void> {
  await telegramFetch(token, "sendMessage", { chat_id: chatId, text: texto });
}
