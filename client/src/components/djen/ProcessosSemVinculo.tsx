import { useCallback, useEffect, useState } from "react";
import { Link2Off, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

interface Item { chave: string; numero: string; publicacoes: number; ultima_data: string | null; ultimo_tipo: string | null; orgao: string | null; publicacao_id: number | null; pericias_agendadas: number; tem_ficha: boolean }
const dataBr = (iso?: string | null) => (iso ? iso.slice(0, 10).split("-").reverse().join("/") : "—");

/** Processos que o DJEN trouxe e ninguém ligou a um cliente: para vincular (pela publicação) ou excluir. */
export function ProcessosSemVinculo({ aberto, aoFechar, aoMudar, aoAbrirPublicacao }: { aberto: boolean; aoFechar: () => void; aoMudar: () => void; aoAbrirPublicacao: (id: number) => void }) {
  const { show } = useToast();
  const [itens, setItens] = useState<Item[] | null>(null);
  const [excluir, setExcluir] = useState<Item | null>(null);
  const carregar = useCallback(async () => {
    try { setItens((await api.get<{ itens: Item[] }>("/djen/processos/sem-vinculo")).itens); }
    catch { show("Não foi possível carregar os processos sem vínculo.", "error"); }
  }, [show]);
  useEffect(() => { if (aberto) { setItens(null); void carregar(); } }, [aberto, carregar]);

  async function confirmar() {
    const p = excluir; if (!p) return; setExcluir(null);
    try { await api.delete(`/djen/processos/${encodeURIComponent(p.chave)}`); show("Processo excluído do acompanhamento.", "success"); await carregar(); aoMudar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível excluir.", "error"); }
  }

  return (
    <>
      <Modal open={aberto} onClose={aoFechar} title="Processos sem vínculo" description="Processos que o DJEN trouxe e que ainda não estão ligados a nenhum cliente. Abra a publicação para vincular o cliente, ou exclua o que não é do escritório." maxWidth="max-w-3xl">
        {itens === null ? <p className="text-sm text-zinc-500">Carregando…</p> : itens.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-zinc-200 p-6 text-center text-sm text-zinc-500 dark:border-zinc-700">Nenhum processo sem vínculo. Tudo o que o DJEN trouxe está ligado a um cliente.</p>
        ) : (
          <ul className="divide-y divide-zinc-100 overflow-hidden rounded-2xl border border-zinc-200 bg-white dark:divide-zinc-800 dark:border-zinc-700 dark:bg-zinc-900">
            {itens.map((p) => (
              <li key={p.chave} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-zinc-900 dark:text-zinc-100"><Link2Off className="h-4 w-4 text-zinc-400" />{p.numero}</p>
                  <p className="mt-0.5 text-xs text-zinc-500">{p.publicacoes} publicação(ões){p.ultima_data ? ` · última em ${dataBr(p.ultima_data)}` : ""}{p.ultimo_tipo ? ` · ${p.ultimo_tipo}` : ""}</p>
                  {p.orgao && <p className="mt-0.5 line-clamp-1 text-xs text-zinc-500">{p.orgao}</p>}
                </div>
                <div className="flex items-center gap-2">
                  {p.pericias_agendadas > 0 && <Badge tone="warning">{p.pericias_agendadas} perícia(s) agendada(s)</Badge>}
                  {p.publicacao_id && <Button size="sm" variant="outline" onClick={() => { aoFechar(); aoAbrirPublicacao(p.publicacao_id!); }}>Abrir e vincular</Button>}
                  <Button size="sm" variant="danger" onClick={() => setExcluir(p)}><Trash2 className="h-4 w-4" /> Excluir</Button>
                </div>
              </li>))}
          </ul>)}
      </Modal>
      <ConfirmDialog open={Boolean(excluir)} title="Excluir processo do acompanhamento" message={`Excluir o processo ${excluir?.numero} e as ${excluir?.publicacoes ?? 0} publicação(ões) dele? O DJEN não vai trazê-lo de volta nas próximas consultas. Não pode ser desfeito.`} confirmLabel="Excluir" onConfirm={() => void confirmar()} onCancel={() => setExcluir(null)} />
    </>
  );
}
