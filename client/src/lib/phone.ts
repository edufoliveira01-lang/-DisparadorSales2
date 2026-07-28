/**
 * Máscara aplicada enquanto o usuário digita: (XX) XXXXX-XXXX para números de 9 dígitos,
 * ou (XX) XXXX-XXXX para números antigos de 8 dígitos (detectado pela quantidade de dígitos
 * digitados até agora).
 */
export function formatPhoneInput(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  if (!digits) return "";
  if (digits.length <= 2) return `(${digits}`;

  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const splitAt = digits.length > 10 ? 5 : 4;
  const p1 = rest.slice(0, splitAt);
  const p2 = rest.slice(splitAt);
  return p2 ? `(${ddd}) ${p1}-${p2}` : `(${ddd}) ${p1}`;
}

/**
 * Formata um telefone já salvo (dígitos puros, com ou sem o "55" do Brasil na frente) para
 * exibição no padrão (XX) XXXXX-XXXX, ou (XX) XXXX-XXXX quando o número local tem 8 dígitos.
 * Se não for possível reconhecer o formato, devolve o valor original sem alterações.
 */
export function formatPhoneDisplay(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) return raw;

  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const splitAt = digits.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, splitAt)}-${rest.slice(splitAt)}`;
}
