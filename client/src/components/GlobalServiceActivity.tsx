import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Loader2 } from "lucide-react";
import { Link } from "react-router-dom";
import { api } from "@/lib/api";
import { socket } from "@/lib/socket";
import { requestActivities } from "@/lib/requestActivity";
import { useWhatsapp } from "@/context/WhatsappContext";
import { useBatchProgress } from "@/context/BatchProgressContext";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthContext";

interface Job { id: string; label: string; href: string; waiting?: boolean }
interface DjenStatus {
  executando: number | null;
  ultimas: { id: number; status: string }[];
  codex: { executando: number | null; executando_ids?: number[]; pendentes: number; pausa: string | null };
}
interface GoogleJob { state: string; error: string | null; background?: { running: boolean; pending: number } }
interface CalendarStatus { executando: number; na_fila: number }

/** Mounted in the shared shell: polling and notifications survive every route change. */
export function GlobalServiceActivity() {
  const { can } = useAuth();
  const showDjen = can("processes.view");
  const showGoogle = can("integrations.manage");
  const showCalendars = can("deadlines.view");
  const showWhatsapp = can("whatsapp.manage");
  const showBatches = can("messages.send");
  const requests = useSyncExternalStore(requestActivities.subscribe, requestActivities.getSnapshot);
  const whatsapp = useWhatsapp();
  const { lotes } = useBatchProgress();
  const { show } = useToast();
  const [jobs, setJobs] = useState<Record<string, Job[]>>({});
  const [expanded, setExpanded] = useState(false);
  const previousWhatsapp = useRef(whatsapp.status);
  useEffect(() => {
    const previous = previousWhatsapp.current;
    previousWhatsapp.current = whatsapp.status;
    const wasConnecting = showWhatsapp && ["inicializando", "aguardando_qr", "pareando", "autenticado"].includes(previous);
    if (wasConnecting && whatsapp.status === "conectado") show("WhatsApp conectado. Sincronização concluída.", "success");
    if (wasConnecting && whatsapp.status === "falha") show(whatsapp.lastError || "Não foi possível conectar o WhatsApp. Confira a conexão nas configurações.", "error");
  }, [whatsapp.status, whatsapp.lastError, show, showWhatsapp]);

  useEffect(() => {
    let disposed = false;
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const fetching = new Set<string>();
    const previous: Record<string, unknown> = {};
    const update = <T,>(key: string, path: string, describe: (value: T) => Job[], complete?: (old: T, next: T) => void) => {
      if (disposed || fetching.has(key) || document.visibilityState !== "visible") return;
      fetching.add(key);
      void api.get<T>(path, { background: true, signal: AbortSignal.timeout(10000) }).then(value => {
        if (disposed) return;
        if (previous[key]) complete?.(previous[key] as T, value);
        previous[key] = value;
        setJobs(current => ({ ...current, [key]: describe(value) }));
      }).catch(() => {
        if (!disposed) setJobs(current => ({ ...current, [key]: (current[key] ?? []).map(job => ({ ...job, waiting: true })) }));
      }).finally(() => fetching.delete(key));
    };
    const refresh = () => {
      if (showDjen) {
      update<DjenStatus>("djen", "/djen/status", status => {
        const result: Job[] = [];
        if (status.executando) result.push({ id: "djen", label: "DJEN · Buscando publicações", href: "/processos/monitoramento" });
        const active = status.codex?.executando_ids?.length || (status.codex?.executando ? 1 : 0);
        if (active) result.push({ id: "codex", label: `Codex · Analisando ${active} publicação(ões)${status.codex.pendentes ? ` · ${status.codex.pendentes} na fila` : ""}`, href: "/processos/monitoramento" });
        return result;
      }, (old, next) => {
        if (old.executando && old.executando !== next.executando) {
          const result = next.ultimas?.find(search => search.id === old.executando);
          if (result) show(result.status === "concluida" ? "Busca no DJEN concluída." : "Busca no DJEN encerrada. Confira o resultado no monitoramento.", result.status === "falha" ? "error" : "info");
        }
      });
      }
      if (showGoogle) {
      update<GoogleJob>("google", "/google-calendar/sync/status", value => value.state === "running" || value.background?.running || value.background?.pending
        ? [{ id: "google", label: "Google Agenda · Sincronizando eventos", href: "/configuracoes?google=1" }] : [], (old, next) => {
          if (old.state === "running" && next.state !== "running") show(next.state === "completed" ? "Sincronização com o Google Agenda concluída." : next.error || "Falha ao sincronizar o Google Agenda.", next.state === "completed" ? "success" : "error");
        });
      }
      if (showCalendars) {
      update<CalendarStatus>("calendars", "/djen/calendarios", value => value.executando || value.na_fila
        ? [{ id: "calendars", label: `Tribunais · Importando calendários${value.na_fila ? ` · ${value.na_fila} na fila` : ""}`, href: "/processos/calendarios" }] : []);
      }
    };
    const schedule = () => { clearTimeout(debounce); debounce = setTimeout(refresh, 200); };
    refresh();
    const timer = setInterval(refresh, 5000);
    socket.on("djen:changed", schedule);
    socket.on("connect", schedule);
    window.addEventListener("services:refresh", schedule);
    window.addEventListener("focus", schedule);
    document.addEventListener("visibilitychange", schedule);
    return () => {
      disposed = true;
      clearTimeout(debounce);
      clearInterval(timer);
      socket.off("djen:changed", schedule);
      socket.off("connect", schedule);
      window.removeEventListener("services:refresh", schedule);
      window.removeEventListener("focus", schedule);
      document.removeEventListener("visibilitychange", schedule);
    };
  }, [show, showDjen, showGoogle, showCalendars]);

  const activities: Job[] = Object.values(jobs).flat();
  const progress = typeof whatsapp.syncProgress === "number" ? ` (${Math.round(whatsapp.syncProgress)}%)` : "";
  const whatsappLabel = !whatsapp.carregado ? "WhatsApp · Verificando conexão" : whatsapp.status === "aguardando_qr" ? "WhatsApp · Aguardando leitura do QR Code"
    : whatsapp.status === "pareando" ? "WhatsApp · Validando vínculo com o celular"
    : whatsapp.status === "autenticado" || (whatsapp.status === "inicializando" && typeof whatsapp.syncProgress === "number") ? `WhatsApp · Sincronizando${progress}`
    : whatsapp.status === "inicializando" || whatsapp.conectando ? `WhatsApp · ${whatsapp.faseInicializacao || "Iniciando conexão"}` : null;
  if (showWhatsapp && whatsappLabel) activities.unshift({ id: "whatsapp", label: whatsappLabel, href: "/configuracoes?whatsapp=1" });
  if (showBatches) for (const batch of lotes) activities.push({ id: batch.id, label: `${batch.tipo === "lembretes" ? "Lembretes" : "Mensagens"} · ${batch.aguardandoReconexao ? "Aguardando reconexão do WhatsApp" : `${batch.processados} de ${batch.total} processados`}`, href: "/", waiting: batch.aguardandoReconexao });
  for (const request of requests) activities.push({ id: `request-${request.id}`, label: request.label + (request.count > 1 ? ` · ${request.count} tarefas` : ""), href: "" });
  if (!activities.length) return null;
  return (
    <section className="service-activity" aria-label="Serviços em andamento">
      <div className="service-activity-heading">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent-500" aria-hidden="true" />
        <p role="status" className="min-w-0 flex-1 text-xs font-medium">{activities.length === 1 ? activities[0].label : `${activities.length} serviços em andamento · ${activities[0].label}`}{activities[0].waiting && " · Aguardando atualização"}</p>
        <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls="service-activity-list" className="service-activity-toggle" aria-label={expanded ? "Recolher serviços em andamento" : "Ver serviços em andamento"}>
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>
      {expanded && <ul id="service-activity-list" className="service-activity-list">{activities.map(job => <li key={job.id}>{job.href ? <Link to={job.href}>{job.label}{job.waiting && " · Aguardando atualização"}</Link> : <span>{job.label}</span>}</li>)}</ul>}
    </section>
  );
}
