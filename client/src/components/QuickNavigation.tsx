import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Search } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { Modal } from "./ui/Modal";
import { permittedNavigation } from "@/lib/navigation";
import { useAuth } from "@/context/AuthContext";
const normalize = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function QuickNavigation({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const { user } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  useEffect(() => {
    if (open) {
      setQuery("");
      setSelected(0);
    }
  }, [open]);
  const results = useMemo(
    () =>
      permittedNavigation(user.permissions).filter((item) =>
        normalize(item.label + " " + item.description).includes(
          normalize(query),
        ),
      ),
    [query, user.permissions],
  );
  function choose(to: string) {
    onClose();
    if (to !== pathname) navigate(to);
  }
  return (
    <Modal presentation="center"
      open={open}
      onClose={onClose}
      title="Ir para uma página"
      description="Busque pelo nome ou pelo que deseja fazer."
      maxWidth="max-w-xl"
    >
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-3.5 top-3.5 h-[18px] w-[18px] text-zinc-400" />
        <input
          data-autofocus
          aria-label="Buscar páginas"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelected(0);
          }}
          placeholder="Calendário, contatos, mensagens…"
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setSelected((i) =>
                Math.max(0, Math.min(i + 1, results.length - 1)),
              );
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setSelected((i) => Math.max(i - 1, 0));
            }
            if (e.key === "Enter" && results[selected]) {
              e.preventDefault();
              choose(results[selected].to);
            }
          }}
          className="h-12 w-full rounded-xl border border-zinc-200 bg-zinc-50 pl-11 pr-4 text-sm dark:bg-zinc-950"
        />
      </div>
      <div className="space-y-1" aria-label="Resultados da busca">
        {results.map((item, index) => {
          const Icon = item.icon;
          return (
            <button
              key={item.to}
              type="button"
              onClick={() => choose(item.to)}
              className={`group flex w-full items-center gap-3 rounded-xl p-3 text-left transition-colors ${selected === index ? "bg-accent-50 dark:bg-accent-900/30" : "hover:bg-zinc-50 dark:hover:bg-zinc-800"}`}
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-accent-600 dark:bg-zinc-900 dark:text-accent-300">
                <Icon className="h-[18px] w-[18px]" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">
                  {item.label}
                </span>
                <span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">
                  {item.description}
                </span>
              </span>
              <ArrowUpRight className="h-4 w-4 shrink-0 text-zinc-400" />
            </button>
          );
        })}
        {!results.length && (
          <p className="py-10 text-center text-sm text-zinc-500" role="status">
            Nenhuma página encontrada. Tente outro termo.
          </p>
        )}
      </div>
    </Modal>
  );
}
