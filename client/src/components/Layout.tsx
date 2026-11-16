import { formatPhoneDisplay } from "@/lib/phone";
import { type ReactNode, useCallback, useEffect, useState } from "react";
import { Menu, Search, MessageCircle } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { CriarMenu } from "./CriarMenu";
import { MenuDaPessoa } from "./MenuDaPessoa";
import { QuickNavigation } from "./QuickNavigation";
import { AbasDaArea } from "./AbasDaArea";
import { GlobalServiceActivity } from "./GlobalServiceActivity";
import { ProcessAlerts } from "./ProcessAlerts";
import { LicencaAviso } from "./LicencaAviso";
import { AnotacaoRapida } from "./AnotacaoRapida";
import { useActiveService } from "@/context/ActiveServiceContext";
import { useWhatsapp } from "@/context/WhatsappContext";
import { lerModoLeve, modoLeveAtivo, salvarModoLeve } from "@/lib/desempenho";
import { areaDaPagina } from "@/lib/navigation";
import { useAuth } from "@/context/AuthContext";
export function Layout({ children }: { children: ReactNode }) {
  const { user, can } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem("disparazap:navigation-v3") === "collapsed"; // padrão: menu aberto, com os nomes
    } catch {
      return false;
    }
  });
  const [searchOpen, setSearchOpen] = useState(false);
  const [anotando, setAnotando] = useState(false);
  const { pathname } = useLocation();
  const whatsapp = useWhatsapp();
  const active = useActiveService();
  const [leve, setLeve] = useState(() => modoLeveAtivo(lerModoLeve()));
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  const connected = whatsapp.status === "conectado";
  const connecting = [
    "inicializando",
    "autenticado",
    "aguardando_qr",
    "pareando",
  ].includes(whatsapp.status);
  const numeroEmUso = whatsapp.provedor === "deskcomm" && whatsapp.ativo ? formatPhoneDisplay(whatsapp.ativo.telefone) : "";
  const connectionLabel = !whatsapp.carregado ? "Verificando conexão do WhatsApp" : connected
    ? (numeroEmUso ? `WhatsApp conectado · ${numeroEmUso}` : "WhatsApp conectado")
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
      if (event.altKey && event.key.toLowerCase() === "n" && !event.ctrlKey && !event.metaKey) { event.preventDefault(); setAnotando(true); }
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
          "disparazap:navigation-v3",
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
          <div className="flex min-w-0 flex-1 items-center gap-3">
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
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="topbar-search is-wide"
              aria-label="Buscar páginas (Ctrl ou Command K)"
            >
              <Search className="h-[17px] w-[17px] shrink-0" />
              <span className="hidden flex-1 text-left sm:inline">Faça uma pesquisa…</span>
              <kbd className="hidden rounded-md border border-zinc-200 bg-white px-1.5 py-0.5 text-[10px] text-zinc-400 dark:border-white/10 dark:bg-white/5 md:inline">
                Ctrl K
              </kbd>
            </button>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <CriarMenu aoAnotar={() => setAnotando(true)} />
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
            <MenuDaPessoa leve={leve} aoAlternarLeve={() => { const novo = !leve; salvarModoLeve(novo ? "ligado" : "desligado"); setLeve(novo); }} />
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
            <AbasDaArea />
            {children}
          </div>
        </main>
        <footer className="app-footer">
          <span>DisparaZap 2</span>
          <span>
            Sales &amp; Associados ·{" "}
            {areaDaPagina(pathname)}
          </span>
        </footer>
      </div>
      <QuickNavigation open={searchOpen} onClose={closeSearch} />
      {can("gestao.manage") && <AnotacaoRapida aberto={anotando} aoFechar={() => setAnotando(false)} />}
    </div>
  );
}
