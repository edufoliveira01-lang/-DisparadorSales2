import { Router } from "express";
import { createContact, listContacts, updateContact, type Contact } from "../services/contactsService";
import { getLastStatusForCard } from "../services/logsService";
import { matchContact, normalizeName, type MatchCriterio } from "../services/matcherService";
import {
  extractNomeFromCardTitle,
  isPericiaCompleta,
  parseCardDescriptionComOrigem,
  sortPericiasByDate,
} from "../services/parserService";
import { getSetting } from "../services/settingsService";
import { getCardsFromList, TrelloError } from "../services/trelloService";
import { normalizePhone } from "../utils/phone";
import { normalizeProcesso } from "../utils/processo";

export const cardsRouter = Router();

/**
 * Quando o card não tem contato cadastrado por nome mas traz o campo TELEFONE
 * na descrição, cadastra o contato automaticamente (por nome + telefone do card)
 * em vez de exigir cadastro manual no Dashboard.
 */
function autoCadastrarPorTelefone(
  nomeCliente: string,
  telefoneCard: string,
  processo: string,
  todosContatos: Contact[]
): Contact | null {
  const telefoneNormalizado = normalizePhone(telefoneCard);
  if (telefoneNormalizado.length < 10) return null;

  const existente = todosContatos.find((c) => normalizePhone(c.telefone) === telefoneNormalizado);
  if (existente && normalizeName(existente.nome) === normalizeName(nomeCliente)) {
    const processoCard = normalizeProcesso(processo);
    const processoContato = normalizeProcesso(existente.processo);
    if (!processoCard || !processoContato || processoCard === processoContato) {
      if (processoCard && !processoContato) {
        return updateContact(existente.id, existente.nome, existente.telefone, existente.observacoes || undefined, processo) ?? existente;
      }
      return existente;
    }
  }

  return createContact(nomeCliente, telefoneNormalizado, undefined, processo);
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
      // Prioridade de nome:
      // 1. Campo NOME extraído da descrição (já vem dentro do objeto pericia)
      // 2. Fallback inteligente do título do card (limpando datas e códigos)
      // 3. Título bruto do card (último caso, dentro do próprio extractNomeFromCardTitle)
      const nomeCliente = pericias[0]?.nome || extractNomeFromCardTitle(card.name);
      const processoCliente = pericias.map((p) => p.processo || "").find((p) => p.trim()) || "";
      let match = matchContact(nomeCliente, [...contacts, ...novosContatos], processoCliente);
      let criterioContato: MatchCriterio | null = match.criterio;

      if (!match.exact) {
        const telefoneCard = pericias.map((p) => p.telefone).find((t) => t.trim());
        if (telefoneCard) {
          const contato = autoCadastrarPorTelefone(
            nomeCliente,
            telefoneCard,
            processoCliente,
            [...contacts, ...novosContatos]
          );
          if (contato) {
            if (!contacts.some((c) => c.id === contato.id) && !novosContatos.some((c) => c.id === contato.id)) {
              novosContatos.push(contato);
            }
            match = { exact: contato, sugestao: null, score: 1, criterio: "telefone_card" };
            criterioContato = "telefone_card";
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
        criterioContato,
        ultimoEnvio: lastLog ? { status: lastLog.status, data: lastLog.created_at, erro: lastLog.erro } : null,
      };
    });

    res.json(cards);
  } catch (err) {
    if (err instanceof TrelloError) return res.status(502).json({ error: err.message });
    res.status(500).json({ error: "Erro inesperado ao montar o dashboard." });
  }
});
