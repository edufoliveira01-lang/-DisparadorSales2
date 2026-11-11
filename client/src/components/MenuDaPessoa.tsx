import { Check, LogOut, Monitor, Moon, Settings, Sun, UserRound, Zap } from "lucide-react";
import { Link } from "react-router-dom";
import { MenuSuspenso } from "./MenuSuspenso";
import { useAuth } from "@/context/AuthContext";
import { type ThemeMode, useTheme } from "@/context/ThemeContext";
import { api } from "@/lib/api";

const TEMAS: Array<{ modo: ThemeMode; texto: string; icone: typeof Sun }> = [
  { modo: "light", texto: "Claro", icone: Sun },
  { modo: "dark", texto: "Escuro", icone: Moon },
  { modo: "system", texto: "Automático (segue o computador)", icone: Monitor },
];

/** O avatar do topo: conta, tema (claro, escuro ou automático), modo leve, configurações e sair. */
export function MenuDaPessoa({ leve, aoAlternarLeve }: { leve: boolean; aoAlternarLeve: () => void }) {
  const { user, can } = useAuth();
  const { mode, setMode } = useTheme();
  const nome = user.display_name || user.username;
  return (
    <MenuSuspenso gatilho={({ aberto, alternar }) => (
      <button type="button" onClick={alternar} aria-haspopup="menu" aria-expanded={aberto} aria-label={`Menu de ${nome}`} className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-100 text-[12px] font-semibold text-accent-700 ring-2 ring-transparent transition hover:ring-accent-300 dark:bg-accent-900 dark:text-accent-200">
        {nome.slice(0, 2).toUpperCase()}
      </button>
    )}>
      {(fechar) => (
        <>
          <div className="px-3 pb-2 pt-1.5"><p className="text-sm font-semibold text-zinc-900 dark:text-white">{nome}</p><p className="text-xs capitalize text-zinc-500">{user.role}</p></div>
          <Link to="/minha-conta" onClick={fechar} className="menu-pop-item" role="menuitem"><UserRound className="h-4 w-4" /> Minha conta</Link>
          {can("integrations.manage") && <Link to="/configuracoes" onClick={fechar} className="menu-pop-item" role="menuitem"><Settings className="h-4 w-4" /> Configurações</Link>}
          <p className="menu-pop-title">Aparência</p>
          {TEMAS.map((t) => (
            <button key={t.modo} type="button" role="menuitemradio" aria-checked={mode === t.modo} onClick={() => setMode(t.modo)} className={`menu-pop-item ${mode === t.modo ? "is-active" : ""}`}>
              <t.icone className="h-4 w-4" /> <span className="flex-1">{t.texto}</span>{mode === t.modo && <Check className="h-4 w-4" />}
            </button>
          ))}
          <button type="button" role="menuitemcheckbox" aria-checked={leve} onClick={aoAlternarLeve} className={`menu-pop-item ${leve ? "is-active" : ""}`} title="Reduz efeitos visuais para deixar o sistema mais rápido">
            <Zap className="h-4 w-4" /> <span className="flex-1">Modo leve</span>{leve && <Check className="h-4 w-4" />}
          </button>
          <div className="my-1 h-px bg-zinc-100 dark:bg-white/10" />
          <button type="button" role="menuitem" className="menu-pop-item text-red-600 dark:text-red-400" onClick={async () => { await api.post("/auth/logout"); window.location.replace("/login"); }}>
            <LogOut className="h-4 w-4" /> Sair
          </button>
        </>
      )}
    </MenuSuspenso>
  );
}
