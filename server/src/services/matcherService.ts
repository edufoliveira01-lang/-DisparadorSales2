import stringSimilarity from "string-similarity";
import type { Contact } from "./contactsService";
import { normalizeProcesso } from "../utils/processo";

export type MatchCriterio =
  | "nome_processo"
  | "somente_nome"
  | "nome_aproximado"
  | "processo_divergente"
  | "telefone_card";

export interface MatchResult {
  exact: Contact | null;
  sugestao: Contact | null;
  score: number | null;
  criterio: MatchCriterio | null;
}

const SUGGESTION_THRESHOLD = 0.6;

export function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Vínculo seguro usado em envios automáticos: só retorna um contato quando nome completo e
 * processo coincidem. Sugestões por semelhança continuam exclusivas da interface, onde o
 * usuário pode conferi-las antes de aceitar.
 */
export function matchContactByNameAndProcess(
  nome: string,
  processo: string | null | undefined,
  contacts: Contact[]
): Contact | null {
  const nomeChave = normalizeName(nome);
  const processoChave = normalizeProcesso(processo);
  if (!nomeChave || !processoChave) return null;
  return contacts.find(
    (contact) =>
      normalizeName(contact.nome) === nomeChave &&
      normalizeProcesso(contact.processo) === processoChave
  ) || null;
}

export function matchContact(nome: string, contacts: Contact[], processo?: string): MatchResult {
  const normalizedTarget = normalizeName(nome);
  const processoTarget = normalizeProcesso(processo);
  if (!normalizedTarget) return { exact: null, sugestao: null, score: null, criterio: null };

  const mesmoNome = contacts.filter((c) => normalizeName(c.nome) === normalizedTarget);
  if (processoTarget) {
    const nomeEProcesso = mesmoNome.find((c) => normalizeProcesso(c.processo) === processoTarget) || null;
    if (nomeEProcesso) {
      return { exact: nomeEProcesso, sugestao: null, score: 1, criterio: "nome_processo" };
    }

    const semProcesso = mesmoNome.find((c) => !normalizeProcesso(c.processo)) || null;
    if (semProcesso) {
      return { exact: null, sugestao: semProcesso, score: 1, criterio: "somente_nome" };
    }

    const processoDivergente = mesmoNome[0] || null;
    if (processoDivergente) {
      return { exact: null, sugestao: processoDivergente, score: 1, criterio: "processo_divergente" };
    }
  } else {
    const exact = mesmoNome[0] || null;
    if (exact) return { exact, sugestao: null, score: 1, criterio: "somente_nome" };
  }

  if (contacts.length === 0) return { exact: null, sugestao: null, score: null, criterio: null };

  if (processoTarget) {
    const mesmoProcesso = contacts.find((c) => normalizeProcesso(c.processo) === processoTarget) || null;
    if (mesmoProcesso) {
      const score = stringSimilarity.compareTwoStrings(normalizedTarget, normalizeName(mesmoProcesso.nome));
      return { exact: null, sugestao: mesmoProcesso, score, criterio: "nome_aproximado" };
    }
  }

  const candidates = contacts.map((c) => normalizeName(c.nome));
  const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(normalizedTarget, candidates);

  if (bestMatch.rating >= SUGGESTION_THRESHOLD) {
    return { exact: null, sugestao: contacts[bestMatchIndex], score: bestMatch.rating, criterio: "nome_aproximado" };
  }

  return { exact: null, sugestao: null, score: bestMatch.rating, criterio: null };
}
