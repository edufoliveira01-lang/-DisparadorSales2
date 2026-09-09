import { type ReactNode, useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ModalProps {
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

export function Modal({ open, onClose, title, description, leftAction, rightAction, children, footer, maxWidth = "max-w-lg" }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const temAcoesLaterais = Boolean(leftAction || rightAction);

  return createPortal(
    <div className={cn("fixed inset-0 z-50 flex items-center justify-center py-4", temAcoesLaterais ? "px-14" : "px-4")}>
      <div className="absolute inset-0 bg-zinc-950/40 animate-fade-in backdrop-blur-[2px]" onClick={onClose} />
      <div className={cn("relative w-full", maxWidth)}>
        {leftAction && (
          <div className="absolute right-full top-1/2 z-10 mr-2 -translate-y-1/2">
            {leftAction}
          </div>
        )}
        <div className="relative w-full animate-slide-up rounded-2xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-800 dark:bg-zinc-900">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
              {description && <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">{description}</p>}
            </div>
            <button
              onClick={onClose}
              aria-label="Fechar"
              className="rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-600 dark:hover:bg-zinc-800"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="max-h-[70vh] overflow-y-auto scrollbar-thin">{children}</div>
          {footer && <div className="mt-6 flex justify-end gap-2">{footer}</div>}
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
