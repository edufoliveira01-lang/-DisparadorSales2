import { type ReactNode, useCallback, useEffect, useState } from "react";
import {
  Menu,
  Search,
  Moon,
  Zap,
  Sun,
  ChevronRight,
  MessageCircle,
  Settings,
} from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { QuickNavigation } from "./QuickNavigation";
import { GlobalServiceActivity } from "./GlobalServiceActivity";
import { ProcessAlerts } from "./ProcessAlerts";
import { LicencaAviso } from "./LicencaAviso";
import { useActiveService } from "@/context/ActiveServiceContext";
import { useWhatsapp } from "@/context/WhatsappContext";
import { useTheme } from "@/context/ThemeContext";
import { lerModoLeve, modoLeveAtivo, salvarModoLeve } from "@/lib/desempenho";
import { getCurrentPage } from "@/lib/navigation";
import { useAuth } from "@/context/AuthContext";
export function Layout({ children }: { children: ReactNode }) {
  const { user, can } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("disparazap:navigation-v2") !== "expanded";
    } catch {
      return true;
    }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const { pathname } = useLocation();
  const whatsapp = useWhatsapp();
  const active = useActiveService();
  const { theme, setTheme } = useTheme();
  const [leve, setLeve] = useState(() => modoLeveAtivo(lerModoLeve()));
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const page = getCurrentPage(pathname);
  const connected = whatsapp.status === "conectado";
  const connecting = [
    "inicializando",
    "autenticado",
    "aguardando_qr",
    "pareando",
  ].includes(whatsapp.status);
  const connectionLabel = !whatsapp.carregado ? "Verificando conexão do WhatsApp" : connected
    ? "WhatsApp conectado"
    : connecting
      ? "WhatsApp conectando"
      : "WhatsApp desconectado";
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setSearchOpen((open) => !open);
      }
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);
  useEffect(() => {
    if (!sidebarOpen) return;
    const old = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = old;
    };
  }, [sidebarOpen]);
  function toggleSidebar() {
    setCollapsed((value) => {
      try {
        localStorage.setItem(
          "disparazap:navigation-v2",
          value ? "expanded" : "collapsed",
        );
      } catch {
        /* Storage can be disabled. */
      }
      return !value;
    });
  }
  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Pular para o conteúdo
      </a>
      <Sidebar
        open={sidebarOpen}
        collapsed={collapsed}
        onToggle={toggleSidebar}
        onNavigate={() => setSidebarOpen(false)}
      />
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-zinc-950/50 backdrop-blur-sm lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Fechar menu"
        />
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="app-topbar">
          <div className="flex min-w-0 items-center gap-3">
            <button
              type="button"
              onClick={() => setSidebarOpen(true)}
              className="topbar-icon lg:hidden"
              aria-label="Abrir menu"
              aria-expanded={sidebarOpen}
              aria-controls="main-navigation"
            >
              <Menu className="h-5 w-5" />
            </button>
            <div className="min-w-0 topbar-breadcrumb">
              <p className="hidden items-center gap-2 text-[11px] text-zinc-500 dark:text-zinc-400 md:flex">
                <span>
                  {active === "gestao" ? "Gestão do escritório" : active === "processos"
                    ? "Processos e DJEN"
                    : "Perícias e avisos"}
                </span>
                <ChevronRight className="h-3 w-3" />
                <span className="text-zinc-700 dark:text-zinc-300">
                  {page.label}
                </span>
              </p>
              <p className="truncate text-sm font-semibold text-zinc-800 dark:text-zinc-100 md:hidden">
                {page.label}
              </p>
              <p className="mt-1 hidden text-xs text-zinc-400 md:block">
                Sales &amp; Associados
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 sm:gap-3">
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="topbar-search"
              aria-label="Buscar páginas (Ctrl ou Command K)"
            >
              <Search className="h-[17px] w-[17px]" />
              <span className="hidden xl:inline">Buscar no espaço…</span>
              <kbd className="hidden rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 xl:inline">
                ⌘ / Ctrl K
              </kbd>
            </button>
            <Link
              to={can("whatsapp.manage") ? "/configuracoes?whatsapp=1" : "/minha-conta"}
              title={connectionLabel}
              aria-label={connectionLabel}
              className={`connection-status ${connected ? "is-connected" : ""}`}
            >
              <span
                className={`h-2 w-2 shrink-0 rounded-full ${connected ? "bg-emerald-500" : "bg-amber-500"}`}
              />
              <span className="hidden text-xs font-medium xl:inline">
                {connectionLabel}
              </span>
              <MessageCircle className="h-[17px] w-[17px] xl:hidden" />
            </Link>
            <button
              type="button"
              className="topbar-icon"
              aria-pressed={leve}
              onClick={() => { const novo = !leve; salvarModoLeve(novo ? "ligado" : "desligado"); setLeve(novo); }}
              aria-label={leve ? "Desativar modo leve" : "Ativar modo leve"}
              title={leve ? "Modo leve ligado: sem desfoque, sombras e animações. Clique para desligar." : "Modo leve: reduz efeitos visuais para deixar o sistema mais rápido em computadores modestos."}
            >
              <Zap className={`h-[18px] w-[18px] ${leve ? "text-accent-600" : ""}`} />
            </button>
            <button
              type="button"
              className="topbar-icon"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              aria-label={
                theme === "dark" ? "Usar tema claro" : "Usar tema escuro"
              }
              title={theme === "dark" ? "Tema claro" : "Tema escuro"}
            >
              {theme === "dark" ? (
                <Sun className="h-[18px] w-[18px]" />
              ) : (
                <Moon className="h-[18px] w-[18px]" />
              )}
            </button>
            {can("integrations.manage") && <Link
              to="/configuracoes"
              className="topbar-icon hidden sm:flex"
              aria-label="Abrir configurações"
              title="Configurações"
            >
              <Settings className="h-[18px] w-[18px]" />
            </Link>}
            <Link to="/minha-conta"
              className="hidden h-9 w-9 items-center justify-center rounded-full bg-accent-100 text-[11px] font-semibold text-accent-700 dark:bg-accent-900 dark:text-accent-200 sm:flex"
              aria-label={`Minha conta: ${user.display_name || user.username}`}
            >
              {(user.display_name || user.username).slice(0, 2).toUpperCase()}
            </Link>
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="min-w-0 flex-1 outline-none"
        >
          <div className="global-status-rail">
            <GlobalServiceActivity />
            <LicencaAviso />
            {can("processes.view") && <ProcessAlerts />}
          </div>
          <div
            key={pathname}
            className="page-content mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-7 sm:py-8 xl:px-10"
          >
            {children}
          </div>
        </main>
        <footer className="app-footer">
          <span>DisparaZap 2</span>
          <span>
            Sales &amp; Associados ·{" "}
            {active === "gestao" ? "Gestão do escritório" : active === "processos" ? "Processos e DJEN" : "Perícias e avisos"}
          </span>
        </footer>
      </div>
      <QuickNavigation open={searchOpen} onClose={closeSearch} />
    </div>
  );
}
