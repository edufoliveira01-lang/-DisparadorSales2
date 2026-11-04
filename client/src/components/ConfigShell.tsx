import { useEffect, useState, type ReactNode } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { GRUPOS_CONFIG, itemPermitido } from "@/lib/configNav";

/** Moldura única da área de Configurações: abas por assunto no topo e a página escolhida em largura total. */
export function ConfigShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const atual = `${pathname}${search}`;
  const ativo = (to: string) => (to.includes("?") ? atual === to || (to === "/configuracoes?secao=whatsapp" && pathname === "/configuracoes" && /[?&](whatsapp)(=|&|$)/.test(search)) : pathname === to && !(to === "/configuracoes" && search.includes("secao")));
  const grupos = GRUPOS_CONFIG.map((g) => ({ ...g, itens: g.itens.filter((i) => itemPermitido(i, user.permissions)) })).filter((g) => g.itens.length > 0);
  const doAtivo = grupos.find((g) => g.itens.some((i) => ativo(i.to)))?.id ?? null;
  const [grupoId, setGrupoId] = useState<string | null>(doAtivo);
  useEffect(() => { setGrupoId(doAtivo); }, [doAtivo, atual]);
  const grupo = grupos.find((g) => g.id === grupoId) ?? null;
  const inicio = pathname === "/configuracoes" && !search;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-zinc-200 bg-white p-2 dark:border-zinc-800 dark:bg-zinc-900">
        <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Assuntos de configuração">
          <NavLink to="/configuracoes" end role="tab" aria-selected={inicio} className={() => cn("flex shrink-0 items-center gap-2 rounded-xl px-4 py-2.5 text-[15px] font-semibold transition", inicio ? "bg-accent-500/10 text-accent-700 dark:text-accent-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")}><LayoutGrid className="h-[18px] w-[18px]" /> Visão geral</NavLink>
          {grupos.map((g) => (
            <button key={g.id} type="button" role="tab" aria-selected={grupoId === g.id} onClick={() => setGrupoId(g.id)}
              className={cn("shrink-0 rounded-xl px-4 py-2.5 text-[15px] font-semibold transition", grupoId === g.id ? "bg-accent-500/10 text-accent-700 dark:text-accent-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")}>{g.titulo}</button>
          ))}
        </div>
        {grupo && (
          <ul className="mt-2 flex flex-wrap gap-2 border-t border-zinc-100 px-1 pb-1 pt-3 dark:border-zinc-800">
            {grupo.itens.map((i) => (
              <li key={i.to}>
                <NavLink to={i.to} aria-current={ativo(i.to) ? "page" : undefined}
                  className={() => cn("flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition", ativo(i.to) ? "border-accent-400 bg-accent-500/10 text-accent-700 dark:text-accent-300" : "border-zinc-200 text-zinc-600 hover:border-zinc-300 hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800")}>
                  <i.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} /> {i.titulo}
                </NavLink>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
