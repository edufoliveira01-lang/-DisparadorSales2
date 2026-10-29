import { useRef, useState } from "react";
import { Send } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { createInFlightGuard } from "@/lib/inFlightGuard";
import type { PericiaAgendada } from "@/lib/types";
import { formatPhoneDisplay, formatPhoneInput } from "@/lib/phone";
import { useWhatsapp } from "@/context/WhatsappContext";
import { useToast } from "./ui/Toast";
import { Button } from "./ui/Button";
import { Modal } from "./ui/Modal";
import { Input, Label } from "./ui/Input";
import { useAuth } from "@/context/AuthContext";

interface Pending { ids: number[]; nome: string; processo?: string; contato?: { id: number; nome: string; telefone: string } }
interface Validation { pendencias: Pending[]; telefonesPendentes?: Pending[]; eventos?: PericiaAgendada[] }
const guard = createInFlightGuard<number>();

export function CalendarReminderButton({ pericia, onSent }: { pericia: PericiaAgendada; onSent: () => void }) {
  const { can } = useAuth();
  const { status } = useWhatsapp();
  const { show } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [event, setEvent] = useState(pericia);
  const [pending, setPending] = useState<{ type: "telefone" | "processo"; data: Pending } | null>(null);
  const [value, setValue] = useState("");
  const lock = useRef(false);
  const current = useRef(pericia);
  const resend = Boolean(event.ultimo_lembrete_em);
  const active = pericia.status === "ativa";
  function checkConnection() {
    if (status === "conectado") return true;
    show("Conecte o WhatsApp em Configurações antes de enviar lembretes.", "error");
    return false;
  }
  function setMissing(type: "telefone" | "processo", data: Pending) {
    setPending({ type, data }); setValue(type === "processo" ? data.processo || "" : "");
  }
  function handleError(error: unknown) {
    if (error instanceof ApiError && error.data?.pendencia) {
      if (error.data.code === "TELEFONE_NAO_INFORMADO") { setMissing("telefone", error.data.pendencia as Pending); return; }
      if (error.data.code === "PROCESSO_NAO_IDENTIFICADO") { setMissing("processo", error.data.pendencia as Pending); return; }
    }
    show(error instanceof Error ? error.message : "Não foi possível enviar o lembrete.", "error");
  }
  async function validate() {
    const result = await api.post<Validation>("/pericias-agendadas/validar-lembretes", { ids: [pericia.id] });
    if (result.pendencias?.length) setMissing("processo", result.pendencias[0]);
    else if (result.telefonesPendentes?.length) setMissing("telefone", result.telefonesPendentes[0]);
    else { setPending(null); current.current = result.eventos?.find(item => item.id === pericia.id) || current.current; setEvent(current.current); }
  }
  async function begin() {
    if (lock.current || !active || !checkConnection()) return;
    lock.current = true; current.current = pericia; setBusy(true); setEvent(pericia); setPending(null); setOpen(true);
    try { await validate(); } catch (error) { handleError(error); setOpen(false); }
    finally { lock.current = false; setBusy(false); }
  }
  async function confirm() {
    if (lock.current || !checkConnection()) return;
    if (!guard.tryStart(pericia.id)) { show("Este lembrete já está em processamento.", "info"); return; }
    lock.current = true; setBusy(true);
    try {
      if (pending) {
        await api.post(`/pericias-agendadas/completar-${pending.type}`, {
          ids: pending.data.ids, ...(pending.type === "telefone" ? { telefone: value.trim() } : { contactId: pending.data.contato?.id, processo: value.trim() }),
        });
        current.current = { ...current.current, ...(pending.type === "telefone" ? { telefone: value.trim() } : { processo: value.trim() }) };
        await validate();
        show("Dados conferidos. Revise o destino e confirme o lembrete.", "info");
      } else {
        await api.post(`/pericias-agendadas/${pericia.id}/lembrete`, { forcar: resend });
        setOpen(false); show(`Lembrete ${resend ? "reenviado" : "enviado"} para ${event.nome}.`, "success"); onSent();
      }
    } catch (error) { handleError(error); }
    finally { guard.finish(pericia.id); lock.current = false; setBusy(false); }
  }
  if (!active || !can("messages.send")) return null;
  return <>
    <Button size="sm" variant="outline" onClick={() => void begin()} loading={busy} aria-label={`${pericia.ultimo_lembrete_em ? "Reenviar" : "Enviar"} lembrete para ${pericia.nome}`}><Send className="h-3.5 w-3.5" />{pericia.ultimo_lembrete_em ? "Reenviar lembrete" : "Enviar lembrete"}</Button>
    <Modal open={open} onClose={() => { if (!busy) setOpen(false); }} title={pending ? pending.type === "telefone" ? "Informe o telefone" : "Confirme o processo" : resend ? "Reenviar lembrete" : "Enviar lembrete"} description={pending ? "Complete os dados do destinatário para continuar." : "Confira o compromisso e o destinatário antes do envio."} footer={<><Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button><Button loading={busy} disabled={Boolean(pending && !value.trim())} onClick={() => void confirm()}>{pending ? "Salvar e revisar" : resend ? "Confirmar reenvio" : "Confirmar envio"}</Button></>}>
      <div className="space-y-4"><p className="font-semibold">{event.nome}</p><p className="text-sm text-zinc-500 dark:text-zinc-400">{event.tipo} · {event.data} {event.horario && `às ${event.horario}`}</p><p className="text-sm text-zinc-500 dark:text-zinc-400">{event.local || "Local não informado"}</p>
      {pending ? <div><Label htmlFor={`reminder-value-${pericia.id}`}>{pending.type === "telefone" ? "Telefone com DDD" : "Número do processo"}</Label><Input id={`reminder-value-${pericia.id}`} data-autofocus inputMode={pending.type === "telefone" ? "tel" : "text"} value={value} onChange={e => setValue(pending.type === "telefone" ? formatPhoneInput(e.target.value) : e.target.value)} />{pending.data.contato && <p className="mt-2 text-xs text-zinc-500">Contato encontrado: {pending.data.contato.nome}</p>}</div> : <><p className="rounded-xl bg-accent-50 p-4 text-sm text-accent-700 dark:bg-accent-900/30 dark:text-accent-200">Destino: {formatPhoneDisplay(event.telefone)}<br />Processo: {event.processo || "A conferir"}</p>{resend && <p className="text-sm text-amber-700 dark:text-amber-300">Este compromisso já recebeu um lembrete. Confirmar enviará uma nova mensagem.</p>}</>}
      </div>
    </Modal>
  </>;
}
