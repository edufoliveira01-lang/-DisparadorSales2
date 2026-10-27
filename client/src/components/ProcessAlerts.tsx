import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Bell, ChevronDown, ChevronUp, Clock3 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { api } from "@/lib/api";
import { useSocketEvent } from "@/hooks/useSocketEvent";

type Counts = { aguardando_retorno: number; pericias_sem_laudo: number };

export function ProcessAlerts() {
  const navigate = useNavigate();
  const [counts, setCounts] = useState<Counts | null>(null);
  const [recolhidoPara, setRecolhidoPara] = useState<string | null>(null);
  const emConsulta = useRef(false);
  const atualizar = useCallback(async () => {
    if (emConsulta.current) return;
    emConsulta.current = true;
    try {
      const status = await api.get<Counts>("/djen/status");
      setCounts({
        aguardando_retorno: status.aguardando_retorno,
        pericias_sem_laudo: status.pericias_sem_laudo,
      });
    } catch {
      // Um erro transitório não deve apagar os alertas já exibidos.
    } finally {
      emConsulta.current = false;
    }
  }, []);

  useEffect(() => {
    void atualizar();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void atualizar();
    }, 60_000);
    const aoRetornar = () => { if (document.visibilityState === "visible") void atualizar(); };
    window.addEventListener("focus", aoRetornar);
    document.addEventListener("visibilitychange", aoRetornar);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", aoRetornar);
      document.removeEventListener("visibilitychange", aoRetornar);
    };
  }, [atualizar]);
  useSocketEvent("djen:changed", atualizar);
  useSocketEvent("connect", atualizar);

  useEffect(() => {
    if (counts && counts.aguardando_retorno + counts.pericias_sem_laudo === 0) setRecolhidoPara(null);
  }, [counts]);

  const retornos = counts?.aguardando_retorno ?? 0;
  const semLaudo = counts?.pericias_sem_laudo ?? 0;
  const total = retornos + semLaudo;
  if (!total) return null;

  const chave = `${retornos}:${semLaudo}`;
  const recolhido = recolhidoPara === chave;
  return (
    <section aria-label="Avisos do acompanhamento processual" className="border-b border-amber-200 bg-amber-50/95 px-4 py-2.5 shadow-sm backdrop-blur dark:border-amber-900 dark:bg-amber-950/95 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-x-4 gap-y-2 text-xs text-amber-950 dark:text-amber-100">
        <button type="button" onClick={() => setRecolhidoPara(recolhido ? null : chave)} aria-expanded={!recolhido}
          className="inline-flex items-center gap-2 rounded-lg px-1 py-1 font-semibold hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:hover:bg-amber-900">
          <span className="relative"><Bell className="h-4 w-4 text-amber-700 dark:text-amber-300" /><span className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-amber-500" /></span>
          {total} {total === 1 ? "aviso para conferir" : "avisos para conferir"}
          {recolhido ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
        </button>
        {!recolhido && <div className="flex flex-wrap items-center gap-2" aria-live="polite">
          {retornos > 0 && <button type="button" onClick={() => navigate("/processos/aguardando")}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1 font-medium text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900">
            <Clock3 className="h-3.5 w-3.5" /> Aguardando retorno · {retornos}
          </button>}
          {semLaudo > 0 && <button type="button" onClick={() => navigate("/processos?semLaudo=1")}
            className="inline-flex items-center gap-1.5 rounded-full border border-amber-300 bg-white px-3 py-1 font-medium text-amber-900 transition hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900">
            <AlertCircle className="h-3.5 w-3.5" /> Perícias sem laudo · {semLaudo}
          </button>}
        </div>}
      </div>
    </section>
  );
}

