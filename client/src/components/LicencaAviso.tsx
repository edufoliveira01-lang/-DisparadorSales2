import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Lock, Info } from "lucide-react";
import { api } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";

interface EstadoLicenca {
  modo: "proprio" | "licenciado";
  status: "teste" | "ativa" | "carencia" | "suspensa" | "cancelada" | "sem_contato";
  restrito: boolean;
  aviso: string | null;
}

/** Aviso da assinatura. Em instalação própria (sem licença) ou com tudo em dia, não aparece. */
export function LicencaAviso() {
  const { can } = useAuth();
  const [estado, setEstado] = useState<EstadoLicenca | null>(null);
  const [verificando, setVerificando] = useState(false);
  const atualizar = useCallback(async () => {
    try { setEstado(await api.get<EstadoLicenca>("/license/status", { background: true })); } catch { /* o aviso é opcional */ }
  }, []);
  useEffect(() => {
    void atualizar();
    const t = window.setInterval(() => { if (document.visibilityState === "visible") void atualizar(); }, 10 * 60_000);
    return () => window.clearInterval(t);
  }, [atualizar]);

  if (!estado || estado.modo === "proprio" || !estado.aviso) return null;
  const critico = estado.restrito;
  const alerta = estado.status === "carencia" || estado.status === "sem_contato";
  const Icone = critico ? Lock : alerta ? AlertTriangle : Info;
  const cor = critico
    ? "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950 dark:text-red-200"
    : alerta
      ? "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-200"
      : "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950 dark:text-sky-200";
  return (
    <section role={critico ? "alert" : "status"} aria-label="Situação da assinatura" className={`flex flex-wrap items-center gap-3 border-b px-4 py-2.5 text-xs ${cor}`}>
      <Icone className="h-4 w-4 shrink-0" />
      <p className="min-w-0 flex-1 leading-relaxed">{estado.aviso}</p>
      {(critico || alerta) && can("team.manage") && (
        <button type="button" disabled={verificando} className="rounded-lg border border-current/30 px-3 py-1 font-medium hover:bg-white/50 disabled:opacity-60 dark:hover:bg-black/20"
          onClick={async () => { setVerificando(true); try { await api.post("/license/verificar-agora", {}); } catch { /* mantém o aviso atual */ } await atualizar(); setVerificando(false); }}>
          {verificando ? "Verificando…" : "Já regularizei · verificar agora"}
        </button>
      )}
    </section>
  );
}
