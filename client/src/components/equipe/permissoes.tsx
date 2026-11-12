import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { Permission, Role } from "@/context/AuthContext";
import { Badge } from "@/components/ui/Badge";
import { Callout } from "@/components/ui/Settings";
import { Checkbox } from "@/components/ui/Checkbox";
import { cn } from "@/lib/utils";

export type AccessGroup = { title: string; items: [Permission, string][] };
export type Area = { title: string; description: string; groups: AccessGroup[] };

export const AREAS: Area[] = [
  { title: "Perícias e avisos", description: "Painel, agenda, comunicação com clientes e operação do WhatsApp.", groups: [
    { title: "Visão geral", items: [["dashboard.view", "Ver painel inicial"]] },
    { title: "Perícias e agenda", items: [["calendar.view", "Ver calendário"], ["calendar.manage", "Editar compromissos e sincronizar"], ["messages.send", "Enviar mensagens e lembretes"]] },
    { title: "Mensagens e retornos", items: [["templates.view", "Ver modelos"], ["templates.manage", "Editar modelos"], ["pending.view", "Ver respostas pendentes"], ["pending.manage", "Concluir e gerenciar esperas"], ["history.view", "Ver histórico"], ["history.manage", "Excluir registros de envio"]] },
    { title: "Clientes", items: [["contacts.view", "Ver contatos"], ["contacts.manage", "Editar contatos"]] },
    { title: "Operação", items: [["activity.view", "Ver atividade"], ["whatsapp.manage", "Conectar e desconectar WhatsApp"]] },
  ] },
  { title: "Processos e DJEN", description: "Publicações, classificação, quadros, busca e prazos processuais.", groups: [
    { title: "Publicações e quadros", items: [["processes.view", "Ver publicações e processos"], ["processes.manage", "Tratar publicações e quadros"]] },
    { title: "Busca DJEN", items: [["djen.manage", "Gerenciar busca DJEN e advogados"]] },
    { title: "Prazos e calendários", items: [["deadlines.view", "Ver prazos e calendários"], ["deadlines.manage", "Editar prazos e feriados"]] },
  ] },
  { title: "Gestão do escritório", description: "Cadastro de pessoas, processos, pastas e anotações.", groups: [
    { title: "Pessoas, processos, arquivos e tarefas", items: [["gestao.view", "Ver pessoas, processos, arquivos, tarefas e indicadores"], ["gestao.manage", "Cadastrar e editar pessoas, processos, arquivos, modelos e tarefas"]] },
    { title: "Financeiro (valores sensíveis)", items: [["financeiro.view", "Ver honorários, contas e fluxo de caixa"], ["financeiro.manage", "Lançar, baixar e estornar valores"]] },
  ] },
  { title: "Atendimento e vendas", description: "Chat de atendimento por WhatsApp com IA (quando o plano inclui).", groups: [
    { title: "Atendimento", items: [["atendimento.use", "Abrir o atendimento (precisa ter o mesmo e-mail cadastrado lá)"]] },
  ] },
  { title: "Administração do sistema", description: "Integrações, equipe e cópias de segurança.", groups: [
    { title: "Configurações e equipe", items: [["integrations.manage", "Configurar integrações"], ["team.manage", "Gerenciar equipe"], ["backup.manage", "Baixar e restaurar backup"]] },
  ] },
];

export const DEPENDENCIES: Partial<Record<Permission, Permission>> = {
  "calendar.manage": "calendar.view", "templates.manage": "templates.view", "pending.manage": "pending.view", "history.manage": "history.view", "contacts.manage": "contacts.view", "processes.manage": "processes.view", "gestao.manage": "gestao.view", "financeiro.manage": "financeiro.view", "djen.manage": "processes.manage", "deadlines.manage": "deadlines.view",
};
export const ADMIN_ONLY = new Set<Permission>(["team.manage", "backup.manage"]);

/** Pontos que o resumo em linguagem simples destaca. */
const DESTAQUES: [Permission, string][] = [
  ["contacts.view", "clientes"], ["processes.view", "processos e publicações"], ["calendar.view", "agenda"],
  ["gestao.view", "gestão do escritório"], ["financeiro.view", "financeiro"], ["integrations.manage", "integrações"],
];

