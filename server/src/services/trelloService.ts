const TRELLO_API = "https://api.trello.com/1";

export class TrelloError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "TrelloError";
    this.status = status;
  }
}

export interface TrelloBoard {
  id: string;
  name: string;
}

export interface TrelloList {
  id: string;
  name: string;
}

export interface TrelloCard {
  id: string;
  name: string;
  desc: string;
  due: string | null;
  shortUrl: string;
}

async function trelloFetch<T>(path: string, key: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(`${TRELLO_API}${path}`);
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  let response: Response;
  try {
    response = await fetch(url.toString());
  } catch (err) {
    throw new TrelloError(`Falha de rede ao conectar com o Trello: ${(err as Error).message}`);
  }

  if (response.status === 401 || response.status === 403) {
    throw new TrelloError("Credenciais do Trello inválidas (API Key ou Token incorretos/expirados).", response.status);
  }
  if (!response.ok) {
    throw new TrelloError(`Erro ao consultar o Trello (HTTP ${response.status}).`, response.status);
  }
  return (await response.json()) as T;
}

export async function validateCredentials(key: string, token: string): Promise<{ id: string; fullName: string }> {
  return trelloFetch<{ id: string; fullName: string }>("/members/me", key, token, { fields: "id,fullName" });
}

export async function getBoards(key: string, token: string): Promise<TrelloBoard[]> {
  return trelloFetch<TrelloBoard[]>("/members/me/boards", key, token, {
    fields: "id,name",
    filter: "open",
  });
}

export async function getLists(key: string, token: string, boardId: string): Promise<TrelloList[]> {
  return trelloFetch<TrelloList[]>(`/boards/${boardId}/lists`, key, token, {
    fields: "id,name",
    filter: "open",
  });
}

export async function getCardsFromList(key: string, token: string, listId: string): Promise<TrelloCard[]> {
  return trelloFetch<TrelloCard[]>(`/lists/${listId}/cards`, key, token, {
    fields: "id,name,desc,due,shortUrl",
  });
}

export async function moveCard(key: string, token: string, cardId: string, listId: string): Promise<void> {
  const url = new URL(`${TRELLO_API}/cards/${cardId}`);
  url.searchParams.set("key", key);
  url.searchParams.set("token", token);
  url.searchParams.set("idList", listId);

  const response = await fetch(url.toString(), { method: "PUT" });
  if (!response.ok) {
    throw new TrelloError(`Erro ao mover o card no Trello (HTTP ${response.status}).`, response.status);
  }
}
