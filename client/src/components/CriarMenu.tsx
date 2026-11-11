import { ChevronDown, FileText, ListChecks, PenLine, Plus, Scale, UserPlus, CalendarDays } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { MenuSuspenso } from "./MenuSuspenso";
import { useAuth } from "@/context/AuthContext";

/** O botão «+ Criar» do topo: atalhos para começar uma coisa nova sem procurar a tela antes. */
export function CriarMenu({ aoAnotar }: { aoAnotar: () => void }) {
  const { can } = useAuth();
  const ir = useNavigate();
  const itens = [
    can("gestao.manage") && { icone: PenLine, texto: "Anotação rápida", dica: "Alt+N", acao: aoAnotar },
    can("gestao.view") && { icone: UserPlus, texto: "Cliente", acao: () => ir("/gestao/clientes") },
    can("gestao.view") && { icone: Scale, texto: "Processo", acao: () => ir("/gestao/processos") },
    can("gestao.view") && { icone: ListChecks, texto: "Tarefa", acao: () => ir("/gestao/tarefas") },
    can("calendar.view") && { icone: CalendarDays, texto: "Compromisso no calendário", acao: () => ir("/calendario") },
    can("gestao.view") && { icone: FileText, texto: "Documentos do cliente", acao: () => ir("/gestao/clientes") },
  ].filter(Boolean) as Array<{ icone: typeof Plus; texto: string; dica?: string; acao: () => void }>;
  if (itens.length === 0) return null;
  return (
    <MenuSuspenso gatilho={({ aberto, alternar }) => (
      <button type="button" onClick={alternar} aria-haspopup="menu" aria-expanded={aberto} className="inline-flex h-10 items-center gap-2 rounded-xl bg-accent-600 px-4 text-sm font-semibold text-white shadow-sm transition-colors hover:bg-accent-700">
        <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Criar</span> <ChevronDown className="hidden h-3.5 w-3.5 sm:inline" />
      </button>
    )}>
      {(fechar) => (
        <>
          <p className="menu-pop-title">Criar novo</p>
          {itens.map((i) => (
            <button key={i.texto} type="button" role="menuitem" className="menu-pop-item" onClick={() => { fechar(); i.acao(); }}>
              <i.icone className="h-4 w-4 text-accent-600" /> <span className="flex-1">{i.texto}</span>{i.dica && <kbd className="text-[10px] text-zinc-400">{i.dica}</kbd>}
            </button>
          ))}
        </>
      )}
    </MenuSuspenso>
  );
}
