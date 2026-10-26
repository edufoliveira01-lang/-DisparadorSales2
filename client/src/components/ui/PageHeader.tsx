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
        "page-heading",
        className,
      )}
    >
      <div className="min-w-0">
        {!compact && (
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-accent-600 dark:text-accent-300">
            {active === "processos" ? "Acompanhamento processual" : "Perícias e avisos"}
          </p>
        )}
        <Heading
          className={cn(
            "text-zinc-900 dark:text-white",
            compact
              ? "text-lg font-semibold tracking-[-0.5px]"
              : "text-[26px] font-semibold leading-[1.25] tracking-[-0.9px] md:text-[30px]",
          )}
        >
          {title}
        </Heading>
        <div className="mt-2 max-w-3xl text-[13px] leading-relaxed text-zinc-500 dark:text-zinc-400">
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

