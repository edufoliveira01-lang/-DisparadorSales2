import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

/** Anotação marcada como IMPORTANTE que ainda não foi cumprida. */
export interface Pendencia { id: number; origem: "cadastro" | "processo"; processo_id: number | null; processo_rotulo: string | null; autor: string; texto: string; criado_em: string }
const quando = (iso: string) => { const d = new Date(`${iso.replace(" ", "T")}Z`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }); };
const chaveDaSessao = (pessoaId: number) => `pendencias-vistas-${pessoaId}`;

/** As pendências do cliente e o que fazer com elas. `cumprir` dá a pendência por cumprida (some do aviso; a anotação segue no histórico). */
export function usePendencias(pessoaId: number | null) {
  const { show } = useToast();
  const [itens, setItens] = useState<Pendencia[]>([]);
  const carregar = useCallback(async () => {
    if (!pessoaId) { setItens([]); return; }
    try { const r = await api.get<{ itens: Pendencia[] }>(`/gestao/pessoas/${pessoaId}/pendencias`, { fresh: true } as never); setItens(r.itens); }
    catch { /* o aviso é um extra: sem ele a ficha abre igual */ }
  }, [pessoaId]);
  useEffect(() => { void carregar(); }, [carregar]);
  const cumprir = async (p: Pendencia) => {
    try { await api.post(`/gestao/anotacoes/${p.origem}/${p.id}/cumprir`, {}); setItens((a) => a.filter((x) => !(x.id === p.id && x.origem === p.origem))); show("Pendência cumprida.", "success"); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível dar como cumprida.", "error"); }
  };
  return { itens, cumprir, recarregar: carregar };
}

function Linha({ p, aoCumprir, aoNavegar }: { p: Pendencia; aoCumprir: (p: Pendencia) => void; aoNavegar?: () => void }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-amber-200 bg-white px-3.5 py-3 dark:border-amber-500/30 dark:bg-zinc-900">
      <div className="min-w-0 flex-1">
        <p className="whitespace-pre-wrap text-sm font-medium text-zinc-900 dark:text-zinc-50">{p.texto}</p>
        <p className="mt-1 text-xs text-zinc-500">
          {p.autor || "—"} · {quando(p.criado_em)}
          {p.origem === "processo" && p.processo_id ? <> · <Link onClick={aoNavegar} className="text-accent-700 underline dark:text-accent-300" to={`/gestao/processos/${p.processo_id}`}>Processo {p.processo_rotulo}</Link></> : " · no cadastro"}
        </p>
      </div>
      <Button size="sm" variant="outline" onClick={() => aoCumprir(p)} aria-label={`Dar como cumprida: ${p.texto.slice(0, 40)}`}><Check className="h-4 w-4" /> Cumprido</Button>
    </li>
  );
}

/** Faixa fixa no topo da ficha, em qualquer aba: some quando não há pendência. */
export function FaixaDePendencias({ itens, aoCumprir }: { itens: Pendencia[]; aoCumprir: (p: Pendencia) => void }) {
  if (itens.length === 0) return null;
  return (
    <section role="alert" aria-label="Pendências do cliente" className="rounded-2xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/40 dark:bg-amber-500/10">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-200"><AlertTriangle className="h-4 w-4" />{itens.length === 1 ? "Há 1 pendência neste cliente" : `Há ${itens.length} pendências neste cliente`}</h2>
      <ul className="mt-3 space-y-2">{itens.map((p) => <Linha key={`${p.origem}-${p.id}`} p={p} aoCumprir={aoCumprir} />)}</ul>
    </section>
  );
}

/** O selo ao lado do nome, no cabeçalho. */
export function SeloDePendencias({ total }: { total: number }) {
  if (total === 0) return null;
  return <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/20 dark:text-amber-200"><AlertTriangle className="h-3 w-3" />{total === 1 ? "1 pendência" : `${total} pendências`}</span>;
}

/** O pop-up de quando se abre o cliente: aparece UMA vez por sessão para cada cliente com pendência. */
export function AvisoDePendencias({ pessoaId, nome, itens, aoCumprir }: { pessoaId: number; nome: string; itens: Pendencia[]; aoCumprir: (p: Pendencia) => void }) {
  const [aberto, setAberto] = useState(false);
  useEffect(() => {
    if (itens.length === 0) { setAberto(false); return; }
    try { if (sessionStorage.getItem(chaveDaSessao(pessoaId))) return; sessionStorage.setItem(chaveDaSessao(pessoaId), "1"); } catch { /* sem armazenamento: avisa sempre */ }
    setAberto(true);
  }, [pessoaId, itens.length]);
  return (
    <Modal open={aberto && itens.length > 0} onClose={() => setAberto(false)} presentation="center" title={`Atenção: ${nome}`} description={itens.length === 1 ? "Este cliente tem 1 pendência anotada como importante." : `Este cliente tem ${itens.length} pendências anotadas como importantes.`} maxWidth="max-w-xl"
      footer={<div className="flex w-full justify-end"><Button onClick={() => setAberto(false)}>Entendi</Button></div>}>
      <ul className="space-y-2">{itens.map((p) => <Linha key={`${p.origem}-${p.id}`} p={p} aoCumprir={aoCumprir} aoNavegar={() => setAberto(false)} />)}</ul>
    </Modal>
  );
}
