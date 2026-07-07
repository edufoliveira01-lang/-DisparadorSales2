import { Router } from "express";
import { listContacts } from "../services/contactsService";
import { getLastStatusForCard } from "../services/logsService";
import { matchContact } from "../services/matcherService";
import { isPericiaCompleta, parseCardDescription } from "../services/parserService";
import { getSetting } from "../services/settingsService";
import { getCardsFromList, TrelloError } from "../services/trelloService";

export const cardsRouter = Router();

cardsRouter.get("/", async (_req, res) => {
  const key = getSetting("trello_key");
  const token = getSetting("trello_token");
  const listId = getSetting("trello_list_id");

  if (!key || !token || !listId) {
    return res.status(400).json({ error: "Configure o Trello (API Key, Token e Lista) na tela de Configurações." });
  }

  try {
    const trelloCards = await getCardsFromList(key, token, listId);
    const contacts = listContacts();

    const cards = trelloCards.map((card) => {
      const pericias = parseCardDescription(card.desc);
      const incompleta = pericias.length === 0 || pericias.some((p) => !isPericiaCompleta(p));
      const nomeCliente = pericias[0]?.nome || card.name;
      const match = matchContact(nomeCliente, contacts);
      const lastLog = getLastStatusForCard(card.id);

      return {
        cardId: card.id,
        cardNome: card.name,
        shortUrl: card.shortUrl,
        due: card.due,
        pericias,
        incompleta,
        nomeCliente,
        contato: match.exact,
        sugestaoContato: match.sugestao,
        ultimoEnvio: lastLog ? { status: lastLog.status, data: lastLog.created_at, erro: lastLog.erro } : null,
      };
    });

    res.json(cards);
  } catch (err) {
    if (err instanceof TrelloError) return res.status(502).json({ error: err.message });
    res.status(500).json({ error: "Erro inesperado ao montar o dashboard." });
  }
});
