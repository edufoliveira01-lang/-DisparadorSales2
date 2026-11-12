import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { socket } from "@/lib/socket";
import { TrocaSenhaObrigatoria } from "@/components/TrocaSenhaObrigatoria";

export type Permission =
  | "dashboard.view" | "calendar.view" | "calendar.manage" | "templates.view" | "templates.manage"
  | "pending.view" | "pending.manage" | "history.view" | "history.manage" | "messages.send"
  | "contacts.view" | "contacts.manage" | "processes.view" | "processes.manage"
  | "djen.manage" | "deadlines.view" | "deadlines.manage" | "activity.view"
  | "integrations.manage" | "whatsapp.manage" | "team.manage" | "backup.manage"
  | "gestao.view" | "gestao.manage" | "financeiro.view" | "financeiro.manage" | "atendimento.use";
export type Role = "administrador" | "gestor" | "advogado" | "atendimento" | "consulta";
export interface TeamUser {
  id: number; username: string; display_name: string | null; email: string | null;
  role: Role; active: boolean; permissions: Permission[]; must_change_password?: boolean; home_page?: string;
}

const Context = createContext<{ user: TeamUser; can: (permission: Permission) => boolean } | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<TeamUser | null>(null);
  const [loading, setLoading] = useState(true);
  const can = useCallback((permission: Permission) => Boolean(user?.permissions.includes(permission)), [user]);
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch("/api/auth/me", { credentials: "same-origin" });
        if (response.status === 401) { window.location.replace(window.location.pathname === "/atendimento" ? "/login?next=atendimento" : "/login"); return; }
        if (!response.ok) throw new Error("Não foi possível verificar a sessão.");
        const data = await response.json() as { user: TeamUser };
        if (active) { setUser(data.user); setLoading(false); if (!data.user.must_change_password) socket.connect(); }
      } catch {
        if (active) window.location.replace("/login");
      }
    };
    void refresh();
    const focus = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("focus", focus);
    return () => { active = false; socket.disconnect(); window.removeEventListener("focus", focus); };
  }, []);
  if (loading || !user) return <div role="status" className="flex min-h-screen items-center justify-center text-sm text-slate-500">Preparando seu espaço de trabalho…</div>;
  if (user.must_change_password) return <TrocaSenhaObrigatoria usuario={user.username} aoConcluir={() => window.location.replace("/")} />;
  return <Context.Provider value={{ user, can }}>{children}</Context.Provider>;
}

export function useAuth() {
  const context = useContext(Context);
  if (!context) throw new Error("useAuth precisa de AuthProvider");
  return context;
}
