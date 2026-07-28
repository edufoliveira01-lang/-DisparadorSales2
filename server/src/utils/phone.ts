/**
 * Remove tudo que não é dígito e garante o prefixo do Brasil ("55") quando o número
 * tiver apenas DDD + número (10 ou 11 dígitos), formato em que o WhatsApp e a agenda
 * de contatos esperam o telefone (ex: "5511999999999").
 */
export function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10 || digits.length === 11) return `55${digits}`;
  return digits;
}
