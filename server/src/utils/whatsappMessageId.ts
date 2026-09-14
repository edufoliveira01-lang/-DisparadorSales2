type WhatsappMessageIdLike = {
  _serialized?: unknown;
  id?: unknown;
} | null | undefined;

function validId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  if (!normalized || normalized === "undefined" || normalized === "null") return null;
  return normalized;
}

/**
 * O whatsapp-web.js pode expor o mesmo ID completo (_serialized) ou apenas o stanza ID (id),
 * dependendo da versão do WhatsApp Web carregada. Mantemos os dois para correlacionar os ACKs.
 */
export function whatsappMessageIdCandidates(value: WhatsappMessageIdLike): string[] {
  const candidates = [validId(value?._serialized), validId(value?.id)].filter(
    (item): item is string => Boolean(item)
  );
  return [...new Set(candidates)];
}

/** Parte imutável do ID, comum ao formato completo e ao formato reduzido. */
export function whatsappMessageStableKey(value: string): string {
  const normalized = value.trim();
  const separator = normalized.lastIndexOf("_");
  return separator >= 0 && separator < normalized.length - 1
    ? normalized.slice(separator + 1)
    : normalized;
}
