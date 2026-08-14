import { useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  ChevronDown,
  LayoutDashboard,
  Users,
  MessageSquareText,
  MessageCircleQuestion,
  Gavel,
  History,
  MessageSquareReply,
  Settings,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";

const itemsAntesTemplates = [{ to: "/", label: "Dashboard", icon: LayoutDashboard, end: true }, { to: "/agenda", label: "Agenda", icon: Users }];

const itemsDepoisTemplates = [
  { to: "/historico", label: "Histórico", icon: History },
  { to: "/pendentes", label: "Pendentes de Resposta", icon: MessageSquareReply },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

const subitensTemplates = [
  { to: "/templates", label: "Mensagens de Perícia", icon: MessageSquareText, end: true },
  { to: "/templates/audiencia", label: "Mensagens de Audiência", icon: Gavel },
  { to: "/templates/cobranca", label: "Mensagem de Cobrança", icon: MessageCircleQuestion },
];

interface SidebarProps {
  open: boolean;
  onNavigate: () => void;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
    isActive
      ? "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300"
      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
  );

export function Sidebar({ open, onNavigate }: SidebarProps) {
  const location = useLocation();
  const templatesAtivo = location.pathname.startsWith("/templates");
  const [templatesAberto, setTemplatesAberto] = useState(templatesAtivo);

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-screen w-60 shrink-0 flex-col border-r border-zinc-200 bg-white transition-transform duration-200 dark:border-zinc-800 dark:bg-zinc-900",
        "lg:sticky lg:top-0 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex items-center gap-2 px-5 py-5">
        <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent-500 text-white shadow-soft">
          <Send className="h-5 w-5" />
        </div>
        <div>
          <p className="text-lg font-bold leading-tight text-zinc-900 dark:text-zinc-100">DisparaZap</p>
        </div>
      </div>

      <nav className="flex-1 space-y-1 px-3 py-2">
        {itemsAntesTemplates.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate} className={linkClass}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}

        <div>
          <button
            type="button"
            onClick={() => setTemplatesAberto((v) => !v)}
            aria-expanded={templatesAberto}
            className={cn(
              "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              templatesAtivo
                ? "text-accent-700 dark:text-accent-300"
                : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
            )}
          >
            <MessageSquareText className="h-5 w-5" />
            <span className="flex-1 text-left">Templates</span>
            <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", templatesAberto && "rotate-180")} />
          </button>
          {templatesAberto && (
            <div className="ml-4 space-y-1 border-l border-zinc-200 pl-3 dark:border-zinc-800">
              {subitensTemplates.map(({ to, label, icon: Icon, end }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={end}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors",
                      isActive
                        ? "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300"
                        : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                    )
                  }
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </NavLink>
              ))}
            </div>
          )}
        </div>

        {itemsDepoisTemplates.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={onNavigate} className={linkClass}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-zinc-200 px-5 py-4 text-xs text-zinc-400 dark:border-zinc-800">
        Uso 100% local · v2.27.0
      </div>
    </aside>
  );
}
