import { permittedNavigation } from "@/lib/navigation";
import type { Permission } from "@/context/AuthContext";

/** Página que abre ao entrar: escolha de cada pessoa, guardada neste navegador (vazio = Início, o padrão). */
const chave = (userId: number) => `disparazap:pagina-inicial:${userId}`;

export function paginaEscolhida(userId: number): string {
  try { return window.localStorage.getItem(chave(userId)) || ""; } catch { return ""; }
}
export function escolherPaginaInicial(userId: number, to: string): void {
  try { if (to) window.localStorage.setItem(chave(userId), to); else window.localStorage.removeItem(chave(userId)); } catch { /* vale só nesta sessão */ }
}

/** Destino ao abrir "/": a página escolhida, se a pessoa ainda tiver acesso a ela; senão null (cai no Início padrão). */
export function paginaInicialDe(userId: number, permissions: readonly Permission[]): string | null {
  const to = paginaEscolhida(userId);
  return to && permittedNavigation(permissions).some((i) => i.to === to) ? to : null;
}
