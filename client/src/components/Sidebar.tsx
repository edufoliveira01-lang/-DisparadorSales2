import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Zap,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronRight,
  CalendarDays,
  Scale,
  LayoutGrid,
  Contact,
  MessageSquareReply,
  Wallet,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { permittedNavigation } from "@/lib/navigation";
import { emAreaDeConfig } from "@/lib/configNav";
import { useAuth } from "@/context/AuthContext";
import { APP_VERSION } from "@/lib/appVersion";

interface SidebarProps {
  open: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onNavigate: () => void;
}
const GRUPOS = [
  { group: "inicio", label: "Início", icon: LayoutGrid },
  { group: "clientes", label: "Clientes", icon: Contact },
  { group: "processos", label: "Processos e prazos", icon: Scale },
  { group: "agenda", label: "Agenda e perícias", icon: CalendarDays },
  { group: "comunicacao", label: "Comunicação", icon: MessageSquareReply },
  { group: "financeiro", label: "Financeiro", icon: Wallet },
  { group: "configuracoes", label: "Configurações", icon: Settings },
] as const;
const CURTOS: Record<string, string> = {"/pericias":"Perícias","/calendario":"Agenda","/pendentes":"Retornos","/historico":"Envios","/processos":"Publicações","/processos/quadro":"Quadro","/processos/aguardando":"Espera","/gestao":"Painel","/gestao/tarefas":"Tarefas","/gestao/clientes":"Clientes","/gestao/financeiro":"Caixa","/gestao/indicadores":"Metas","/agenda":"Contatos","/configuracoes":"Ajustes"};
const CHAVE_GRUPOS = "sales.menu.grupos";

export function Sidebar({
  open,
  collapsed,
  onToggle,
  onNavigate,
}: SidebarProps) {
  const { user } = useAuth();
  const visibleNavigation = permittedNavigation(user.permissions);
  const location = useLocation();
  const [abertos, setAbertos] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(localStorage.getItem(CHAVE_GRUPOS) || "{}") as Record<string, boolean>; } catch { return {}; }
  });
  /** O grupo da página atual abre sozinho; o clique abre ou recolhe e a escolha fica guardada. */
  const alternar = (grupo: string, aberto: boolean) => setAbertos((a) => {
    const proximo = { ...a, [grupo]: !aberto };
    try { localStorage.setItem(CHAVE_GRUPOS, JSON.stringify(proximo)); } catch { /* sem armazenamento */ }
    return proximo;
  });
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
      <nav
        aria-label="Menu principal"
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {GRUPOS.map(({ group, label, icon: GIcon }) => {
          const itens = visibleNavigation.filter((item) => item.group === group);
          if (itens.length === 0) return null;
          // Início e Configurações são um link só: as ferramentas de configuração ficam dentro da área de Configurações.
          if (group === "inicio" || group === "configuracoes") {
            const destino = group === "inicio" ? itens[0].to : itens.some((i) => i.to === "/configuracoes") ? "/configuracoes" : itens[0].to;
            const ativoSimples = group === "inicio" ? location.pathname === destino : emAreaDeConfig(location.pathname);
            return (
              <div key={group} className="mb-2">
                {collapsed ? (
                  <NavLink to={destino} onClick={onNavigate} title={label} className={cn("sidebar-link", ativoSimples && "is-active")} aria-current={ativoSimples ? "page" : undefined}>
                    <GIcon className="h-[19px] w-[19px] shrink-0" strokeWidth={1.7} />
                    <span className="sidebar-short">{CURTOS[destino] ?? label}</span>
                  </NavLink>
                ) : (
                  <NavLink to={destino} onClick={onNavigate} title={label} className={cn("sidebar-group-head", ativoSimples && "is-active")} aria-current={ativoSimples ? "page" : undefined}>
                    <GIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
                    <span className="sidebar-copy flex-1 text-left">{label}</span>
                  </NavLink>
                )}
              </div>
            );
          }
          const ativo = itens.some((item) => ("end" in item && item.end ? location.pathname === item.to : location.pathname === item.to || location.pathname.startsWith(`${item.to}/`)));
          const aberto = collapsed || abertos[group] !== false && (abertos[group] === true || ativo);
          return (
            <div key={group} className="mb-2">
              <button
                type="button"
                className={cn("sidebar-group-head", ativo && "is-active")}
                aria-expanded={aberto}
                onClick={() => alternar(group, aberto)}
                title={label}
              >
                <GIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
                <span className="sidebar-copy flex-1 text-left">{label}</span>
                <ChevronRight className={cn("sidebar-copy h-3.5 w-3.5 transition-transform", aberto && "rotate-90")} />
              </button>
              {aberto && (
                <div className="mt-1 space-y-1">
                  {itens.map((item) => {
                    const Icon = item.icon;
                    return (
                      <NavLink
                        key={item.to}
                        to={item.to}
                        end={"end" in item ? item.end : undefined}
                        onClick={onNavigate}
                        title={item.label}
                        className={({ isActive }) => cn("sidebar-link", !collapsed && "sidebar-link-nested", isActive && "is-active")}
                      >
                        <Icon className="h-[19px] w-[19px] shrink-0" strokeWidth={1.7} />
                        <span className="sidebar-copy">{item.label}</span><span className="sidebar-short">{CURTOS[item.to]}</span>
                      </NavLink>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
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
