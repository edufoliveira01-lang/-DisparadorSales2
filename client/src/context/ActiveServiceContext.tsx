import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
const ActiveServiceContext = createContext<"pericias" | "processos">(
  "pericias",
);
export function ActiveServiceProvider({ children }: { children: ReactNode }) {
  const { pathname } = useLocation();
  const shared = pathname === "/agenda" || pathname === "/configuracoes";
  const active = pathname.startsWith("/processos")
    ? "processos"
    : shared && localStorage.getItem("sales.activeService") === "processos"
      ? "processos"
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
