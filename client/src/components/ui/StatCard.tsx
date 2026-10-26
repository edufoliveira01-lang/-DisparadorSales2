import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
type StatTone = "accent" | "warning" | "info" | "danger" | "neutral";
const toneClasses: Record<StatTone, string> = {
  accent:
    "bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300",
  warning:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  info: "bg-sky-50 text-sky-600 dark:bg-sky-950/40 dark:text-sky-300",
  danger: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
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
export function StatCard({
  icon,
  label,
  value,
  tone = "neutral",
  helper,
  layout = "stacked",
}: StatCardProps) {
  return (
    <div className="stat-card">
      <div
        className={cn(
          "flex gap-3 sm:gap-4",
          layout === "inline"
            ? "flex-col sm:flex-row sm:items-start"
            : "flex-col",
        )}
      >
        <span className={cn("stat-icon", toneClasses[tone])}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="text-[11px] font-medium text-zinc-500 dark:text-zinc-400 sm:text-xs">
            {label}
          </p>
          <p className="mt-1 text-[26px] font-semibold leading-tight tracking-tight text-zinc-900 tabular-nums dark:text-zinc-100 sm:text-[32px]">
            {value}
          </p>
        </div>
      </div>
      {helper && (
        <p className="mt-3 text-[10px] leading-relaxed text-zinc-500 dark:text-zinc-400 sm:text-[11px]">
          {helper}
        </p>
      )}
    </div>
  );
}
