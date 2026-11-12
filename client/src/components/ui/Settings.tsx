import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Peças padrão das telas de configuração, para todas ficarem iguais:
 * SettingsPanel (cartão com cabeçalho e situação) > SettingsBlock (um assunto dentro do cartão)
 * > SettingRow (um campo: nome e explicação à esquerda, controle à direita) e SettingsFooter (botões).
 */
export function SettingsPanel({ icon, title, description, status, actions, children, className }: {
  icon?: ReactNode; title: ReactNode; description?: ReactNode; status?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={cn("surface-panel overflow-hidden", className)}>
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-zinc-200 px-5 py-4 dark:border-zinc-800">
        <div className="flex min-w-0 items-start gap-3">
          {icon && <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300 [&>svg]:h-[18px] [&>svg]:w-[18px]">{icon}</span>}
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
            {description && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>}
          </div>
        </div>
        {(status || actions) && <div className="flex shrink-0 flex-wrap items-center gap-2">{status}{actions}</div>}
      </header>
      <div className="divide-y divide-zinc-100 dark:divide-zinc-800">{children}</div>
    </section>
  );
}

export function SettingsBlock({ title, description, step, children, className }: {
  title?: ReactNode; description?: ReactNode; step?: number; children: ReactNode; className?: string;
}) {
  return (
    <div className={cn("space-y-4 px-5 py-5", className)}>
      {(title || description) && (
        <div className="flex items-start gap-3">
          {step !== undefined && <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-500 text-xs font-semibold text-white">{step}</span>}
          <div className="min-w-0">
            {title && <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h3>}
            {description && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{description}</p>}
          </div>
        </div>
      )}
      {children}
    </div>
  );
}

export function SettingRow({ label, hint, htmlFor, children, className }: {
  label: ReactNode; hint?: ReactNode; htmlFor?: string; children: ReactNode; className?: string;
}) {
  return (
    <div className={cn("grid gap-2 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-6", className)}>
      <div className="min-w-0">
        <label htmlFor={htmlFor} className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{label}</label>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{hint}</p>}
      </div>
      <div className="min-w-0 space-y-2">{children}</div>
    </div>
  );
}

export function SettingsFooter({ children, left }: { children: ReactNode; left?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 bg-zinc-50/70 px-5 py-3 dark:bg-zinc-800/30">
      <div className="min-w-0 text-xs text-zinc-500 dark:text-zinc-400">{left}</div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

const tons = {
  info: { box: "border-blue-200 bg-blue-50 text-blue-800 dark:border-blue-900 dark:bg-blue-950/30 dark:text-blue-200", Icon: Info },
  aviso: { box: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200", Icon: AlertTriangle },
  ok: { box: "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-200", Icon: CheckCircle2 },
  erro: { box: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200", Icon: AlertTriangle },
} as const;

/** Aviso dentro de uma configuração (explicação, atenção, resultado de teste). */
export function Callout({ tone = "info", children, className }: { tone?: keyof typeof tons; children: ReactNode; className?: string }) {
  const { box, Icon } = tons[tone];
  return (
    <div role={tone === "erro" ? "alert" : "status"} className={cn("flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed", box, className)}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}
