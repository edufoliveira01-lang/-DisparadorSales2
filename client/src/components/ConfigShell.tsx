import { useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { GRUPOS_CONFIG, itemPermitido } from "@/lib/configNav";

/** Moldura única da área de Configurações: menu próprio à esquerda e a página escolhida à direita. */
export function ConfigShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const [aberto, setAberto] = useState(false);
  const atual = `${pathname}${search}`;
  const ativo = (to: string) => (to.includes("?") ? atual === to || (to === "/configuracoes?secao=whatsapp" && pathname === "/configuracoes" && /[?&](whatsapp)(=|&|$)/.test(search)) : pathname === to && !(to === "/configuracoes" && search.includes("secao")));
  const grupos = GRUPOS_CONFIG.map((g) => ({ ...g, itens: g.itens.filter((i) => itemPermitido(i, user.permissions)) })).filter((g) => g.itens.length > 0);
  const atualTitulo = grupos.flatMap((g) => g.itens).find((i) => ativo(i.to))?.titulo ?? "Configurações";
  const lista = (
    <nav aria-label="Configurações" className="space-y-5">
      <NavLink to="/configuracoes" end className={() => cn("block rounded-lg px-3 py-2 text-sm font-semibold", pathname === "/configuracoes" && !search ? "bg-accent-500/10 text-accent-700 dark:text-accent-300" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800")} onClick={() => setAberto(false)}>Visão geral</NavLink>
      {grupos.map((g) => (
        <div key={g.id}>
          <p className="px-3 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{g.titulo}</p>
          <ul className="mt-1.5 space-y-0.5">
            {g.itens.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} onClick={() => setAberto(false)} aria-current={ativo(i.to) ? "page" : undefined}
                  className={() => cn("flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm transition", ativo(i.to) ? "bg-accent-500/10 font-semibold text-accent-700 dark:text-accent-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")}>
                  <i.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} /> {i.titulo}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
      <aside className="lg:sticky lg:top-24">
        <div className="lg:hidden">
          <button type="button" onClick={() => setAberto((a) => !a)} aria-expanded={aberto} className="flex w-full items-center justify-between rounded-xl border border-zinc-200 bg-white px-4 py-2.5 text-sm font-medium dark:border-zinc-700 dark:bg-zinc-900">
            <span>Configurações · {atualTitulo}</span><ChevronDown className={cn("h-4 w-4 transition", aberto && "rotate-180")} />
          </button>
          {aberto && <div className="mt-2 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-900">{lista}</div>}
        </div>
        <div className="hidden rounded-2xl border border-zinc-200 bg-white p-3 lg:block dark:border-zinc-800 dark:bg-zinc-900">{lista}</div>
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
