import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
  presentation?: "drawer" | "center";
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  leftAction?: ReactNode;
  rightAction?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: string;
}

export function Modal({ presentation = "drawer", open, onClose, title, description, leftAction, rightAction, children, footer, maxWidth = "max-w-lg" }: ModalProps) {
  const titleId = useId();
  const descriptionId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    const root = containerRef.current;
    const focusable = () => Array.from(root?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? []).filter(el => el.getClientRects().length > 0);
    const initial = root?.querySelector<HTMLElement>('[data-autofocus]') ?? focusable()[0];
    initial?.focus({ preventScroll: true });
    const onKey = (event: KeyboardEvent) => {
      const dialogs = document.querySelectorAll('[role="dialog"]');
      if (!root?.contains(dialogs[dialogs.length - 1])) return;
      if (event.key === "Escape") { event.stopImmediatePropagation(); closeRef.current(); }
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0];
        const last = elements[elements.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || !root.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !root.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [open]);

  if (!open) return null;

  const temAcoesLaterais = Boolean(leftAction || rightAction);

  return createPortal(
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center py-4", temAcoesLaterais ? "px-14" : "px-4", presentation === "drawer" && !temAcoesLaterais && "drawer-overlay")}>
      <div className="absolute inset-0 bg-zinc-950/50 animate-fade-in backdrop-blur-sm" onClick={onClose} />
      <div ref={containerRef} className={cn("relative w-full", maxWidth, presentation === "drawer" && !temAcoesLaterais && "drawer-host")}>
        {leftAction && (
          <div className="absolute right-full top-1/2 z-10 mr-2 -translate-y-1/2">
            {leftAction}
          </div>
        )}
        <div role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={description ? descriptionId : undefined} className="relative flex max-h-[calc(100dvh-2rem)] w-full animate-slide-up flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-float dark:border-zinc-800 dark:bg-zinc-900 sm:p-6">
          <div className="mb-4 flex shrink-0 items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
              {description && <p id={descriptionId} className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-xl p-2 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 max-h-[70vh] overflow-y-auto scrollbar-thin">{children}</div>
          {footer && <div className="mt-5 flex shrink-0 flex-wrap justify-end gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">{footer}</div>}
        </div>
        {rightAction && (
          <div className="absolute left-full top-1/2 z-10 ml-2 -translate-y-1/2">
            {rightAction}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

