import type { InputHTMLAttributes } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export function Checkbox({ className, checked, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={cn("relative inline-flex h-5 w-5 cursor-pointer items-center justify-center", className)}>
      <input type="checkbox" checked={checked} className="peer sr-only" {...props} />
      <span className="absolute inset-0 rounded-md border border-zinc-300 bg-white transition-colors peer-checked:border-accent-500 peer-checked:bg-accent-500 dark:border-zinc-600 dark:bg-zinc-900" />
      {checked && <Check className="relative h-3.5 w-3.5 text-white" strokeWidth={3} />}
    </label>
  );
}
