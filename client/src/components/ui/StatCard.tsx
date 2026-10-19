import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatTone = "accent" | "warning" | "info" | "danger" | "neutral";
const toneClasses: Record<StatTone, string> = {
  accent: "bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300",
  warning: "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  info: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
  danger: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300",
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};
interface StatCardProps { icon: ReactNode; label: string; value: number | string; tone?: StatTone; helper?: string; layout?: "stacked" | "inline" }
export function StatCard({icon, label, value, tone = "neutral", helper}: StatCardProps) {
  return <div className="relative min-w-0 rounded-xl border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900 sm:p-5">
    <div className="flex items-start justify-between gap-2"><p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">{label}</p><span className={cn("hidden h-7 w-7 shrink-0 items-center justify-center rounded-lg [&>svg]:h-3.5 [&>svg]:w-3.5 sm:flex",toneClasses[tone])}>{icon}</span></div>
    <p className="mt-2 text-2xl font-semibold tabular-nums tracking-tight text-zinc-800 dark:text-zinc-100 sm:text-[28px]">{value}</p>
    {helper && <p className="mt-1 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400">{helper}</p>}
  </div>;
}
