import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

interface Item { id: number; origem: "cadastro" | "processo"; processo_id: number | null; processo_rotulo: string | null; autor: string; texto: string; criado_em: string }
const quando = (iso: string) => { const d = new Date(`${iso.replace(" ", "T")}Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };

/** Tudo o que foi anotado sobre o cliente (no cadastro e nos processos dele), com campo para anotar na hora. */
export function AnotacoesPessoa({ id, nome, gerir }: { id: number; nome: string; gerir: boolean }) {
  const { show } = useToast();
  const [itens, setItens] = useState<Item[] | null>(null);
  const [texto, setTexto] = useState("");
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    try { const r = await api.get<{ itens: Item[] }>(`/gestao/pessoas/${id}/anotacoes`, { fresh: true } as never); setItens(r.itens); }
    catch { setItens([]); show("Não foi possível carregar as anotações.", "error"); }
  }, [id, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const salvar = async () => {
    if (texto.trim().length < 2) return show("Escreva a anotação.", "info");
    setSalvando(true);
    try { await api.post(`/gestao/pessoas/${id}/anotacoes`, { texto }); setTexto(""); await carregar(); show("Anotação salva.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const apagar = async (a: Item) => {
    if (!window.confirm("Apagar esta anotação?")) return;
    try { await api.delete(a.origem === "cadastro" ? `/gestao/pessoas/${id}/anotacoes/${a.id}` : `/gestao/processos/${a.processo_id}/anotacoes/${a.id}`); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível apagar.", "error"); }
  };
  return (
    <section className="space-y-4">
      {gerir && (
        <div className="space-y-2 rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <Textarea rows={3} value={texto} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") void salvar(); }} placeholder={`Anotar sobre ${nome}… (Ctrl+Enter salva)`} />
          <div className="flex justify-end"><Button loading={salvando} onClick={() => void salvar()}>Salvar anotação</Button></div>
        </div>
      )}
      {itens === null ? <p className="text-sm text-zinc-500" role="status">Carregando…</p> : itens.length === 0 ? <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Nenhuma anotação ainda. Dica: de qualquer tela, o botão <b>Anotar</b> no topo (ou Alt+N) abre uma anotação rápida.</p> : (
        <ul className="space-y-3">
          {itens.map((a) => (
            <li key={`${a.origem}-${a.id}`} className="rounded-2xl border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                <span>{a.autor || "—"} · {quando(a.criado_em)}{a.origem === "processo" && a.processo_id ? <> · <Link className="text-accent-700 underline dark:text-accent-300" to={`/gestao/processos/${a.processo_id}`}>Processo {a.processo_rotulo}</Link></> : " · no cadastro"}</span>
                {gerir && <button type="button" onClick={() => void apagar(a)} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" aria-label="Apagar anotação"><Trash2 className="h-4 w-4" /></button>}
              </div>
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-100">{a.texto}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
