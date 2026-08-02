import { type ReactNode, useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent } from "@/components/ui/Card";

interface CollapsibleCardProps {
  icon?: ReactNode;
  title: ReactNode;
  /** Conteúdo extra no cabeçalho, ao lado do chevron (ex: um Badge de status). */
  headerExtra?: ReactNode;
  /** Chave para lembrar o estado aberto/fechado no desktop entre visitas (via localStorage). */
  storageKey?: string;
  children: ReactNode;
}

function isDesktop(): boolean {
  return typeof window !== "undefined" && window.innerWidth >= 768;
}

function estadoSalvo(storageKey?: string): boolean | null {
  if (!storageKey || typeof window === "undefined") return null;
  const valor = window.localStorage.getItem(`collapsible:${storageKey}`);
  if (valor === null) return null;
  return valor === "1";
}

/**
 * Card que expande/recolhe ao clicar no título. Começa aberto em telas >= 768px (desktop, onde
 * o espaço vertical sobra) e fechado em telas menores (mobile, onde cada seção some da vista até
 * o usuário precisar dela). No desktop, se `storageKey` for informado, o estado aberto/fechado
 * escolhido pelo usuário é lembrado entre visitas; no mobile a seção sempre começa fechada.
 */
export function CollapsibleCard({ icon, title, headerExtra, storageKey, children }: CollapsibleCardProps) {
  const [open, setOpen] = useState(() => {
    if (!isDesktop()) return false;
    return estadoSalvo(storageKey) ?? true;
  });

  function alternar() {
    setOpen((o) => {
      const next = !o;
      if (storageKey && isDesktop()) {
        window.localStorage.setItem(`collapsible:${storageKey}`, next ? "1" : "0");
      }
      return next;
    });
  }

  return (
    <Card>
      <button
        type="button"
        onClick={alternar}
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
