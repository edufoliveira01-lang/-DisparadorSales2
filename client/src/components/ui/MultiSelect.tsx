import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "./Checkbox";
export function MultiSelect({
  inline = false,
  label,
  placeholder,
  value,
  options,
  onChange,
}: {
  inline?: boolean;
  label: string;
  placeholder: string;
  value: string[];
  options: { value: string; label: string }[];
  onChange: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false),
    root = useRef<HTMLDivElement>(null),
    button = useRef<HTMLButtonElement>(null),
    id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const outsideEvent = inline ? "click" : "pointerdown";
    document.addEventListener(outsideEvent, close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener(outsideEvent, close);
      document.removeEventListener("keydown", key);
    };
  }, [open, inline]);
  const text = value.length
    ? options
        .filter((o) => value.includes(o.value))
        .map((o) => o.label)
        .join(", ")
    : placeholder;
  return (
    <div ref={root} className="relative min-w-0">
      <button
        ref={button}
        type="button"
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 text-left text-xs dark:border-zinc-700 dark:bg-zinc-900"
      >
        <span className="truncate">{text}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div
          id={id}
          role="group"
          aria-label={label + " · opções"}
          className="absolute left-0 right-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-2 shadow-lg dark:border-zinc-700 dark:bg-zinc-900"
        >
          <button
            type="button"
            onClick={() => onChange([])}
            className="mb-1 w-full px-2 py-1 text-left text-xs text-accent-600"
          >
            Limpar seleção
          </button>
          {options.map((o) => (
            <label
              key={o.value}
              className="flex cursor-pointer items-center gap-2 rounded px-2 py-2 text-xs hover:bg-zinc-50 dark:hover:bg-zinc-800"
            >
              <Checkbox
                checked={value.includes(o.value)}
                onChange={(e) =>
                  onChange(
                    e.target.checked
                      ? [...value, o.value]
                      : value.filter((v) => v !== o.value),
                  )
                }
              />
              {o.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

