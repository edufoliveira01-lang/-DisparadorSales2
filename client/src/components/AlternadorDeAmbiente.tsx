import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Headset, LayoutGrid } from "lucide-react";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useAuth } from "@/context/AuthContext";

let cacheInfo: Promise<{ disponivel: boolean }> | null = null;
const disponibilidade = () => (cacheInfo ??= api.get<{ disponivel: boolean }>("/atendimento/info").catch(() => ({ disponivel: false })));

/**
 * Alternador «Sistema | Atendimento» no topo do menu: troca de ambiente na mesma aba, com o mesmo acesso (sem pedir senha de novo).
 * Só aparece para quem pode usar o atendimento e se ele estiver liberado para o escritório.
 */
export function AlternadorDeAmbiente({ aoNavegar }: { aoNavegar?: () => void }) {
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [livre, setLivre] = useState(false);
  const permitido = can("atendimento.use");
  useEffect(() => { if (permitido) void disponibilidade().then((i) => setLivre(i.disponivel)); }, [permitido]);
  if (!permitido || !livre) return null;
  const entrar = () => {
    aoNavegar?.();
    if (!user.email?.trim()) { navigate("/atendimento"); return; }
    window.location.assign("/api/atendimento/entrar");
  };
  const base = "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500";
  return (
    <div className="sidebar-copy px-3 pb-2 pt-1" role="group" aria-label="Ambiente">
      <div className="flex rounded-xl bg-zinc-100 p-1 dark:bg-zinc-800/70">
        <span aria-current="true" className={cn(base, "bg-white text-accent-700 shadow-sm dark:bg-zinc-900 dark:text-accent-300")}><LayoutGrid className="h-3.5 w-3.5" /> Sistema</span>
        <button type="button" onClick={entrar} className={cn(base, "text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-white")}><Headset className="h-3.5 w-3.5" /> Atendimento</button>
      </div>
    </div>
  );
}
