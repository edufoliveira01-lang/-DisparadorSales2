import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatTone = "accent" | "warning" | "info" | "danger" | "neutral";

const toneClasses: Record<StatTone, string> = {
  accent: "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300",
  warning: "bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  info: "bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  danger: "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  neutral: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300",
};

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: number | string;
  tone?: StatTone;
  helper?: string;
  layout?: "stacked" | "inline";
}

export function StatCard({ icon, label, value, tone = "neutral", helper, layout = "stacked" }: StatCardProps) {
  if (layout === "inline") {
    return (
      <div className="min-w-0 rounded-2xl border border-zinc-200/80 bg-white p-2.5 shadow-soft dark:border-zinc-800 dark:bg-zinc-900 sm:p-3.5">
        <div className="flex min-w-0 items-center gap-2 sm:gap-3">
          <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-xl [&>svg]:h-4 [&>svg]:w-4", toneClasses[tone])}>
            {icon}
          </div>
          <p className="shrink-0 text-lg font-bold tabular-nums tracking-tight text-zinc-950 dark:text-white sm:text-xl">{value}</p>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold text-zinc-600 dark:text-zinc-300 sm:text-xs">{label}</p>
            {helper && <p className="mt-0.5 hidden truncate text-[11px] text-zinc-400 lg:block">{helper}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0 rounded-2xl border border-zinc-200/80 bg-white p-3 shadow-soft dark:border-zinc-800 dark:bg-zinc-900 sm:p-4">
      <div className={cn("flex h-8 w-8 items-center justify-center rounded-xl [&>svg]:h-4 [&>svg]:w-4", toneClasses[tone])}>
        {icon}
      </div>
      <p className="mt-2 text-xl font-bold tabular-nums tracking-tight text-zinc-950 dark:text-white sm:text-2xl">{value}</p>
      <p className="truncate text-[11px] font-medium text-zinc-500 dark:text-zinc-400 sm:text-xs">{label}</p>
      {helper && <p className="mt-1 hidden truncate text-[11px] text-zinc-400 lg:block">{helper}</p>}
    </div>
  );
}
