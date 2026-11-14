import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { useToast } from "@/components/ui/Toast";

interface Item { id: number; origem: "cadastro" | "processo"; processo_id: number | null; processo_rotulo: string | null; autor: string; texto: string; criado_em: string; importante: boolean; cumprida_em: string | null; cumprida_por: string | null }
const quando = (iso: string) => { const d = new Date(`${iso.replace(" ", "T")}Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }); };

/** Tudo o que foi anotado sobre o cliente (no cadastro e nos processos dele), com campo para anotar na hora. */
export function AnotacoesPessoa({ id, nome, gerir }: { id: number; nome: string; gerir: boolean }) {
  const { show } = useToast();
  const [itens, setItens] = useState<Item[] | null>(null);
  const [texto, setTexto] = useState("");
  const [importante, setImportante] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const carregar = useCallback(async () => {
    try { const r = await api.get<{ itens: Item[] }>(`/gestao/pessoas/${id}/anotacoes`, { fresh: true } as never); setItens(r.itens); }
    catch { setItens([]); show("Não foi possível carregar as anotações.", "error"); }
  }, [id, show]);
  useEffect(() => { void carregar(); }, [carregar]);
  const salvar = async () => {
    if (texto.trim().length < 2) return show("Escreva a anotação.", "info");
    setSalvando(true);
    try { await api.post(`/gestao/pessoas/${id}/anotacoes`, { texto, importante }); setTexto(""); setImportante(false); await carregar(); show("Anotação salva.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setSalvando(false); }
  };
  const cumprir = async (a: Item, cumprida: boolean) => {
    try { await api.post(`/gestao/anotacoes/${a.origem}/${a.id}/cumprir`, { cumprida }); await carregar(); show(cumprida ? "Pendência cumprida." : "Pendência reaberta.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível alterar.", "error"); }
  };
  const marcar = async (a: Item, valor: boolean) => {
    try { await api.post(`/gestao/anotacoes/${a.origem}/${a.id}/importante`, { importante: valor }); await carregar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível alterar.", "error"); }
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
          <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex cursor-pointer items-center gap-2 text-sm text-zinc-700 dark:text-zinc-200"><Checkbox checked={importante} onChange={(e) => setImportante(e.target.checked)} /> <span><b>Importante</b> — avisar quem abrir este cliente, até cumprir</span></label><Button loading={salvando} onClick={() => void salvar()}>Salvar anotação</Button></div>
        </div>
      )}
      {itens === null ? <p className="text-sm text-zinc-500" role="status">Carregando…</p> : itens.length === 0 ? <p className="rounded-2xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Nenhuma anotação ainda. Dica: de qualquer tela, o botão <b>Anotar</b> no topo (ou Alt+N) abre uma anotação rápida.</p> : (
        <ul className="space-y-3">
          {itens.map((a) => (
            <li key={`${a.origem}-${a.id}`} className={`rounded-2xl border bg-white p-4 dark:bg-zinc-900 ${a.importante && !a.cumprida_em ? "border-amber-300 dark:border-amber-500/40" : "border-zinc-200 dark:border-zinc-800"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-zinc-500">
                <span>{a.autor || "—"} · {quando(a.criado_em)}{a.origem === "processo" && a.processo_id ? <> · <Link className="text-accent-700 underline dark:text-accent-300" to={`/gestao/processos/${a.processo_id}`}>Processo {a.processo_rotulo}</Link></> : " · no cadastro"}</span>
                {gerir && <button type="button" onClick={() => void apagar(a)} className="rounded-lg p-1 text-zinc-400 hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800" aria-label="Apagar anotação"><Trash2 className="h-4 w-4" /></button>}
              </div>
              {a.importante && (
                <p className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  {a.cumprida_em
                    ? <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400"><Check className="h-3 w-3" /> Cumprida{a.cumprida_por ? ` por ${a.cumprida_por}` : ""} · {quando(a.cumprida_em)}</span>
                    : <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"><AlertTriangle className="h-3 w-3" /> Importante · pendente</span>}
                  {gerir && (a.cumprida_em ? <button type="button" className="text-zinc-500 underline" onClick={() => void cumprir(a, false)}>Reabrir</button> : <Button size="sm" variant="outline" onClick={() => void cumprir(a, true)}><Check className="h-4 w-4" /> Cumprido</Button>)}
                </p>
              )}
              {gerir && !a.importante && <button type="button" className="mt-2 text-xs text-zinc-500 underline hover:text-amber-700" onClick={() => void marcar(a, true)}>Marcar como importante</button>}
              <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-800 dark:text-zinc-100">{a.texto}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
