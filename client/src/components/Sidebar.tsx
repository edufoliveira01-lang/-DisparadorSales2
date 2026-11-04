import { useEffect, useRef, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  Zap,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  CalendarDays,
  Scale,
  FolderOpen,
} from "lucide-react";
import { useActiveService } from "@/context/ActiveServiceContext";
import { cn } from "@/lib/utils";
import { permittedNavigation } from "@/lib/navigation";
import { useAuth } from "@/context/AuthContext";
import { APP_VERSION } from "@/lib/appVersion";

interface SidebarProps {
  open: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}
export function Sidebar({
  open,
  collapsed,
  onToggle,
  onNavigate,
}: SidebarProps) {
  const active = useActiveService();
  const { user, can } = useAuth();
  const visibleNavigation = permittedNavigation(user.permissions);
  const navigate = useNavigate();
  const asideRef = useRef<HTMLElement>(null);
  const [desktop, setDesktop] = useState(
    () => window.matchMedia("(min-width: 1024px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const update = () => setDesktop(media.matches);
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (asideRef.current) asideRef.current.inert = !desktop && !open;
    if (desktop || !open) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const root = asideRef.current;
    root
      ?.querySelector<HTMLButtonElement>('button[aria-label="Fechar menu"]')
      ?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = Array.from(
        root?.querySelectorAll<HTMLElement>("a[href], button") ?? [],
      ).filter((el) => el.getClientRects().length > 0);
      const first = elements[0],
        last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      previous?.focus();
    };
  }, [desktop, open]);
  return (
    <aside
      ref={asideRef}
      aria-hidden={!desktop && !open}
      id="main-navigation"
      className={cn(
        "app-sidebar",
        open && "is-open",
        collapsed && "is-collapsed",
      )}
    >
      <div className="sidebar-brand">
        <span className="brand-mark">
          <Zap className="h-6 w-6" fill="currentColor" strokeWidth={1.5} />
        </span>
        <div className="sidebar-copy min-w-0 flex-1">
          <p className="text-base font-semibold tracking-tight text-white">
            DisparaZap <span className="text-violet-300">2</span>
          </p>
          <p className="mt-0.5 text-[11px] text-slate-400">
            Sales &amp; Associados
          </p>
        </div>
        <button
          type="button"
          onClick={onNavigate}
          className="rounded-xl p-2 text-slate-300 lg:hidden"
          aria-label="Fechar menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <div className="sidebar-services" aria-label="Escolher área de trabalho">
        {(
          [
            {
              id: "pericias",
              label: "Perícias e avisos",
              icon: CalendarDays,
              to: "/",
            },
            {
              id: "processos",
              label: "Processos e DJEN",
              icon: Scale,
              to: "/processos",
            },
            {
              id: "gestao",
              label: "Gestão do escritório",
              icon: FolderOpen,
              to: "/gestao",
            },
          ] as const
        ).filter(({ id }) => id === "gestao" ? can("gestao.view") : id === "processos" ? can("processes.view") || can("deadlines.view") : visibleNavigation.some((item) => item.group === "pericias"))
          .map(({ id, label, icon: Icon, to }) => (
          <button
            key={id}
            type="button"
            onClick={() => {
              navigate(id === "processos" && !can("processes.view") ? "/processos/calendarios"
                : id === "pericias" && !can("dashboard.view") ? visibleNavigation.find((item) => item.group === "pericias")?.to || "/minha-conta" : to);
              onNavigate();
            }}
            aria-pressed={active === id}
            title={label}
            className={cn("service-option", active === id && "is-active")}
          >
            <Icon className="h-[18px] w-[18px] shrink-0" />
            <span className="sidebar-copy flex-1 text-left">{label}</span>
            <ChevronRight className="sidebar-copy h-3.5 w-3.5" />
          </button>
        ))}
      </div>
      <nav
        aria-label="Menu principal"
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {(
          [
            { group: active, label: "Área de trabalho" },
            { group: "compartilhado", label: "Clientes" },
            { group: "sistema", label: "Preferências" },
          ] as const
        ).map(({ group, label }) => (
          <div key={group} className="mb-5">
            <p className="sidebar-section-label">{label}</p>
            <div className="space-y-1">
              {visibleNavigation
                .filter((item) => item.group === group)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={"end" in item ? item.end : undefined}
                      onClick={onNavigate}
                      title={item.label}
                      className={({ isActive }) =>
                        cn("sidebar-link", isActive && "is-active")
                      }
                    >
                      <Icon
                        className="h-[19px] w-[19px] shrink-0"
                        strokeWidth={1.7}
                      />
                      <span className="sidebar-copy">{item.label}</span><span className="sidebar-short">{({"/":"Início","/calendario":"Agenda","/templates":"Mensagens","/pendentes":"Retornos","/historico":"Envios","/processos":"Publicações","/processos/quadro":"Quadro","/processos/aguardando":"Espera","/processos/advogados":"Advogados","/processos/monitoramento":"DJEN","/processos/calendarios":"Prazos","/gestao":"Painel","/gestao/tarefas":"Tarefas","/gestao/clientes":"Clientes","/gestao/modelos":"Modelos","/gestao/financeiro":"Caixa","/gestao/indicadores":"Metas","/agenda":"Contatos","/logs":"Atividade","/configuracoes":"Ajustes","/equipe":"Equipe","/minha-conta":"Conta"} as Record<string,string>)[item.to]}</span>
                    </NavLink>
                  );
                })}
            </div>
          </div>
        ))}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-copy flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/10 text-xs font-semibold text-violet-200">
            {(user.display_name || user.username).slice(0, 2).toUpperCase()}
          </span>
          <div>
            <p className="text-xs font-medium text-slate-200">
              {user.display_name || user.username}
            </p>
            <p className="mt-1 text-[10px] text-slate-400">
              DisparaZap · v{APP_VERSION}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="sidebar-collapse"
          aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
          aria-expanded={!collapsed}
          title={collapsed ? "Expandir menu" : "Recolher menu"}
        >
          {collapsed ? (
            <PanelLeftOpen className="h-[18px] w-[18px]" />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" />
          )}
        </button>
      </div>
    </aside>
  );
}
