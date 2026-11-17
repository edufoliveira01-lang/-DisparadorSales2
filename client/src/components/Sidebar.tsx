import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import {
  Zap,
  X,
  PanelLeftClose,
  PanelLeftOpen,
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
import { useIdentidade } from "@/context/IdentidadeContext";
import { AlternadorDeAmbiente } from "@/components/AlternadorDeAmbiente";

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
const CURTOS: Record<string, string> = {"/pericias":"Perícias","/calendario":"Agenda","/pendentes":"Retornos","/historico":"Envios","/processos":"Publicações","/processos/quadro":"Quadro","/processos/aguardando":"Espera","/gestao":"Painel","/gestao/tarefas":"Tarefas","/gestao/clientes":"Clientes","/gestao/financeiro":"Caixa","/gestao/indicadores":"Metas","/configuracoes":"Ajustes"};

export function Sidebar({
  open,
  collapsed,
  onToggle,
  onNavigate,
}: SidebarProps) {
  const { user } = useAuth();
  const identidade = useIdentidade();
  const visibleNavigation = permittedNavigation(user.permissions, user.modulos_bloqueados);
  const location = useLocation();
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
        <span className="brand-mark" style={identidade.faviconUrl ? { background: "#fff", padding: 5 } : undefined}>
          {identidade.faviconUrl ? <img src={identidade.faviconUrl} alt="" className="h-full w-full object-contain" /> : <Zap className="h-6 w-6" fill="currentColor" strokeWidth={1.5} />}
        </span>
        <div className="sidebar-copy min-w-0 flex-1">
          <p className="text-[15px] font-semibold tracking-tight text-zinc-900 dark:text-white">
            DisparaZap <span className="text-accent-600 dark:text-accent-300">2</span>
          </p>
          <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-slate-400">
            {identidade.nome || "Sales & Associados"}
          </p>
        </div>
        <button
          type="button"
          onClick={onNavigate}
          className="rounded-xl p-2 text-zinc-500 dark:text-slate-300 lg:hidden"
          aria-label="Fechar menu"
        >
          <X className="h-5 w-5" />
        </button>
      </div>
      <AlternadorDeAmbiente aoNavegar={onNavigate} />
      <nav
        aria-label="Menu principal"
        className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {GRUPOS.map(({ group, label, icon: GIcon }) => {
          const itens = visibleNavigation.filter((item) => item.group === group && !("oculto" in item && item.oculto));
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
                  <NavLink to={destino} onClick={onNavigate} title={label} className={cn("sidebar-link", ativoSimples && "is-active")} aria-current={ativoSimples ? "page" : undefined}>
                    <GIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
                    <span className="sidebar-copy flex-1 text-left">{label}</span>
                  </NavLink>
                )}
              </div>
            );
          }
          // Seções sempre abertas (sem clicar para abrir): o título é só um rótulo, e os itens ficam à vista, como nos sistemas de referência.
          return (
            <div key={group} className="mb-3">
              <p className="sidebar-group-head cursor-default">{label}</p>
              <div className="mt-0.5 space-y-0.5">
                {itens.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      end={"end" in item ? item.end : undefined}
                      onClick={onNavigate}
                      title={item.label}
                      className={({ isActive }) => cn("sidebar-link", (isActive || ("ativoEm" in item && item.ativoEm.some((a: string) => location.pathname === a || location.pathname.startsWith(`${a}/`)))) && "is-active")}
                    >
                      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
                      <span className="sidebar-copy">{item.label}</span><span className="sidebar-short">{CURTOS[item.to]}</span>
                    </NavLink>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-copy flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-white/10 dark:text-accent-200">
            {(user.display_name || user.username).slice(0, 2).toUpperCase()}
          </span>
          <div>
            <p className="text-xs font-medium text-zinc-800 dark:text-slate-200">
              {user.display_name || user.username}
            </p>
            <p className="mt-0.5 text-[10px] text-zinc-400 dark:text-slate-400">
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
