import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

interface Item { id: number; numero: string; pasta: string; cliente: string | null; fase: string; dias: number; limite_dias: number; excesso: number }

/** Processos que passaram do tempo esperado na fase em que estão: o aviso para a equipe agir antes de o cliente perguntar. */
export function ProcessosParadosNaFase() {
  const [d, setD] = useState<{ total: number; itens: Item[] } | null>(null);
  useEffect(() => { api.get<{ total: number; itens: Item[] }>("/gestao/processos/fases-atrasadas").then(setD).catch(() => setD({ total: 0, itens: [] })); }, []);
  return (
    <section className="surface-panel p-4 sm:p-5" aria-label="Processos parados na mesma fase">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><AlertTriangle className={`h-4 w-4 ${d && d.total > 0 ? "text-red-600" : "text-zinc-400"}`} />Processos parados na mesma fase</h2>
        {d && d.total > 0 && <span className="text-xs text-zinc-500">{d.total} acima do tempo esperado</span>}
      </div>
      {d === null ? <p className="text-sm text-zinc-500">Carregando…</p> : d.itens.length === 0 ? <p className="text-sm text-zinc-500">Nenhum processo acima do tempo esperado na fase. Para ver as fases, abra um processo.</p> : (
        <ul className="divide-y divide-zinc-100 dark:divide-zinc-800">
          {d.itens.map((i) => (
            <li key={i.id}><Link to={`/gestao/processos/${i.id}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm hover:underline">
              <span className="min-w-0"><span className="block truncate font-medium text-zinc-900 dark:text-zinc-100">{i.cliente || "Sem cliente"} · {i.numero}</span><span className="block text-xs text-zinc-500">{i.fase}</span></span>
              <span className="text-xs font-semibold text-red-700 dark:text-red-400">{i.dias} dias (esperado até {i.limite_dias})</span></Link></li>))}
        </ul>)}
    </section>
  );
}
