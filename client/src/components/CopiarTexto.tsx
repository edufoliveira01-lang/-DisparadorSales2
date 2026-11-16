import { useState } from "react";
import { Check, Copy, ExternalLink } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { linkDoTribunal } from "@/lib/tribunal";

async function copiar(texto: string): Promise<boolean> {
  try { await navigator.clipboard.writeText(texto); return true; }
  catch {
    try { const t = document.createElement("textarea"); t.value = texto; t.style.position = "fixed"; t.style.opacity = "0"; document.body.appendChild(t); t.select(); const ok = document.execCommand("copy"); t.remove(); return ok; }
    catch { return false; }
  }
}

/** Botão pequeno que copia um texto (nome, número do processo…). Avisa quando copiou. */
export function CopiarTexto({ texto, rotulo }: { texto: string; rotulo: string }) {
  const { show } = useToast();
  const [ok, setOk] = useState(false);
  return (
    <button type="button" title={`Copiar ${rotulo}`} aria-label={`Copiar ${rotulo}`}
      onClick={async (e) => { e.preventDefault(); e.stopPropagation(); if (await copiar(texto)) { setOk(true); show(`${rotulo} copiado.`, "success"); setTimeout(() => setOk(false), 1500); } else show("Não foi possível copiar.", "error"); }}
      className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
      {ok ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
    </button>
  );
}

/** Abre a consulta do processo no site do tribunal. Quando o site não aceita o número no endereço, o número já vai copiado. */
export function AbrirNoTribunal({ numero, compacto = false }: { numero: string; compacto?: boolean }) {
  const { show } = useToast();
  const l = linkDoTribunal(numero);
  if (!l) return null;
  const titulo = l.direto ? `Consultar no site do tribunal (${l.nome})` : `Abrir ${l.nome} (o número vai copiado: cole na busca)`;
  const clique = () => { if (!l.direto) void copiar(numero).then((ok) => ok && show("Número copiado: cole na busca do tribunal.", "info")); };
  return (
    <a href={l.url} target="_blank" rel="noopener noreferrer" title={titulo} aria-label={titulo} onClick={clique}
      className={compacto ? "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 hover:border-zinc-400 hover:text-zinc-800 dark:border-zinc-700 dark:bg-zinc-900" : "inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-2.5 py-1 text-xs font-medium text-zinc-700 hover:border-zinc-400 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200"}>
      <ExternalLink className="h-3.5 w-3.5" />{compacto ? null : "Site do tribunal"}
    </a>
  );
}
