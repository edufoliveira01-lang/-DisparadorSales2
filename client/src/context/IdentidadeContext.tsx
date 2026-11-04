import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

interface Identidade { nome: string; faviconUrl: string | null; recarregar: () => void }
const Ctx = createContext<Identidade>({ nome: "", faviconUrl: null, recarregar: () => undefined });
export const EVENTO_IDENTIDADE = "identidade:atualizar";
const TITULO_PADRAO = typeof document !== "undefined" ? document.title : "";

/** Nome e ícone (favicon) do escritório: aparecem na aba do navegador, no menu e na tela de login. Endpoint público. */
export function IdentidadeProvider({ children }: { children: ReactNode }) {
  const [estado, setEstado] = useState<{ nome: string; faviconUrl: string | null }>({ nome: "", faviconUrl: null });
  const carregar = useCallback(() => {
    fetch("/api/auth/identidade", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { nome?: string; favicon_url?: string | null } | null) => { if (d) setEstado({ nome: d.nome ?? "", faviconUrl: d.favicon_url ?? null }); })
      .catch(() => undefined);
  }, []);
  useEffect(() => { carregar(); window.addEventListener(EVENTO_IDENTIDADE, carregar); return () => window.removeEventListener(EVENTO_IDENTIDADE, carregar); }, [carregar]);
  useEffect(() => {
    const url = estado.faviconUrl ?? "/favicon.svg";
    for (const rel of ["icon", "apple-touch-icon"]) {
      let el = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
      if (!el) { if (rel !== "icon" && !estado.faviconUrl) continue; el = document.createElement("link"); el.rel = rel; document.head.appendChild(el); }
      el.removeAttribute("type"); el.href = url;
    }
    document.title = estado.nome ? `${estado.nome} · DisparaZap` : TITULO_PADRAO;
  }, [estado]);
  const valor = useMemo(() => ({ ...estado, recarregar: carregar }), [estado, carregar]);
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}
export const useIdentidade = () => useContext(Ctx);
export const avisarIdentidadeMudou = () => window.dispatchEvent(new Event(EVENTO_IDENTIDADE));
