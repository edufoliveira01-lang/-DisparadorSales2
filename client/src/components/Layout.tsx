import { type ReactNode, useState } from "react";
import { useActiveService } from "@/context/ActiveServiceContext";
import { Menu } from "lucide-react";
import { useLocation } from "react-router-dom";
import { Sidebar } from "./Sidebar";
import { GlobalBatchProgress } from "./GlobalBatchProgress";
import { useWhatsapp } from "@/context/WhatsappContext";
import { Badge } from "./ui/Badge";
import { ProcessAlerts } from "./ProcessAlerts";

export function Layout({ children }: { children: ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();
  const whatsapp = useWhatsapp();
  const active=useActiveService();
  const pageName = {
    "/": "Dashboard", "/agenda": "Agenda", "/calendario": "Calendário",
    "/templates": "Templates", "/historico": "Histórico", "/pendentes": "Pendentes de Resposta",
    "/logs": "Logs", "/configuracoes": "Configurações",
    "/processos": "Publicações", "/processos/quadro": "Quadro dos processos", "/processos/advogados": "Advogados", "/processos/monitoramento": "Monitoramento DJEN",
  }[pathname.startsWith("/templates/") ? "/templates" : pathname] ?? "Sales & Associados";
  return <div className="flex min-h-screen bg-zinc-50 dark:bg-zinc-950">
    <Sidebar open={sidebarOpen} onNavigate={() => setSidebarOpen(false)} />
    {sidebarOpen && <button type="button" className="fixed inset-0 z-30 bg-zinc-950/40 backdrop-blur-[2px] lg:hidden" onClick={() => setSidebarOpen(false)} aria-label="Fechar menu" />}
    <div className="flex min-w-0 flex-1 flex-col">
      <header className="sticky top-0 z-20 flex h-20 shrink-0 items-center justify-between gap-3 border-b border-zinc-200 bg-white/95 px-4 backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95 sm:px-6 lg:px-8">
        <div className="flex min-w-0 items-center gap-3">
          <button type="button" onClick={() => setSidebarOpen(true)} className="rounded-lg border border-zinc-200 p-2 text-zinc-500 dark:border-zinc-700 dark:text-zinc-300 lg:hidden" aria-label="Abrir menu"><Menu className="h-4 w-4" /></button>
          <div className="min-w-0"><p className="truncate text-[13px] font-medium text-zinc-800 dark:text-zinc-100">{pageName}</p><p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-400">Serviço: {active === "processos" ? "Acompanhamento processual" : "Perícias e avisos"}</p></div>
        </div>
        <div className="hidden shrink-0 sm:block"><Badge tone={whatsapp.status === "conectado" ? "success" : "warning"}><span className={`h-1.5 w-1.5 rounded-full ${whatsapp.status === "conectado" ? "bg-accent-500" : "bg-amber-500"}`} />{whatsapp.status === "conectado" ? "WhatsApp conectado" : "WhatsApp desconectado"}</Badge></div>
      </header>
      <main className="min-w-0 flex-1">
        <GlobalBatchProgress />
        <ProcessAlerts />
        <div className="mx-auto w-full max-w-[1480px] px-4 py-6 sm:px-6 sm:py-8 lg:px-8">{children}</div>
      </main>
    </div>
  </div>;
}
