import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatPlaceholder(text: string | null | undefined): string {
  if (!text) return "—";
  return text
    .replace(/\\/g, "")
    .replace(/_/g, " ")
    .trim();
}
