import { useCallback, useEffect, useState } from "react";
import { CalendarClock } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

interface Resumo { a_revisar: number; a_completar: number; completar: { id: number; processo_chave: string; tipo: string; motivo: string; data: string }[] }

/** Perícias e audiências marcadas nas publicações: as a REVISAR (entram em «Avisar» depois da revisão) e as a COMPLETAR (faltou cliente, data ou horário). */
export function CompromissosPendentes({ aoAbrirPublicacao, aoMudar }: { aoAbrirPublicacao?: (id: number) => void; aoMudar?: () => void }) {
  const { show } = useToast();
  const [r, setR] = useState<Resumo | null>(null);
  const [alvo, setAlvo] = useState<Resumo["completar"][number] | null>(null);
  const [data, setData] = useState(""); const [horario, setHorario] = useState(""); const [local, setLocal] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const carregar = useCallback(() => { api.get<Resumo>("/djen/compromissos/resumo").then(setR).catch(() => setR(null)); }, []);
  useEffect(carregar, [carregar]);

  async function salvar() {
    if (!alvo) return; setOcupado(true);
    try {
      const x = await api.post<{ estado: string; motivo: string }>(`/djen/publicacoes/${alvo.id}/compromisso`, { data: data ? data.split("-").reverse().join("/") : null, horario: horario || null, local: local || null });
      if (x.estado === "informado") { show("Compromisso no controle: ele já aparece em “Avisar”.", "success"); setAlvo(null); carregar(); aoMudar?.(); }
      else show(x.motivo || "Ainda falta algo para avisar.", "info");
    } catch (e) { show(e instanceof ApiError ? e.message : "Não foi possível salvar.", "error"); }
    finally { setOcupado(false); }
  }

  if (!r || (r.a_revisar === 0 && r.a_completar === 0)) return null;
  return (
    <section role="alert" aria-label="Perícias e audiências marcadas" className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 dark:border-red-500/30 dark:bg-red-500/10">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-red-900/90 dark:text-red-200/90"><CalendarClock className="h-4 w-4 shrink-0" /><strong className="font-semibold">Perícias e audiências: prioridade.</strong> <span>{r.a_revisar > 0 ? `${r.a_revisar} publicação(ões) para revisar: depois de revisadas, entram sozinhas em “Avisar”. ` : ""}{r.a_completar > 0 ? `${r.a_completar} para completar dados antes de avisar o cliente.` : ""}</span></p>
      {r.completar.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {r.completar.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-red-200 bg-white px-3 py-2 text-sm dark:border-red-500/30 dark:bg-zinc-900">
              <span className="min-w-0"><span className="block font-medium text-zinc-900 dark:text-zinc-100">{c.tipo === "audiencia" ? "Audiência" : "Perícia"} · {c.processo_chave}</span><span className="block text-xs text-zinc-500">{c.motivo}</span></span>
              <span className="flex gap-2">{aoAbrirPublicacao && <Button size="sm" variant="outline" onClick={() => aoAbrirPublicacao(c.id)}>Abrir</Button>}<Button size="sm" onClick={() => { setAlvo(c); setData(""); setHorario(""); setLocal(""); }}>Informar data e horário</Button></span>
            </li>))}
        </ul>)}
      <Modal open={Boolean(alvo)} onClose={() => setAlvo(null)} title="Informar data e horário" description="Se a publicação não traz a data legível, informe aqui. O compromisso entra em “Avisar” e o cliente é avisado como de costume." maxWidth="max-w-md"
        footer={<div className="flex w-full justify-end gap-2"><Button variant="outline" onClick={() => setAlvo(null)}>Cancelar</Button><Button loading={ocupado} disabled={!data || !horario} onClick={() => void salvar()}>Salvar e enviar para “Avisar”</Button></div>}>
        <div className="space-y-3 text-sm">
          <label className="block"><span className="font-medium">Data</span><Input type="date" value={data} onChange={(e) => setData(e.target.value)} className="mt-1.5" /></label>
          <label className="block"><span className="font-medium">Horário</span><Input type="time" value={horario} onChange={(e) => setHorario(e.target.value)} className="mt-1.5" /></label>
          <label className="block"><span className="font-medium">Local (opcional)</span><Input value={local} onChange={(e) => setLocal(e.target.value)} className="mt-1.5" placeholder="Rua, sala, fórum ou link" /></label>
        </div>
      </Modal>
    </section>
  );
}
