import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * A chave que o Deskcomm usa para falar com o servidor de ferramentas de UM escritório. Sai do segredo que o Deskcomm e o painel já dividem
 * (CONTRATOS_SEGREDO) e do slug do escritório: o Deskcomm a calcula sozinho, o painel a confere, e nenhuma chave precisa ser copiada à mão.
 */
export const chaveDoServidorMcp = (segredo: string, slug: string): string => createHmac("sha256", segredo).update(`mcp:${slug}`).digest("hex");

export function chaveConfere(segredo: string, slug: string, recebida: string | undefined): boolean {
  const a = Buffer.from(chaveDoServidorMcp(segredo, slug)), b = Buffer.from(String(recebida ?? ""));
  return a.length === b.length && timingSafeEqual(a, b);
}
