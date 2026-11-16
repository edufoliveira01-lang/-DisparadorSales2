import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export interface ResumoDaFase { rotulo: string; indice: number; total: number; atrasada: boolean; dias: number | null; deduzida: boolean }

/** A fase atual de vários processos de uma vez (para listas). */
export function useFases(ids: number[]): Record<number, ResumoDaFase | null> {
  const [r, setR] = useState<Record<number, ResumoDaFase | null>>({});
  const chave = ids.join(",");
  useEffect(() => {
    if (!chave) { setR({}); return; }
    api.get<{ resumo: Record<number, ResumoDaFase | null> }>(`/gestao/processos/fases?ids=${chave}`).then((x) => setR(x.resumo)).catch(() => undefined);
  }, [chave]);
  return r;
}

/** Barrinha de 9 pontos + o nome da fase: dá para ver a posição do processo de relance. */
export function FaseResumoBarra({ f }: { f: ResumoDaFase | null | undefined }) {
  if (!f) return <span className="text-xs text-zinc-400">Fase não definida</span>;
  return (
    <span className="inline-flex items-center gap-2" title={`${f.rotulo}${f.dias !== null ? ` · há ${f.dias} dias` : ""}${f.atrasada ? " · acima do tempo esperado" : ""}${f.deduzida ? " · estimada pelas publicações" : ""}`}>
      <span aria-hidden className="flex gap-0.5">{Array.from({ length: f.total }, (_, i) => <span key={i} className={`h-1.5 w-3 rounded-full ${i < f.indice ? "bg-emerald-400" : i === f.indice ? (f.atrasada ? "bg-red-600" : "bg-accent-600") : "bg-zinc-200 dark:bg-zinc-700"}`} />)}</span>
      <span className={`text-xs font-medium ${f.atrasada ? "text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-300"}`}>{f.rotulo}{f.deduzida ? "*" : ""}</span>
    </span>
  );
}
