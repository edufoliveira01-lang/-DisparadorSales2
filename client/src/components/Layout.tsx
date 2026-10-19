import { type ReactNode, useState } from "react";
import { Menu, Send } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { GlobalBatchProgress } from "./GlobalBatchProgress";

export function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  const pageName = {
    "/": "Dashboard",
    "/agenda": "Agenda",
    "/calendario": "Calendário",
    "/templates": "Templates",
    "/historico": "Histórico",
    "/pendentes": "Pendentes de Resposta",
    "/logs": "Logs",
    "/configuracoes": "Configurações",
  }[pathname.startsWith("/templates/") ? "/templates" : pathname] ?? "DisparaZap";

  return (
    <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />

      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-zinc-950/40 lg:hidden"
          onClick={() => setSidebarOpen(false)}
          aria-label="Fechar menu"
        />
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-16 shrink-0 items-center gap-3 border-b border-zinc-200/80 bg-white/95 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 sm:px-6 lg:px-8 xl:px-10">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-xl p-2 text-zinc-500 transition-colors hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800 lg:hidden"
            aria-label="Abrir menu"
          >
            <Menu className="h-5 w-5" strokeWidth={2} />
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-accent-500 text-white shadow-soft">
              <Send className="h-4 w-4" />
            </div>
            <p className="font-bold tracking-tight text-zinc-950 dark:text-white">DisparaZap</p>
          </div>
          <div className="hidden items-center gap-2 text-sm lg:flex">
            <span className="text-zinc-500">Perícias e avisos</span>
            <span className="text-zinc-300" aria-hidden="true">/</span>
            <span className="font-medium text-zinc-700 dark:text-zinc-200">{pageName}</span>
          </div>
          <span className="ml-auto hidden rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-xs text-zinc-500 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-300 sm:block">Sales &amp; Associados</span>
        </header>

        <main className="flex-1">
          <GlobalBatchProgress />
          <div className="mx-auto w-full max-w-[1440px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8 xl:px-10 xl:py-9">{children}</div>
        </main>
      </div>
    </div>
  );
}
