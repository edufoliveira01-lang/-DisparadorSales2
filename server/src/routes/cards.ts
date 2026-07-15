import { Router } from "express";
import { listContacts } from "../services/contactsService";
import { getLastStatusForCard } from "../services/logsService";
import { matchContact } from "../services/matcherService";
import {
  extractNomeFromCardTitle,
  isPericiaCompleta,
  parseCardDescriptionComOrigem,
  sortPericiasByDate,
} from "../services/parserService";
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
      let pericias = parseCardDescriptionComOrigem(card.desc);
      pericias = sortPericiasByDate(pericias);
      const incompleta = pericias.length === 0 || pericias.some((p) => !isPericiaCompleta(p));

      // Prioridade de nome:
      // 1. Campo NOME extraído da descrição (já vem dentro do objeto pericia)
      // 2. Fallback inteligente do título do card (limpando datas e códigos)
      // 3. Título bruto do card (último caso)
      const nomeCliente = pericias[0]?.nome || extractNomeFromCardTitle(card.name);

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
