import type { ReactNode } from "react";
import { Checkbox } from "@/components/ui/Checkbox";

interface SelectableCardProps {
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
}

/** Card usado nas listas mobile (alternativa às tabelas, que não cabem numa tela estreita). */
export function SelectableCard({ checked, onToggle, children }: SelectableCardProps) {
  return (
    <div className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-start gap-3">
        <div className="shrink-0 pt-0.5">
          <Checkbox checked={checked} onChange={onToggle} />
        </div>
        <div className="min-w-0 flex-1 space-y-2">{children}</div>
      </div>
    </div>
  );
}

/** Linha "rótulo: valor" dentro de um SelectableCard. */
export function CardField({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className="shrink-0 text-zinc-500 dark:text-zinc-400">{label}</span>
      <span className="min-w-0 text-right text-zinc-900 dark:text-zinc-100">{value}</span>
    </div>
  );
}
