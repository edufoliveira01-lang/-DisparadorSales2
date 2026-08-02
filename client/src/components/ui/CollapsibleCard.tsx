import { type ReactNode, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";

interface CollapsibleCardProps {
  icon?: ReactNode;
  title: ReactNode;
  /** Conteúdo extra no cabeçalho, ao lado do chevron (ex: um Badge de status). */
  headerExtra?: ReactNode;
  children: ReactNode;
}

/**
 * Card que expande/recolhe ao clicar no título. Começa aberto em telas >= 768px (desktop, onde
 * o espaço vertical sobra) e fechado em telas menores (mobile, onde cada seção some da vista até
 * o usuário precisar dela) — o estado inicial só é lido uma vez, no primeiro render.
 */
export function CollapsibleCard({ icon, title, headerExtra, children }: CollapsibleCardProps) {
  const [open, setOpen] = useState(() => typeof window === "undefined" || window.innerWidth >= 768);

  return (
    <Card>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 p-5 pb-3 text-left"
      >
        <span className="flex items-center gap-2 text-base font-semibold text-zinc-900 dark:text-zinc-100">
          {icon}
          {title}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {headerExtra}
          {open ? <ChevronUp className="h-4 w-4 text-zinc-400" /> : <ChevronDown className="h-4 w-4 text-zinc-400" />}
        </span>
      </button>
      {open && <CardContent className="space-y-4">{children}</CardContent>}
    </Card>
  );
}
