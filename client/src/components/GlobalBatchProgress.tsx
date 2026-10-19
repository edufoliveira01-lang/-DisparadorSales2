import { RefreshCw, WifiOff } from "lucide-react";
import { useBatchProgress } from "@/context/BatchProgressContext";

export function GlobalBatchProgress() {
  const { lotes, conectado } = useBatchProgress();
  if (!lotes.length) return null;
  return (
    <div className="sticky top-16 z-20 border-b border-accent-200 bg-accent-50/95 px-4 py-3 backdrop-blur dark:border-accent-900 dark:bg-zinc-900/95 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1360px] gap-3" aria-live="polite">
        {lotes.map((lote) => (
          <div key={lote.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-zinc-700 dark:text-zinc-200">
            {lote.aguardandoReconexao || !conectado ? <WifiOff className="h-4 w-4 text-amber-500" /> : <RefreshCw className="h-4 w-4 animate-spin text-accent-500" />}
            <p className="font-medium">
              {lote.tipo === "lembretes" ? "Enviando lembretes em lote" : "Enviando mensagens em lote"}
              <span className="ml-2 font-normal">{lote.processados} de {lote.total} processados</span>
            </p>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {lote.enviados} enviados · {lote.falhas} falhas
              {lote.ignorados > 0 && ` · ${lote.ignorados} ignorados`}
            </p>
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700"
              role="progressbar" aria-label={lote.tipo === "lembretes" ? "Progresso dos lembretes" : "Progresso das mensagens"}
              aria-valuemin={0} aria-valuemax={lote.total} aria-valuenow={lote.processados}>
              <div className="h-full bg-accent-500 transition-all" style={{ width: `${lote.total ? lote.processados / lote.total * 100 : 0}%` }} />
            </div>
            {lote.aguardandoReconexao && <p className="text-xs text-amber-600 dark:text-amber-400">Aguardando reconexão do WhatsApp para continuar.</p>}
            {!conectado && <p className="text-xs text-amber-600 dark:text-amber-400">Atualizando periodicamente enquanto a conexão em tempo real é restabelecida.</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
