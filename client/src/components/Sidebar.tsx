import { NavLink } from "react-router-dom";
import { LayoutDashboard, Users, MessageSquareText, History, MessageSquareReply, Settings, Send } from "lucide-react";
import { cn } from "@/lib/utils";

const items = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/agenda", label: "Agenda", icon: Users },
  { to: "/templates", label: "Templates", icon: MessageSquareText },
  { to: "/historico", label: "Histórico", icon: History },
  { to: "/pendentes", label: "Pendentes de Resposta", icon: MessageSquareReply },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

export function Sidebar() {
  return (
    <aside className="sticky top-0 flex h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500 text-white shadow-soft">
          <Send className="h-5 w-5" />
        </div>
        <div>
          <p className="text-lg font-bold leading-tight text-zinc-900 dark:text-zinc-100">DisparaZap</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {items.map(({ to, label, icon: Icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
                isActive
                  ? "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300"
                  : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
              )
            }
          >
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-zinc-200 px-5 py-4 text-xs text-zinc-400 dark:border-zinc-800">
        Uso 100% local · v2.16.5
      </div>
    </aside>
  );
}
