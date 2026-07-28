import { Router } from "express";
import { createContact, listContacts, type Contact } from "../services/contactsService";
import { getLastStatusForCard } from "../services/logsService";
import { matchContact } from "../services/matcherService";
import { isPericiaCompleta, parseCardDescriptionComOrigem, sortPericiasByDate } from "../services/parserService";
import { getSetting } from "../services/settingsService";
import { getCardsFromList, TrelloError } from "../services/trelloService";
import { normalizePhone } from "../utils/phone";

export const cardsRouter = Router();

/**
 * Quando o card não tem contato cadastrado por nome mas traz o campo TELEFONE
 * na descrição, cadastra o contato automaticamente (por nome + telefone do card)
 * em vez de exigir cadastro manual no Dashboard.
 */
function autoCadastrarPorTelefone(nomeCliente: string, telefoneCard: string, todosContatos: Contact[]): Contact | null {
  const telefoneNormalizado = normalizePhone(telefoneCard);
  if (telefoneNormalizado.length < 10) return null;

  const existente = todosContatos.find((c) => normalizePhone(c.telefone) === telefoneNormalizado);
  if (existente) return existente;

  return createContact(nomeCliente, telefoneNormalizado);
}

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
    const novosContatos: Contact[] = [];

    const cards = trelloCards.map((card) => {
      let pericias = parseCardDescriptionComOrigem(card.desc);
      pericias = sortPericiasByDate(pericias);
      const incompleta = pericias.length === 0 || pericias.some((p) => !isPericiaCompleta(p));
      const nomeCliente = pericias[0]?.nome || card.name;
      let match = matchContact(nomeCliente, [...contacts, ...novosContatos]);

      if (!match.exact) {
        const telefoneCard = pericias.map((p) => p.telefone).find((t) => t.trim());
        if (telefoneCard) {
          const contato = autoCadastrarPorTelefone(nomeCliente, telefoneCard, [...contacts, ...novosContatos]);
          if (contato) {
            novosContatos.push(contato);
            match = { exact: contato, sugestao: null, score: 1 };
          }
        }
      }

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
