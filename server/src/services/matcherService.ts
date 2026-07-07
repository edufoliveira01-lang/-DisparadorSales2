import stringSimilarity from "string-similarity";
import type { Contact } from "./contactsService";

export interface MatchResult {
  exact: Contact | null;
  sugestao: Contact | null;
  score: number | null;
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

export function matchContact(nome: string, contacts: Contact[]): MatchResult {
  const normalizedTarget = normalizeName(nome);
  if (!normalizedTarget) return { exact: null, sugestao: null, score: null };

  const exact = contacts.find((c) => normalizeName(c.nome) === normalizedTarget) || null;
  if (exact) return { exact, sugestao: null, score: 1 };

  if (contacts.length === 0) return { exact: null, sugestao: null, score: null };

  const candidates = contacts.map((c) => normalizeName(c.nome));
  const { bestMatch, bestMatchIndex } = stringSimilarity.findBestMatch(normalizedTarget, candidates);

  if (bestMatch.rating >= SUGGESTION_THRESHOLD) {
    return { exact: null, sugestao: contacts[bestMatchIndex], score: bestMatch.rating };
  }

  return { exact: null, sugestao: null, score: bestMatch.rating };
}
