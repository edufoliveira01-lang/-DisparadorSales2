import type { InputHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, checked, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className={cn("relative inline-flex h-5 w-5 shrink-0 items-center justify-center", className)}>
      <input type="checkbox" checked={checked} className="peer absolute inset-0 z-10 m-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed" {...props} />
      <span className="pointer-events-none absolute inset-0 rounded-md border border-zinc-300 bg-white transition-colors peer-checked:border-accent-500 peer-checked:bg-accent-500 peer-focus-visible:ring-2 peer-focus-visible:ring-accent-500 peer-focus-visible:ring-offset-2 dark:border-zinc-600 dark:bg-zinc-900 dark:peer-focus-visible:ring-offset-zinc-900" />
      {checked && <Check className="pointer-events-none relative h-3.5 w-3.5 text-white" strokeWidth={3} />}
    </span>
  );
}
