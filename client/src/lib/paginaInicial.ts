import { permittedNavigation } from "@/lib/navigation";
import type { Permission } from "@/context/AuthContext";

/** Página que abre ao entrar: escolha de cada pessoa, guardada no servidor (acompanha em qualquer aparelho); vazio = Início, o padrão. */
export function paginaInicialDe(user: { home_page?: string; permissions: readonly Permission[] }): string | null {
  const to = user.home_page || "";
  return to && permittedNavigation(user.permissions).some((i) => i.to === to) ? to : null;
}
