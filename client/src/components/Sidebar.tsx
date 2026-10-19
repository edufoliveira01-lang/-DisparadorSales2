import { NavLink } from "react-router-dom";
import {
  CalendarDays,
  LayoutDashboard,
  Users,
  MessageSquareText,
  History,
  MessageSquareReply,
  Settings,
  ScrollText,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Select } from "@/components/ui/Select";
import { APP_VERSION } from "@/lib/appVersion";

const itemsAntesTemplates = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, end: true },
  { to: "/agenda", label: "Agenda", icon: Users },
  { to: "/calendario", label: "Calendário", icon: CalendarDays },
];

const itemsDepoisTemplates = [
  { to: "/historico", label: "Histórico", icon: History },
  { to: "/pendentes", label: "Pendentes de Resposta", icon: MessageSquareReply },
  { to: "/logs", label: "Logs", icon: ScrollText },
  { to: "/configuracoes", label: "Configurações", icon: Settings },
];

interface SidebarProps {
  open: boolean;
  onNavigate: () => void;
}

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[13px] font-medium transition-colors",
    isActive
      ? "bg-accent-50 text-accent-700 ring-1 ring-inset ring-accent-100 dark:bg-accent-900/30 dark:text-accent-300 dark:ring-accent-800"
      : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
  );

export function Sidebar({ open, onNavigate }: SidebarProps) {

  return (
    <aside
      className={cn(
        "fixed inset-y-0 left-0 z-40 flex h-screen w-[min(18rem,calc(100vw-3rem))] shrink-0 flex-col border-r border-zinc-200/80 bg-white shadow-2xl transition-transform duration-200 dark:border-zinc-800 dark:bg-zinc-900 lg:w-[236px] lg:shadow-none",
        "lg:sticky lg:top-0 lg:translate-x-0",
        open ? "translate-x-0" : "-translate-x-full"
      )}
    >
      <div className="flex h-20 shrink-0 items-center gap-3 border-b border-zinc-200 px-5 dark:border-zinc-800">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-500 font-serif text-2xl text-white">S</div>
        <div className="min-w-0 flex-1"><p className="text-sm font-semibold leading-snug tracking-tight text-zinc-900 dark:text-white">Sales &amp; Associados</p><p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">Plataforma de serviços</p></div>
        <button type="button" onClick={onNavigate} className="rounded-lg p-1 text-zinc-400 lg:hidden" aria-label="Fechar menu"><X className="h-4 w-4" /></button>
      </div>
      <div className="border-b border-zinc-200 px-4 py-5 dark:border-zinc-800">
        <label htmlFor="active-service" className="mb-2 block text-[9px] font-semibold uppercase tracking-[0.15em] text-zinc-500 dark:text-zinc-400">Serviço ativo</label>
        <Select id="active-service" defaultValue="pericias" className="text-xs font-medium">
          <option value="pericias">Perícias e avisos</option>
          <option value="processos" disabled>Andamentos e prazos · em breve</option>
        </Select>
      </div>

      <nav aria-label="Menu principal" className="scrollbar-thin flex-1 space-y-1 overflow-y-auto px-3 py-5">
        <p className="px-3 pb-1 pt-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Perícias e avisos</p>
        {itemsAntesTemplates.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} onClick={onNavigate} className={linkClass}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}

        <p className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Comunicação de perícias</p>
        <NavLink to="/templates" onClick={onNavigate} className={linkClass}>
          <MessageSquareText className="h-5 w-5" /> Templates
        </NavLink>

        {itemsDepoisTemplates.slice(0, 2).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={onNavigate} className={linkClass}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}

        <p className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.16em] text-zinc-400">Sistema</p>
        {itemsDepoisTemplates.slice(2).map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} onClick={onNavigate} className={linkClass}>
            <Icon className="h-5 w-5" />
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="border-t border-zinc-200 px-5 py-4 text-xs text-zinc-400 dark:border-zinc-800">
        <p className="mb-1 leading-relaxed text-zinc-500 dark:text-zinc-400">Controle de perícias e avisos</p>
        <p className="text-[10px]">DisparaZap · v{APP_VERSION}</p>
      </div>
    </aside>
  );
}
