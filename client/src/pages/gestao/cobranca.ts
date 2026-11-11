import { dataBr } from "./comum";

const moeda = (c: number) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

/** O texto de cobrança amigável, pronto para colar na conversa (o atendente confere antes de enviar). */
export interface LinkDePagamento { url: string; pix?: string; linha?: string }
export function mensagemDeCobranca(nome: string, parcelas: { descricao: string; valor_centavos: number; vencimento: string }[], link?: LinkDePagamento): string {
  const base = textoBase(nome, parcelas);
  if (!link?.url) return base;
  return `${base}\n\nPara pagar por boleto ou PIX, use este link: ${link.url}${link.pix ? `\n\nPIX copia e cola:\n${link.pix}` : ""}${link.linha ? `\n\nLinha digitável do boleto:\n${link.linha}` : ""}`;
}
function textoBase(nome: string, parcelas: { descricao: string; valor_centavos: number; vencimento: string }[]): string {
  const primeiro = nome.trim().split(/\s+/)[0] || "";
  const saudacao = primeiro ? `Olá, ${primeiro}! Tudo bem?` : "Olá! Tudo bem?";
  if (parcelas.length === 1) {
    const p = parcelas[0]!;
    return `${saudacao} Aqui é do escritório. Passando para lembrar que a parcela "${p.descricao}", no valor de ${moeda(p.valor_centavos)}, com vencimento em ${dataBr(p.vencimento)}, ainda consta em aberto. Podemos ajudar a regularizar? Se já pagou, é só nos avisar e desconsidere esta mensagem. 🙏`;
  }
  const total = parcelas.reduce((s, p) => s + p.valor_centavos, 0);
  return `${saudacao} Aqui é do escritório. Identificamos ${parcelas.length} parcelas em aberto, somando ${moeda(total)} (a mais antiga venceu em ${dataBr(parcelas.map((p) => p.vencimento).sort()[0]!)}). Podemos ajudar a regularizar? Se já pagou, é só nos avisar e desconsidere esta mensagem. 🙏`;
}

/** Copia o texto e abre a conversa do cliente no atendimento (Deskcomm); devolve false se não conseguiu copiar. */
export async function cobrarPeloAtendimento(telefone: string, texto: string): Promise<boolean> {
  let copiou = false;
  try { await navigator.clipboard.writeText(texto); copiou = true; } catch { /* sem permissão: abre a conversa mesmo assim */ }
  const d = telefone.replace(/\D/g, "");
  if (d.length >= 10) window.open(`/api/atendimento/entrar?telefone=${d.startsWith("55") ? d : `55${d}`}`, "_blank", "noopener");
  return copiou;
}