export function resumoPermissoes(role: Role, permissions: Permission[]) {
  if (role === "administrador") return "Administrador: acesso completo a todas as áreas.";
  const pode = DESTAQUES.filter(([key]) => permissions.includes(key)).map(([, label]) => label);
  const nao = DESTAQUES.filter(([key]) => !permissions.includes(key)).map(([, label]) => label);
  const partes: string[] = [];
  if (pode.length) partes.push(`Pode ver ${pode.join(", ")}`);
  if (nao.length) partes.push(`não pode ver ${nao.join(", ")}`);
  const texto = partes.join("; ");
  return texto ? texto.charAt(0).toUpperCase() + texto.slice(1) + "." : "Sem nenhuma permissão marcada.";
}

type Props = {
  role: Role;
  permissions: Permission[];
  onToggle: (permission: Permission) => void;
  onToggleGroup: (items: [Permission, string][]) => void;
};

export function PermissionsEditor({ role, permissions, onToggle, onToggleGroup }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const admin = role === "administrador";
  const visible = (key: Permission) => admin || !ADMIN_ONLY.has(key);
  const count = (keys: Permission[]) => (admin ? keys.length : keys.filter((key) => permissions.includes(key)).length);
  const flip = (title: string) => setOpen((current) => { const next = new Set(current); if (next.has(title)) next.delete(title); else next.add(title); return next; });
  const allOpen = open.size === AREAS.length;

  return <div className="space-y-3">
    <Callout tone={admin ? "info" : "ok"}>{resumoPermissoes(role, permissions)}{admin && " As permissões do administrador não podem ser limitadas aqui."}</Callout>
    <div className="flex justify-end">
      <button type="button" className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-300" onClick={() => setOpen(allOpen ? new Set() : new Set(AREAS.map((area) => area.title)))}>{allOpen ? "Recolher todas as áreas" : "Expandir todas as áreas"}</button>
    </div>
    <div className="divide-y divide-zinc-100 rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {AREAS.map((area) => {
        const keys = area.groups.flatMap((group) => group.items.map(([key]) => key)).filter(visible);
        const selected = count(keys);
        const expanded = open.has(area.title);
        const panelId = `area-${area.title.replace(/\s+/g, "-")}`;
        return <section key={area.title}>
          <div className="flex items-center gap-3 px-4 py-3">
            <Checkbox checked={selected === keys.length} disabled={admin} onChange={() => onToggleGroup(area.groups.flatMap((group) => group.items))} aria-label={`Marcar tudo em ${area.title}`} />
            <button type="button" aria-expanded={expanded} aria-controls={panelId} onClick={() => flip(area.title)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-zinc-900 dark:text-zinc-100">{area.title}</span><span className="block text-xs text-zinc-500 dark:text-zinc-400">{area.description}</span></span>
              <Badge tone={selected === 0 ? "neutral" : selected === keys.length ? "success" : "accent"}>{selected} de {keys.length}</Badge>
              <ChevronDown className={cn("h-4 w-4 shrink-0 text-zinc-400 transition-transform", expanded && "rotate-180")} />
            </button>
          </div>
          {expanded && <div id={panelId} className="space-y-4 bg-zinc-50/60 px-4 py-4 dark:bg-zinc-800/20">
            {area.groups.map((group) => {
              const groupKeys = group.items.map(([key]) => key).filter(visible);
              const n = count(groupKeys);
              return <div key={group.title}>
                <div className="mb-2 flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <span>{group.title}</span>
                  <button type="button" disabled={admin || groupKeys.length === 0} onClick={() => onToggleGroup(group.items)} className="normal-case tracking-normal font-medium text-accent-600 hover:underline disabled:opacity-50 disabled:no-underline dark:text-accent-300">{n === groupKeys.length ? "Desmarcar" : "Marcar"} grupo ({n} de {groupKeys.length})</button>
                </div>
                <div className="space-y-2.5">{group.items.map(([permission, label]) => <label key={permission} className="flex cursor-pointer items-start gap-3 text-sm text-zinc-700 dark:text-zinc-300">
                  <Checkbox className="mt-0.5" checked={admin || permissions.includes(permission)} disabled={admin || ADMIN_ONLY.has(permission)} onChange={() => onToggle(permission)} />
                  <span>{label}{ADMIN_ONLY.has(permission) && !admin && <span className="ml-2 text-[11px] text-zinc-400">Apenas administrador</span>}</span>
                </label>)}</div>
              </div>;
            })}
          </div>}
        </section>;
      })}
    </div>
  </div>;
}
