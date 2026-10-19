import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function WorkspacePanel({
  title,
  description,
  aside,
  toolbar,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  aside?: ReactNode;
  toolbar?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("surface-panel overflow-hidden", className)}>
      {(title || aside) && (
        <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-5 sm:px-6">
          <div>
            <h2 className="text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
              {title}
            </h2>
            {description && (
              <div className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
                {description}
              </div>
            )}
          </div>
          {aside}
        </div>
      )}
      {toolbar && (
        <div className="border-b border-zinc-200 px-5 pb-5 dark:border-zinc-800 sm:px-6">
          {toolbar}
        </div>
      )}
      {children}
      {footer && (
        <div className="border-t border-zinc-200 bg-zinc-50/40 px-5 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/20 dark:text-zinc-400 sm:px-6">
          {footer}
        </div>
      )}
    </section>
  );
}

export function WorkspaceRow({
  selection,
  primary,
  secondary,
  actions,
  actionsClassName,
  children,
  selected,
}: {
  selection?: ReactNode;
  primary: ReactNode;
  secondary?: ReactNode;
  actions?: ReactNode;
  actionsClassName?: string;
  children?: ReactNode;
  selected?: boolean;
}) {
  return (
    <article
      className={cn(
        "border-b border-zinc-200 [overflow-wrap:anywhere] last:border-b-0 dark:border-zinc-800",
        selected && "bg-accent-50/40 dark:bg-accent-900/10",
      )}
    >
      <div className="flex items-start gap-3 px-5 py-5 sm:px-6">
        {selection && <div className="shrink-0 pt-0.5">{selection}</div>}
        <div className="grid min-w-0 flex-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)_auto] xl:items-center">
          <div className="min-w-0">{primary}</div>
          <div className="min-w-0 text-sm text-zinc-600 dark:text-zinc-300">
            {secondary}
          </div>
          <div
            className={cn(
              "flex max-w-sm flex-wrap items-center gap-2",
              actionsClassName,
            )}
          >
            {actions}
          </div>
        </div>
      </div>
      {children && (
        <div className="border-t border-zinc-100 bg-zinc-50/70 px-5 py-5 dark:border-zinc-800 dark:bg-zinc-800/20 sm:px-6">
          {children}
        </div>
      )}
    </article>
  );
}
