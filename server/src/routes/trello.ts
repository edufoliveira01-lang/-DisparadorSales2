import { Router } from "express";
import { getSetting } from "../services/settingsService";
import { getBoards, getCardsFromList, getLists, TrelloError, validateCredentials } from "../services/trelloService";

export const trelloRouter = Router();

function credentialsFromRequest(req: import("express").Request): { key: string; token: string } {
  const key = (req.body?.key as string) || (req.query.key as string) || getSetting("trello_key") || "";
  const token = (req.body?.token as string) || (req.query.token as string) || getSetting("trello_token") || "";
  return { key, token };
}

function handleTrelloError(res: import("express").Response, err: unknown) {
  if (err instanceof TrelloError) {
    return res.status(err.status && err.status >= 400 && err.status < 500 ? err.status : 502).json({ error: err.message });
  }
  return res.status(502).json({ error: "Erro inesperado ao consultar o Trello." });
}

trelloRouter.post("/validate", async (req, res) => {
  try {
    const { key, token } = credentialsFromRequest(req);
    if (!key || !token) return res.status(400).json({ error: "Informe API Key e Token." });
    const member = await validateCredentials(key, token);
    res.json({ ok: true, member });
  } catch (err) {
    handleTrelloError(res, err);
  }
});

trelloRouter.get("/boards", async (req, res) => {
  try {
    const { key, token } = credentialsFromRequest(req);
    if (!key || !token) return res.status(400).json({ error: "Credenciais do Trello não configuradas." });
    const boards = await getBoards(key, token);
    res.json(boards);
  } catch (err) {
    handleTrelloError(res, err);
  }
});

trelloRouter.get("/boards/:boardId/lists", async (req, res) => {
  try {
    const { key, token } = credentialsFromRequest(req);
    if (!key || !token) return res.status(400).json({ error: "Credenciais do Trello não configuradas." });
    const lists = await getLists(key, token, req.params.boardId);
    res.json(lists);
  } catch (err) {
    handleTrelloError(res, err);
  }
});

trelloRouter.get("/lists/:listId/cards", async (req, res) => {
  try {
    const { key, token } = credentialsFromRequest(req);
    if (!key || !token) return res.status(400).json({ error: "Credenciais do Trello não configuradas." });
    const cards = await getCardsFromList(key, token, req.params.listId);
    res.json(cards);
  } catch (err) {
    handleTrelloError(res, err);
  }
});
