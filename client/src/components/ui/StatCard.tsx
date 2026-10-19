import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type StatTone = "accent" | "warning" | "info" | "danger" | "neutral";
const toneClasses: Record<StatTone, string> = {
  accent:
    "bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300",
  warning:
    "bg-amber-50 text-amber-600 dark:bg-amber-950/40 dark:text-amber-300",
  info: "bg-blue-50 text-blue-600 dark:bg-blue-950/40 dark:text-blue-300",
  danger: "bg-red-50 text-red-600 dark:bg-red-950/40 dark:text-red-300",
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
}: StatCardProps) {
  return (
    <div className="relative min-w-0 rounded-[10px] border border-zinc-200 bg-white p-[13px] sm:px-[19px] sm:py-[17px] dark:border-zinc-800 dark:bg-zinc-900 sm:min-h-[121px]">
      <p className="sm:pr-8 text-[11px] font-normal leading-[17.05px] text-[#8a9b90] dark:text-zinc-400">
        {label}
      </p>
      <span
        className={cn(
          "absolute right-[19px] top-[17px] hidden h-7 w-7 sm:flex items-center justify-center rounded-lg [&>svg]:h-3.5 [&>svg]:w-3.5",
          toneClasses[tone],
        )}
      >
        {icon}
      </span>
      <p className="mt-[6px] text-[26px] font-semibold leading-[40.3px] tabular-nums text-[#496a54] dark:text-zinc-100">
        {value}
      </p>
      {helper && (
        <p className="mt-1 text-[9px] font-normal leading-[14px] text-[#a1afa3] dark:text-zinc-400">
          {helper}
        </p>
      )}
    </div>
  );
}
