import { type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";
import { GRUPOS_CONFIG, itemPermitido } from "@/lib/configNav";
import { Select } from "@/components/ui/Select";

/** Moldura da área de Configurações: menu lateral fixo com todos os assuntos e, ao lado, a página escolhida. */
export function ConfigShell({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const atual = `${pathname}${search}`;
  const ativo = (to: string) => (to.includes("?")
    ? atual === to || (to === "/configuracoes?secao=whatsapp" && pathname === "/configuracoes" && /[?&]whatsapp(=|&|$)/.test(search))
    : pathname === to && !(to === "/configuracoes" && search.includes("secao")));
  const grupos = GRUPOS_CONFIG.map((g) => ({ ...g, itens: g.itens.filter((i) => itemPermitido(i, user.permissions)) })).filter((g) => g.itens.length > 0);
  const inicio = pathname === "/configuracoes" && !search;
  const valorAtual = inicio ? "/configuracoes" : grupos.flatMap((g) => g.itens).find((i) => ativo(i.to))?.to ?? "/configuracoes";

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]">
      {/* Celular e tablet: seletor único */}
      <div className="lg:hidden">
        <label htmlFor="config-ir" className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">Ir para</label>
        <Select id="config-ir" value={valorAtual} onChange={(e) => navigate(e.target.value)}>
          <option value="/configuracoes">Visão geral das configurações</option>
          {grupos.map((g) => (
            <optgroup key={g.id} label={g.titulo}>
              {g.itens.map((i) => <option key={i.to} value={i.to}>{i.titulo}</option>)}
            </optgroup>
          ))}
        </Select>
      </div>

      {/* Computador: menu lateral */}
      <nav aria-label="Configurações" className="hidden lg:block">
        <div className="sticky top-20 max-h-[calc(100vh-6rem)] space-y-4 overflow-y-auto rounded-2xl border border-zinc-200 bg-white p-3 scrollbar-thin dark:border-zinc-800 dark:bg-zinc-900">
          <Link to="/configuracoes" aria-current={inicio ? "page" : undefined}
            className={cn("flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold transition", inicio ? "bg-accent-500/10 text-accent-700 dark:text-accent-300" : "text-zinc-700 hover:bg-zinc-100 dark:text-zinc-200 dark:hover:bg-zinc-800")}>
            <LayoutGrid className="h-4 w-4" /> Visão geral
          </Link>
          {grupos.map((g) => (
            <div key={g.id}>
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-400">{g.titulo}</p>
              <ul className="space-y-0.5">
                {g.itens.map((i) => (
                  <li key={i.to}>
                    <NavLink to={i.to} aria-current={ativo(i.to) ? "page" : undefined}
                      className={() => cn("flex items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm transition", ativo(i.to) ? "bg-accent-500/10 font-semibold text-accent-700 dark:text-accent-300" : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800")}>
                      <i.icon className="h-4 w-4 shrink-0" strokeWidth={1.8} /> <span className="truncate">{i.titulo}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
