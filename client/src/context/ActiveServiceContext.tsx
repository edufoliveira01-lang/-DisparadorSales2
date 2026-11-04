import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
export type AreaDeTrabalho = "pericias" | "processos" | "gestao";
const ActiveServiceContext = createContext<AreaDeTrabalho>("pericias");
export function ActiveServiceProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const shared = pathname === "/agenda" || pathname === "/configuracoes";
  const salva = localStorage.getItem("sales.activeService");
  const active: AreaDeTrabalho = pathname.startsWith("/gestao")
    ? "gestao"
    : pathname.startsWith("/processos")
      ? "processos"
      : shared && (salva === "processos" || salva === "gestao")
        ? salva
        : "pericias";
  useEffect(() => {
    localStorage.setItem("sales.activeService", active);
  }, [active]);
  return (
    <ActiveServiceContext.Provider value={active}>
      {children}
    </ActiveServiceContext.Provider>
  );
}
export const useActiveService = () => useContext(ActiveServiceContext);
