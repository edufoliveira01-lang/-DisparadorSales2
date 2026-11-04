/** Validações do módulo de gestão: documentos, número CNJ e campos de cadastro. */

export const soDigitos = (v: unknown) => String(v ?? "").replace(/\D/g, "");

function digitoCpf(base: string, pesoInicial: number) {
  let soma = 0;
  for (let i = 0; i < base.length; i++) soma += Number(base[i]) * (pesoInicial - i);
  const resto = (soma * 10) % 11;
  return resto === 10 ? 0 : resto;
}
export function cpfValido(cpf: string): boolean {
  const d = soDigitos(cpf);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  return digitoCpf(d.slice(0, 9), 10) === Number(d[9]) && digitoCpf(d.slice(0, 10), 11) === Number(d[10]);
}
function digitoCnpj(base: string) {
  const pesos = base.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = [...base].reduce((acc, n, i) => acc + Number(n) * pesos[i], 0);
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}
export function cnpjValido(cnpj: string): boolean {
  const d = soDigitos(cnpj);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  return digitoCnpj(d.slice(0, 12)) === Number(d[12]) && digitoCnpj(d.slice(0, 13)) === Number(d[13]);
}
/** Vazio é permitido; preenchido precisa ser CPF (11 dígitos) ou CNPJ (14) válido. */
export function documentoValido(doc: string): boolean {
  const d = soDigitos(doc);
  return d === "" || (d.length === 11 ? cpfValido(d) : d.length === 14 ? cnpjValido(d) : false);
}
export function formatarDocumento(doc: string): string {
  const d = soDigitos(doc);
  if (d.length === 11) return d.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4");
  if (d.length === 14) return d.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, "$1.$2.$3/$4-$5");
  return d;
}

/** Número único CNJ: NNNNNNN-DD.AAAA.J.TR.OOOO (20 dígitos, dígito verificador módulo 97). */
export function cnjValido(numero: string): boolean {
  const d = soDigitos(numero);
  if (d.length !== 20) return false;
  const n = d.slice(0, 7), dv = d.slice(7, 9), resto = d.slice(9);
  return 98n - ((BigInt(`${n}${resto}00`) % 97n)) === BigInt(dv);
}
export function formatarCnj(numero: string): string {
  const d = soDigitos(numero);
  return d.length === 20 ? `${d.slice(0, 7)}-${d.slice(7, 9)}.${d.slice(9, 13)}.${d[13]}.${d.slice(14, 16)}.${d.slice(16)}` : String(numero ?? "").trim();
}
const UF_ESTADUAL = ["", "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SE", "SP", "TO"];
/** Tribunal pelo segmento J.TR do número CNJ (ex.: 8.26 → TJSP, 4.03 → TRF3, 5.15 → TRT15). */
export function tribunalDoCnj(numero: string): string | null {
  const d = soDigitos(numero);
  if (d.length !== 20) return null;
  const j = d[13], tr = Number(d.slice(14, 16));
  if (j === "8") return UF_ESTADUAL[tr] ? `TJ${UF_ESTADUAL[tr]}` : null;
  if (j === "4") return tr >= 1 && tr <= 6 ? `TRF${tr}` : null;
  if (j === "5") return tr >= 1 && tr <= 24 ? `TRT${tr}` : null;
  if (j === "6") return UF_ESTADUAL[tr] ? `TRE-${UF_ESTADUAL[tr]}` : null;
  return ({ "1": "STF", "2": "CNJ", "3": "STJ", "7": "Justiça Militar da União", "9": "Justiça Militar Estadual" } as Record<string, string>)[j] ?? null;
}
export const UFS = new Set(UF_ESTADUAL.filter(Boolean));
export const emailValido = (e: string) => e === "" || /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);
export const dataValida = (s: string) => s === "" || (/^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T12:00:00Z`)));

/** PIS/PASEP/NIT: 11 dígitos com dígito verificador (pesos 3,2,9,8,7,6,5,4,3,2). Vazio é permitido. */
export function pisValido(pis: string): boolean {
  const d = soDigitos(pis);
  if (d === "") return true;
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const pesos = [3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const soma = pesos.reduce((acc, p, i) => acc + p * Number(d[i]), 0);
  const resto = 11 - (soma % 11);
  return (resto >= 10 ? 0 : resto) === Number(d[10]);
}
export function formatarPis(pis: string): string {
  const d = soDigitos(pis);
  return d.length === 11 ? d.replace(/(\d{3})(\d{5})(\d{2})(\d)/, "$1.$2.$3-$4") : d;
}
export function formatarCep(cep: string): string {
  const d = soDigitos(cep);
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}
