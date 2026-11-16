import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/context/AuthContext";
import { ABAS_DAS_AREAS, navigationPermission } from "@/lib/navigation";

/** As páginas irmãs de uma área (Agenda, DJEN, Mensagens, Financeiro) como abas no topo: o menu fica curto e nada fica «longe». */
export function AbasDaArea() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const area = ABAS_DAS_AREAS.find((a) => a.abas.some((x) => x.to === pathname));
  if (!area) return null;
  const abas = area.abas.filter((x) => { const exigida = navigationPermission(x.to); return !exigida || user.permissions.includes(exigida); });
  if (abas.length < 2) return null;
  return (
    <nav aria-label="Páginas desta área" className="mb-5 flex gap-1 overflow-x-auto border-b border-zinc-200 pb-2 dark:border-zinc-800">
      {abas.map((a) => (
        <Link key={a.to} to={a.to} aria-current={a.to === pathname ? "page" : undefined}
          className={`whitespace-nowrap rounded-xl px-4 py-2 text-sm font-medium transition ${a.to === pathname ? "bg-accent-50 text-accent-700 dark:bg-accent-500/15 dark:text-accent-200" : "text-zinc-600 hover:border-zinc-300 hover:bg-white dark:text-zinc-300"} border border-transparent`}>{a.rotulo}</Link>))}
    </nav>
  );
}
