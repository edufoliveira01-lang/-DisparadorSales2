import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { socket } from "@/lib/socket";
import { api } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { useAuth } from "@/context/AuthContext";

export interface BatchProgress {
  id: string;
  tipo: "mensagens" | "lembretes";
  total: number;
  processados: number;
  enviados: number;
  falhas: number;
  ignorados: number;
  aguardandoReconexao: boolean;
}

const BatchProgressContext = createContext<{ lotes: BatchProgress[]; conectado: boolean } | null>(null);

export function BatchProgressProvider({ children }: { children: ReactNode }) {
  const { can } = useAuth();
  const canSend = can("messages.send");
  const [lotes, setLotes] = useState<BatchProgress[]>([]);
  const [conectado, setConectado] = useState(socket.connected);
  const { show } = useToast();

  useEffect(() => {
    if (!canSend) return;
    let disposed = false;
    let fetching = false;
    let revision = 0;
    const atualizar = (estado: BatchProgress[]) => { revision++; setLotes(estado); };
    const recuperar = async () => {
      if (fetching || disposed || document.visibilityState !== "visible") return;
      fetching = true;
      const requestedRevision = revision;
      try {
        const estado = await api.get<BatchProgress[]>("/send/batches");
        // Um push mais recente não pode ser substituído por uma consulta anterior.
        if (!disposed && requestedRevision === revision) setLotes(estado);
      } catch { /* A próxima consulta ou reconexão recuperará o estado. */ }
      finally { fetching = false; }
    };
    const conectar = () => {
      setConectado(true);
      socket.emit("batch:request-state");
    };
    const desconectar = () => setConectado(false);
    const iniciadas = ({ total }: { total: number }) => show(`Envio em lote iniciado: ${total} cliente(s).`, "info");
    const lembretesIniciados = ({ total }: { total: number }) => show(`Lote de lembretes iniciado: ${total} cliente(s).`, "info");
    const aguardando = ({ reason }: { reason: string }) => show(reason, "error");
    const interrompido = ({ reason, enviados, falhas }: { reason: string; enviados?: number; falhas?: number }) =>
      show(reason + (enviados !== undefined ? ` Enviados: ${enviados}. Falhas: ${falhas ?? 0}.` : ""), "error");
    const retomado = () => show("WhatsApp reconectado — envio em lote retomado.", "success");
    const concluido = ({ enviados, falhas }: { enviados: number; falhas: number }) =>
      show(`Lote concluído. Enviados: ${enviados}. Falhas: ${falhas}.`, falhas ? "error" : "success");
    const lembretesConcluidos = ({ enviados, falhas, ignorados }: { enviados: number; falhas: number; ignorados: number }) =>
      show(`Lembretes concluídos. Enviados: ${enviados}. Falhas: ${falhas}. Ignorados: ${ignorados}.`, falhas ? "error" : "success");
    const handlers: Record<string, (...args: any[]) => void> = {
      "batch:state": atualizar,
      connect: conectar,
      disconnect: desconectar,
      "send:batch-started": iniciadas,
      "lembrete:batch-started": lembretesIniciados,
      "send:batch-waiting-reconnect": aguardando,
      "send:batch-resumed": retomado,
      "send:batch-paused": interrompido,
      "lembrete:batch-paused": interrompido,
      "send:batch-completed": concluido,
      "lembrete:batch-completed": lembretesConcluidos,
    };
    for (const [evento, handler] of Object.entries(handlers)) socket.on(evento, handler);
    if (socket.connected) conectar();
    recuperar();
    const interval = setInterval(recuperar, 5000);
    document.addEventListener("visibilitychange", recuperar);
    return () => {
      disposed = true;
      clearInterval(interval);
      document.removeEventListener("visibilitychange", recuperar);
      for (const [evento, handler] of Object.entries(handlers)) socket.off(evento, handler);
    };
  }, [show, canSend]);

  return <BatchProgressContext.Provider value={{ lotes, conectado }}>{children}</BatchProgressContext.Provider>;
}

export function useBatchProgress() {
  const value = useContext(BatchProgressContext);
  if (!value) throw new Error("useBatchProgress precisa de BatchProgressProvider");
  return value;
}
