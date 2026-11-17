import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Label, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

/**
 * Concluir um andamento SEM esconder trabalho pendente.
 *
 * Escolhe o alcance (só este andamento, ou todos os abertos do processo), mostra o que ainda está pendente neles (perícia fora do controle, prazo
 * aberto, análise da IA que falhou) e, havendo pendência, só conclui com confirmação expressa e uma justificativa que fica no histórico.
 */
type Escopo = "andamento" | "processo";
interface Pendencia { publicacao_id: number; tipo: string; gravidade: "alta" | "media"; texto: string }
interface Previa { escopo: Escopo; andamentos: { id: number; data: string; tipo_documento: string | null }[]; pendencias: Pendencia[] }

const dataBR = (iso: string) => iso.split("-").reverse().join("/");
const erroTexto = (e: unknown) => (e instanceof ApiError ? e.message : "Não foi possível concluir.");

export function ConcluirAndamento({ open, publicacaoId, rotulo, totalAndamentos, onClose, onConcluido }: {
  open: boolean;
  publicacaoId: number;
  /** Ex.: «Ato ordinatório de 16/11/2026» */
  rotulo: string;
  totalAndamentos: number;
  onClose: () => void;
  onConcluido: (info: { escopo: Escopo; total: number; publicacaoId: number; ids: number[] }) => void;
}) {
  const [escopo, setEscopo] = useState<Escopo>("andamento");
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [justificativa, setJustificativa] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!open) return;
    setEscopo("andamento"); setJustificativa(""); setErro("");
  }, [open, publicacaoId]);

  useEffect(() => {
    if (!open) return;
    let ativo = true;
    setCarregando(true); setPrevia(null); setErro("");
    api.get<Previa>(`/djen/publicacoes/${publicacaoId}/conclusao-previa?escopo=${escopo}`)
      .then((r) => { if (ativo) setPrevia(r); })
      .catch((e) => { if (ativo) setErro(erroTexto(e)); })
      .finally(() => { if (ativo) setCarregando(false); });
    return () => { ativo = false; };
  }, [open, publicacaoId, escopo]);

  const pendencias = previa?.pendencias ?? [];
  const comPendencia = pendencias.length > 0;
  const justificativaOk = justificativa.trim().length >= 5;
  const alcance = previa?.andamentos.length ?? 0;

  async function concluir() {
    setSalvando(true); setErro("");
    try {
      const resultado = await api.post<{ conclusao: { ids: number[]; total: number } }>(`/djen/publicacoes/${publicacaoId}/conclusao`, {
        concluida: true, escopo, ...(comPendencia ? { forcar: true, justificativa: justificativa.trim() } : {}),
      });
      onConcluido({ escopo, total: resultado.conclusao.total, publicacaoId, ids: resultado.conclusao.ids });
      onClose();
    } catch (e) { setErro(erroTexto(e)); }
    finally { setSalvando(false); }
  }

  return (
    <Modal
      presentation="center"
      open={open}
      onClose={onClose}
      title="Concluir andamento"
      description="Concluir encerra a triagem. Prazos abertos continuam em acompanhamento. É possível desfazer."
      maxWidth="max-w-xl"
      footer={
        <div className="flex w-full flex-wrap justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={salvando}>Cancelar</Button>
          <Button
            variant={comPendencia ? "danger" : "primary"}
            loading={salvando}
            disabled={carregando || !previa || alcance === 0 || (comPendencia && !justificativaOk)}
            onClick={() => void concluir()}
          >
            {comPendencia ? "Concluir mesmo assim" : alcance > 1 ? `Concluir ${alcance} andamentos` : "Concluir andamento"}
          </Button>
        </div>
      }
    >
      <div className="space-y-4 text-sm">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">O que será concluído</legend>
          <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900">
            <input type="radio" name="escopo-conclusao" className="mt-1" checked={escopo === "andamento"} onChange={() => setEscopo("andamento")} />
            <span><strong>Só este andamento</strong><br /><span className="text-zinc-600 dark:text-zinc-400">{rotulo}</span></span>
          </label>
          {totalAndamentos > 1 && (
            <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-zinc-200 bg-white p-3 hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900">
              <input type="radio" name="escopo-conclusao" className="mt-1" checked={escopo === "processo"} onChange={() => setEscopo("processo")} />
              <span><strong>Todos os andamentos abertos deste processo</strong><br /><span className="text-zinc-600 dark:text-zinc-400">Este processo tem {totalAndamentos} andamentos. A triagem dos que estiverem abertos será concluída.</span></span>
            </label>
          )}
        </fieldset>

        {carregando && <p className="text-zinc-500">Conferindo pendências…</p>}

        {!carregando && previa && !comPendencia && (
          <p className="flex items-start gap-2 rounded-lg bg-emerald-50 p-3 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" /> Nenhuma pendência encontrada {alcance > 1 ? `nos ${alcance} andamentos` : "neste andamento"}.
          </p>
        )}

        {!carregando && comPendencia && (
          <div className="space-y-3">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200">
              <p className="mb-2 flex items-center gap-2 font-semibold"><AlertTriangle className="h-4 w-4" /> Ainda há pendências neste alcance</p>
              <ul className="list-disc space-y-1 pl-5">
                {pendencias.map((p, i) => <li key={`${p.publicacao_id}-${p.tipo}-${i}`}>{p.texto}</li>)}
              </ul>
            </div>
            <div>
              <Label htmlFor="justificativa-conclusao">Por que concluir mesmo assim? (obrigatório)</Label>
              <Textarea
                id="justificativa-conclusao"
                value={justificativa}
                onChange={(e) => setJustificativa(e.target.value)}
                rows={3}
                maxLength={1000}
                placeholder="Ex.: perícia já lançada na agenda do advogado; prazo cumprido pelo protocolo de hoje."
              />
              <p className="mt-1 text-xs text-zinc-500">A justificativa fica registrada no histórico de cada andamento concluído.</p>
            </div>
          </div>
        )}

        {erro && <p role="alert" className="text-red-700 dark:text-red-400">{erro}</p>}
      </div>
    </Modal>
  );
}

/** A faixa «Desfazer» que aparece logo depois de concluir. */
export function FaixaDesfazer({ info, onDesfazer, onFechar }: {
  info: { escopo: Escopo; total: number; publicacaoId: number } | null;
  onDesfazer: () => void;
  onFechar: () => void;
}) {
  useEffect(() => {
    if (!info) return;
    const t = window.setTimeout(onFechar, 20_000);
    return () => window.clearTimeout(t);
  }, [info, onFechar]);
  if (!info) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
      <span>{info.total > 1 ? `${info.total} andamentos concluídos.` : "Andamento concluído."}</span>
      <Button size="sm" variant="outline" onClick={onDesfazer}>Desfazer</Button>
      <button type="button" aria-label="Fechar aviso" className="text-zinc-400 hover:text-zinc-700" onClick={onFechar}>×</button>
    </div>
  );
}

export { dataBR };
