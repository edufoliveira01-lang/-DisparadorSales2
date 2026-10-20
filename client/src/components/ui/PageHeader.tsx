import { useActiveService } from "@/context/ActiveServiceContext";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description: ReactNode;
  actions?: ReactNode;
  className?: string;
  compact?: boolean;
}

export function PageHeader({
  title,
  description,
  actions,
  className,
  compact = false,
}: PageHeaderProps) {
  const active=useActiveService();
  const Heading = compact ? "h2" : "h1";
  return (
    <header
      className={cn(
        "flex flex-col gap-4 pb-1 sm:flex-row sm:items-start sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {!compact && (
          <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-accent-600 dark:text-accent-300">
            {active === "processos" ? "Acompanhamento processual" : "Perícias e avisos"}
          </p>
        )}
        <Heading
          className={cn(
            "text-zinc-900 dark:text-white",
            compact
              ? "text-lg font-semibold tracking-[-0.5px]"
              : "text-2xl font-[650] leading-[1.25] tracking-[-1.05px] md:text-[27px]",
          )}
        >
          {title}
        </Heading>
        <div className="mt-2 max-w-3xl text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
          {description}
        </div>
      </div>
      {actions && (
        <div className="flex w-full flex-wrap items-center gap-2 self-start sm:w-auto sm:shrink-0">
          {actions}
        </div>
      )}
    </header>
  );
}
