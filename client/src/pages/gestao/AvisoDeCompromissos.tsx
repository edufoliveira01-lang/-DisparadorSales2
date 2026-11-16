import { useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { api } from "@/lib/api";
import { dataBr } from "./comum";

export interface CompromissoDoCliente { origem: "judicial" | "audiencia" | "inss"; rotulo: string; data: string; horario: string; local: string; processo: string; dias: number }

/** Perícias e audiências que o cliente tem pela frente. Aviso próprio (azul, com calendário): não se confunde com a pendência de anotação (âmbar, com triângulo). */
export function useCompromissos(pessoaId: number | null) {
  const [itens, setItens] = useState<CompromissoDoCliente[]>([]);
  useEffect(() => {
    if (!pessoaId) { setItens([]); return; }
    api.get<{ itens: CompromissoDoCliente[] }>(`/gestao/pessoas/${pessoaId}/compromissos`, { fresh: true } as never).then((r) => setItens(r.itens)).catch(() => undefined);
  }, [pessoaId]);
  return itens;
}

const prazo = (d: number) => (d <= 0 ? "hoje" : d === 1 ? "amanhã" : `em ${d} dias`);

export function FaixaDeCompromissos({ itens, aoAbrir }: { itens: CompromissoDoCliente[]; aoAbrir: (aba: "agenda" | "pericia_inss") => void }) {
  if (itens.length === 0) return null;
  return (
    <section aria-label="Perícias e audiências do cliente" className="rounded-2xl border border-sky-300 bg-sky-50 p-4 dark:border-sky-500/40 dark:bg-sky-500/10">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-sky-900 dark:text-sky-200"><CalendarClock className="h-4 w-4" />{itens.length === 1 ? "Este cliente tem 1 perícia/audiência marcada" : `Este cliente tem ${itens.length} perícias/audiências marcadas`}</h2>
      <ul className="mt-3 space-y-2">
        {itens.map((c, i) => (
          <li key={`${c.origem}-${c.data}-${c.horario}-${i}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-sky-200 bg-white px-3.5 py-3 dark:border-sky-500/30 dark:bg-zinc-900">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">{c.rotulo} · {dataBr(c.data)}{c.horario ? ` às ${c.horario}` : ""} <span className="font-normal text-sky-800 dark:text-sky-300">({prazo(c.dias)})</span></p>
              <p className="mt-0.5 text-xs text-zinc-500">{[c.local, c.processo].filter(Boolean).join(" · ") || "Sem local informado"}</p>
            </div>
            <button type="button" onClick={() => aoAbrir(c.origem === "inss" ? "pericia_inss" : "agenda")} className="rounded-lg border border-sky-200 bg-white px-2.5 py-1 text-xs font-medium text-sky-800 hover:border-sky-400 dark:border-sky-500/40 dark:bg-zinc-900 dark:text-sky-200">Ver na ficha</button>
          </li>))}
      </ul>
    </section>
  );
}

/** O selo ao lado do nome, no cabeçalho. */
export function SeloDeCompromissos({ total }: { total: number }) {
  if (total === 0) return null;
  return <span className="inline-flex items-center gap-1 rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-semibold text-sky-800 dark:bg-sky-500/20 dark:text-sky-200"><CalendarClock className="h-3 w-3" />{total === 1 ? "1 perícia/audiência" : `${total} perícias/audiências`}</span>;
}
