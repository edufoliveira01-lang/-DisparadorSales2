import { useState } from "react";
import { Archive, CheckCircle2, RotateCcw } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Textarea } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";
import { dataBr } from "./comum";

export const DESFECHOS: [string, string, string][] = [
  ["procedente", "Procedente", "O pedido foi acolhido."],
  ["parcialmente_procedente", "Parcialmente procedente", "O pedido foi acolhido em parte."],
  ["improcedente", "Improcedente", "O pedido foi negado."],
  ["acordo", "Acordo homologado", "As partes fizeram acordo e o juiz homologou."],
  ["extinto", "Extinto sem resolução do mérito", "O processo foi extinto sem julgar o pedido (desistência, ilegitimidade etc.)."],
];
const hoje = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

/** Concluir (com o resultado), arquivar e reabrir o processo. */
export function BotoesDeEncerramento({ processoId, status, aoMudar }: { processoId: number; status: string; aoMudar: () => void }) {
  const { show } = useToast();
  const [concluindo, setConcluindo] = useState(false);
  const [arquivando, setArquivando] = useState(false);
  const [reabrindo, setReabrindo] = useState(false);
  const [desfecho, setDesfecho] = useState("");
  const [data, setData] = useState(hoje());
  const [obs, setObs] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const aberto = status === "ativo" || status === "suspenso";

  async function rodar(fn: () => Promise<unknown>, ok: string, fechar: () => void) {
    setOcupado(true);
    try { await fn(); show(ok, "success"); fechar(); setDesfecho(""); setObs(""); aoMudar(); }
    catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível concluir a ação.", "error"); }
    finally { setOcupado(false); }
  }

  return (
    <>
      {aberto ? (
        <>
          <Button variant="outline" onClick={() => { setData(hoje()); setConcluindo(true); }}><CheckCircle2 className="h-4 w-4" /> Concluir processo</Button>
          <Button variant="outline" onClick={() => setArquivando(true)}><Archive className="h-4 w-4" /> Arquivar</Button>
        </>
      ) : <Button variant="outline" onClick={() => setReabrindo(true)}><RotateCcw className="h-4 w-4" /> Reabrir</Button>}

      <Modal open={concluindo} onClose={() => setConcluindo(false)} title="Concluir processo" description="Registre como o processo terminou. Ele sai do “em andamento” e a fase passa a Pagamento e conclusão." maxWidth="max-w-lg"
        footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={() => setConcluindo(false)}>Cancelar</Button><Button loading={ocupado} disabled={!desfecho} onClick={() => void rodar(() => api.post(`/gestao/processos/${processoId}/concluir`, { desfecho, data, observacao: obs }), "Processo concluído.", () => setConcluindo(false))}>Concluir</Button></div>}>
        <div className="space-y-3 text-sm">
          <fieldset className="space-y-2"><legend className="font-medium text-zinc-800 dark:text-zinc-200">Resultado</legend>
            {DESFECHOS.map(([k, r, d]) => (
              <label key={k} className={`flex cursor-pointer items-start gap-3 rounded-xl border bg-white p-3 dark:bg-zinc-900 ${desfecho === k ? "border-accent-500 ring-2 ring-accent-200 dark:ring-accent-500/30" : "border-zinc-200 hover:border-zinc-400 dark:border-zinc-700"}`}>
                <input type="radio" name="desfecho" className="mt-1" checked={desfecho === k} onChange={() => setDesfecho(k)} />
                <span><span className="block font-semibold text-zinc-900 dark:text-zinc-100">{r}</span><span className="block text-xs text-zinc-500">{d}</span></span>
              </label>))}
          </fieldset>
          <label className="block"><span className="font-medium text-zinc-800 dark:text-zinc-200">Data da conclusão</span><Input type="date" value={data} max={hoje()} onChange={(e) => setData(e.target.value)} className="mt-1.5" /></label>
          <label className="block"><span className="font-medium text-zinc-800 dark:text-zinc-200">Observação (opcional)</span><Textarea rows={2} value={obs} onChange={(e) => setObs(e.target.value)} className="mt-1.5" placeholder="Ex.: benefício concedido a partir de 10/2026; cabe recurso até…" maxLength={1000} /></label>
        </div>
      </Modal>

      <Modal open={arquivando} onClose={() => setArquivando(false)} title="Arquivar processo" description="Use quando o processo não vai mais andar no escritório (cliente desistiu, caso encerrado sem resultado etc.). Dá para reabrir depois." maxWidth="max-w-md"
        footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={() => setArquivando(false)}>Cancelar</Button><Button loading={ocupado} onClick={() => void rodar(() => api.post(`/gestao/processos/${processoId}/arquivar`, { observacao: obs }), "Processo arquivado.", () => setArquivando(false))}>Arquivar</Button></div>}>
        <label className="block text-sm"><span className="font-medium text-zinc-800 dark:text-zinc-200">Motivo (opcional)</span><Textarea rows={3} value={obs} onChange={(e) => setObs(e.target.value)} className="mt-1.5" maxLength={1000} /></label>
      </Modal>

      <ConfirmDialog open={reabrindo} title="Reabrir processo" message="O processo volta a “Ativo” e o resultado registrado é apagado. A fase continua como estava; ajuste-a se precisar." confirmLabel="Reabrir"
        onConfirm={() => void rodar(() => api.post(`/gestao/processos/${processoId}/reabrir`, {}), "Processo reaberto.", () => setReabrindo(false))} onCancel={() => setReabrindo(false)} />
    </>
  );
}

/** Faixa no alto da ficha: como o processo terminou. */
export function FaixaDoDesfecho({ desfecho }: { desfecho: { codigo: string; rotulo: string; em: string | null; observacao: string; arquivado: boolean } | null }) {
  if (!desfecho) return null;
  const tom = desfecho.arquivado ? "border-zinc-300 bg-zinc-50 text-zinc-800 dark:border-zinc-600 dark:bg-zinc-800/50 dark:text-zinc-100"
    : desfecho.codigo === "improcedente" || desfecho.codigo === "extinto" ? "border-red-200 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
    : "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200";
  return (
    <section role="status" aria-label="Desfecho do processo" className={`rounded-2xl border p-4 ${tom}`}>
      <p className="flex items-center gap-2 text-sm font-semibold">{desfecho.arquivado ? <Archive className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}{desfecho.arquivado ? "Processo arquivado" : `Processo concluído: ${desfecho.rotulo}`}{desfecho.em ? ` · ${dataBr(desfecho.em)}` : ""}</p>
      {desfecho.observacao && <p className="mt-1 text-sm opacity-90">{desfecho.observacao}</p>}
    </section>
  );
}
