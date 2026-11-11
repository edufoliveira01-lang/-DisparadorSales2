import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type Tom = "verde" | "amarelo" | "vermelho" | "azul" | "neutro";

const TONS: Record<Tom, { icone: string; valor: string; faixa: string }> = {
  verde: { icone: "bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300", valor: "text-emerald-700 dark:text-emerald-300", faixa: "bg-emerald-500" },
  amarelo: { icone: "bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300", valor: "text-amber-700 dark:text-amber-300", faixa: "bg-amber-500" },
  vermelho: { icone: "bg-red-50 text-red-600 dark:bg-red-500/15 dark:text-red-300", valor: "text-red-700 dark:text-red-300", faixa: "bg-red-500" },
  azul: { icone: "bg-accent-50 text-accent-600 dark:bg-accent-500/15 dark:text-accent-300", valor: "text-accent-700 dark:text-accent-300", faixa: "bg-accent-500" },
  neutro: { icone: "bg-zinc-100 text-zinc-500 dark:bg-white/10 dark:text-zinc-300", valor: "text-zinc-900 dark:text-white", faixa: "bg-zinc-300 dark:bg-zinc-600" },
};

/** Um número grande com ícone e cor que diz o que ele significa (verde ok, amarelo atenção, vermelho urgente, azul informação). */
export function Indicador({ icone, rotulo, valor, tom = "neutro", detalhe, para }: { icone: ReactNode; rotulo: string; valor: ReactNode; tom?: Tom; detalhe?: ReactNode; para?: string }) {
  const t = TONS[tom];
  const conteudo = (
    <div className="stat-card h-full transition-shadow hover:shadow-card">
      <span className={cn("absolute inset-x-0 top-0 h-1", t.faixa)} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-medium text-zinc-500 dark:text-zinc-400">{rotulo}</p>
        <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl [&>svg]:h-[18px] [&>svg]:w-[18px]", t.icone)}>{icone}</span>
      </div>
      <p className={cn("mt-2 text-3xl font-semibold tracking-tight", t.valor)}>{valor}</p>
      {detalhe && <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{detalhe}</p>}
    </div>
  );
  return para ? <a href={para} className="block h-full">{conteudo}</a> : conteudo;
}

/** O cartão de uma seção do painel: título, ação opcional à direita e conteúdo. */
export function Secao({ titulo, subtitulo, direita, children, className }: { titulo: string; subtitulo?: string; direita?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("surface-panel p-5", className)}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-zinc-900 dark:text-white">{titulo}</h2>
          {subtitulo && <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{subtitulo}</p>}
        </div>
        {direita}
      </div>
      {children}
    </section>
  );
}

const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
export const rotuloDoMes = (m: string) => `${MESES[Number(m.slice(5, 7)) - 1] ?? m}/${m.slice(2, 4)}`;

/** Barras por mês (últimos 6), com o mês escolhido em destaque. Uma ou duas séries. */
export function BarrasMensais({ meses, serieA, serieB, nomeA, nomeB, destaque, formato = (n) => String(n) }: {
  meses: string[]; serieA: number[]; serieB?: number[]; nomeA: string; nomeB?: string; destaque: string; formato?: (n: number) => string;
}) {
  const max = Math.max(1, ...serieA, ...(serieB ?? []));
  return (
    <div>
      <div className="flex h-40 items-end gap-2" role="img" aria-label={`${nomeA} por mês`}>
        {meses.map((m, i) => (
          <div key={m} className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
            <div className="flex h-32 w-full items-end justify-center gap-1">
              {serieB && <div title={`${nomeB}: ${formato(serieB[i] ?? 0)}`} className="w-3 rounded-t bg-zinc-300 dark:bg-zinc-600 sm:w-4" style={{ height: `${((serieB[i] ?? 0) / max) * 100}%`, minHeight: (serieB[i] ?? 0) ? 3 : 0 }} />}
              <div title={`${nomeA}: ${formato(serieA[i] ?? 0)}`} className={cn("w-3 rounded-t sm:w-4", m === destaque ? "bg-accent-600" : "bg-accent-300 dark:bg-accent-700")} style={{ height: `${((serieA[i] ?? 0) / max) * 100}%`, minHeight: (serieA[i] ?? 0) ? 3 : 0 }} />
            </div>
            <span className={cn("text-[11px]", m === destaque ? "font-semibold text-accent-700 dark:text-accent-300" : "text-zinc-400")}>{rotuloDoMes(m)}</span>
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">{formato(serieA[i] ?? 0)}</span>
          </div>
        ))}
      </div>
      <p className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-500">
        <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-accent-500" />{nomeA}</span>
        {serieB && <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-zinc-300 dark:bg-zinc-600" />{nomeB}</span>}
      </p>
    </div>
  );
}

/** Uma linha «rótulo ... barra ... número», para comparar quantidades dentro de um funil. */
export function LinhaDeFunil({ rotulo, valor, total, cor }: { rotulo: string; valor: number; total: number; cor: string }) {
  const pct = total > 0 ? Math.round((valor / total) * 100) : 0;
  return (
    <div className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3 text-sm">
      <span className="truncate text-zinc-600 dark:text-zinc-300">{rotulo}</span>
      <div className="h-2.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-white/10"><div className={cn("h-full rounded-full", cor)} style={{ width: `${Math.max(valor > 0 ? 3 : 0, pct)}%` }} /></div>
      <span className="w-16 text-right tabular-nums text-zinc-700 dark:text-zinc-200">{valor} <span className="text-xs text-zinc-400">{total > 0 ? `${pct}%` : ""}</span></span>
    </div>
  );
}

export const moeda = (centavos: number) => (centavos / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
