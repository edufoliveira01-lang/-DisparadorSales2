import { useEffect, useState } from "react";
import { ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { useAuth, type Permission, type Role, type TeamUser } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";

type Profiles = { roles: Record<Role, Permission[]>; permissions: Permission[] };
type Form = { id?: number; display_name: string; username: string; email: string; role: Role; active: boolean; permissions: Permission[]; password: string };
type Audit = { id: number; action: string; actor: string | null; target: string | null; details_json: string | null; created_at: string };
const ROLE_LABEL: Record<Role, string> = { administrador: "Administrador", gestor: "Gestor", advogado: "Advogado", atendimento: "Atendimento", consulta: "Consulta" };
type AccessGroup = { title: string; items: [Permission, string][] };
const AREAS: { title: string; description: string; groups: AccessGroup[] }[] = [
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
const DEPENDENCIES: Partial<Record<Permission, Permission>> = {
  "calendar.manage": "calendar.view", "templates.manage": "templates.view", "pending.manage": "pending.view", "history.manage": "history.view", "contacts.manage": "contacts.view", "processes.manage": "processes.view", "gestao.manage": "gestao.view", "financeiro.manage": "financeiro.view", "djen.manage": "processes.manage", "deadlines.manage": "deadlines.view",
};
const ADMIN_ONLY = new Set<Permission>(["team.manage", "backup.manage"]);
const empty = (permissions: Permission[]): Form => ({ display_name: "", username: "", email: "", role: "atendimento", active: true, permissions, password: "" });
const field = "mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200 dark:border-slate-700 dark:bg-slate-950 dark:text-white";

export function Team() {
  const { user } = useAuth();
  const { show } = useToast();
  const [people, setPeople] = useState<TeamUser[]>([]);
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [audit, setAudit] = useState<Audit[]>([]);
  const [saving, setSaving] = useState(false);
  const load = async () => {
    const [nextPeople, nextProfiles, nextAudit] = await Promise.all([
      api.get<TeamUser[]>("/team"), api.get<Profiles>("/team/profiles"), api.get<Audit[]>("/team/audit"),
    ]);
    setPeople(nextPeople); setProfiles(nextProfiles); setAudit(nextAudit);
  };
  useEffect(() => { void load().catch(() => show("Não foi possível carregar a equipe.", "error")); }, []);
  const select = (person: TeamUser) => setForm({ ...person, email: person.email || "", display_name: person.display_name || person.username, permissions: [...person.permissions], password: "" });
  const toggle = (permission: Permission) => setForm((current) => {
    if (!current || current.role === "administrador" || ADMIN_ONLY.has(permission)) return current;
    const next = new Set(current.permissions);
    if (next.has(permission)) {
      next.delete(permission);
      for (let i = 0; i < 3; i++) for (const [child, parent] of Object.entries(DEPENDENCIES)) if (!next.has(parent)) next.delete(child as Permission);
    } else {
      next.add(permission);
      let parent = DEPENDENCIES[permission];
      while (parent) { next.add(parent); parent = DEPENDENCIES[parent]; }
    }
    return { ...current, permissions: [...next] };
  });
  const toggleGroup = (items: [Permission, string][]) => setForm((current) => {
    if (!current || current.role === "administrador") return current;
    const keys = items.map(([key]) => key).filter((key) => !ADMIN_ONLY.has(key));
    const next = new Set(current.permissions);
    if (keys.every((key) => next.has(key))) {
      for (const key of keys) next.delete(key);
      for (let i = 0; i < 3; i++) for (const [child, parent] of Object.entries(DEPENDENCIES)) if (!next.has(parent as Permission)) next.delete(child as Permission);
    } else {
      for (const key of keys) { next.add(key); let parent = DEPENDENCIES[key]; while (parent) { next.add(parent); parent = DEPENDENCIES[parent]; } }
    }
    return { ...current, permissions: [...next] };
  });
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); if (!form) return;
    setSaving(true);
    try {
      const payload = { display_name: form.display_name, username: form.username, email: form.email, role: form.role, active: form.active, permissions: form.permissions, ...(!form.id ? { password: form.password } : {}) };
      const saved = form.id ? await api.put<TeamUser>(`/team/${form.id}`, payload) : await api.post<TeamUser>("/team", payload);
      await load(); select(saved); show(form.id ? "Acesso atualizado." : "Pessoa cadastrada.", "success");
    } catch (error) { show(error instanceof ApiError ? error.message : "Não foi possível salvar.", "error"); }
    finally { setSaving(false); }
  };
  const resetPassword = async () => {
    if (!form?.id || form.password.length < 12) { show("Informe uma senha de pelo menos 12 caracteres.", "error"); return; }
    setSaving(true);
    try {
      await api.put(`/team/${form.id}/password`, { password: form.password });
      setForm({ ...form, password: "" }); await load(); show("Senha redefinida. As sessões anteriores foram encerradas.", "success");
      if (form.id === user.id) window.location.replace("/login");
    } catch (error) { show(error instanceof ApiError ? error.message : "Falha ao redefinir senha.", "error"); }
    finally { setSaving(false); }
  };

  return <div className="mx-auto max-w-[1400px] space-y-7">
    <header><p className="text-xs font-semibold uppercase tracking-widest text-violet-600">Administração</p><h1 className="mt-2 text-3xl font-semibold text-slate-900 dark:text-white">Equipe e acessos</h1><p className="mt-2 text-sm text-slate-500">Cada pessoa vê apenas as áreas autorizadas. Mudanças de perfil encerram as sessões anteriores.</p></header>
    <div className="grid gap-5 lg:grid-cols-[minmax(230px,300px)_minmax(0,1fr)]">
      <aside className="h-fit rounded-3xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4 flex items-center justify-between"><h2 className="flex items-center gap-2 font-semibold"><UsersRound className="h-5 w-5 text-violet-600" /> Pessoas</h2><button type="button" className="rounded-xl bg-violet-600 p-2 text-white" aria-label="Adicionar pessoa" title="Adicionar pessoa" onClick={() => profiles && setForm(empty([...profiles.roles.atendimento]))}><UserPlus className="h-4 w-4" /></button></div>
        <div className="space-y-1">{people.map((person) => <button type="button" key={person.id} onClick={() => select(person)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${form?.id === person.id ? "bg-violet-50 dark:bg-violet-950/40" : "hover:bg-slate-50 dark:hover:bg-slate-800"}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-xs font-semibold text-violet-700">{(person.display_name || person.username).slice(0, 2).toUpperCase()}</span><span className="min-w-0 flex-1"><strong className="block truncate text-sm">{person.display_name || person.username}</strong><span className="text-xs text-slate-500">{ROLE_LABEL[person.role]} · {person.active ? "Ativo" : "Desativado"}</span></span></button>)}</div>
      </aside>
      {form ? <form onSubmit={save} className="space-y-6 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-7">
        <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-violet-600" /><h2 className="text-lg font-semibold">{form.id ? "Editar acesso" : "Nova pessoa"}</h2></div>
        <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm font-medium">Nome da pessoa<input className={field} value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} required /></label><label className="text-sm font-medium">Usuário para login<input className={field} value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required /></label><label className="text-sm font-medium">E-mail individual de recuperação<input type="email" className={field} value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label><label className="text-sm font-medium">Perfil<select className={field} value={form.role} onChange={(event) => { const role = event.target.value as Role; setForm({ ...form, role, permissions: [...(profiles?.roles[role] || [])] }); }}>{Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
        <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={form.active} disabled={form.id === user.id} onChange={(event) => setForm({ ...form, active: event.target.checked })} className="h-4 w-4 accent-violet-600" />Acesso ativo</label>
        <div className="space-y-5"><h3 className="font-semibold">Permissões</h3>{AREAS.map((area) => {
          const keys = area.groups.flatMap((group) => group.items.map(([key]) => key)).filter((key) => form.role === "administrador" || !ADMIN_ONLY.has(key));
          const selected = form.role === "administrador" ? keys.length : keys.filter((key) => form.permissions.includes(key)).length;
          return <section key={area.title} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/30 sm:p-5">
            <div className="mb-4 flex items-start justify-between gap-3"><label className="flex cursor-pointer items-start gap-3"><input type="checkbox" className="mt-1 h-4 w-4 accent-violet-600" checked={selected === keys.length} ref={(input) => { if (input) input.indeterminate = selected > 0 && selected < keys.length; }} disabled={form.role === "administrador"} onChange={() => toggleGroup(area.groups.flatMap((group) => group.items))} aria-label={`Selecionar todas as permissões de ${area.title}`} /><span><strong className="text-base">{area.title}</strong><span className="mt-1 block text-xs text-slate-500">{area.description}</span></span></label><span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs text-violet-700 dark:bg-slate-900 dark:text-violet-300">{selected}/{keys.length}</span></div>
            <div className="grid gap-3 md:grid-cols-2">{area.groups.map((group) => {
              const groupKeys = group.items.map(([key]) => key).filter((key) => form.role === "administrador" || !ADMIN_ONLY.has(key));
              const count = form.role === "administrador" ? groupKeys.length : groupKeys.filter((key) => form.permissions.includes(key)).length;
              return <div key={group.title} className="rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
                <label className="mb-3 flex cursor-pointer items-center gap-2 border-b border-slate-100 pb-3 text-sm font-semibold dark:border-slate-800"><input type="checkbox" className="h-4 w-4 accent-violet-600" checked={count === groupKeys.length} ref={(input) => { if (input) input.indeterminate = count > 0 && count < groupKeys.length; }} disabled={form.role === "administrador"} onChange={() => toggleGroup(group.items)} aria-label={`Selecionar todas as permissões de ${group.title}`} />{group.title}<span className="ml-auto text-xs font-normal text-slate-500">{count}/{groupKeys.length}</span></label>
                <div className="space-y-3">{group.items.map(([permission, label]) => <label key={permission} className="flex cursor-pointer items-start gap-3 text-sm text-slate-600 dark:text-slate-300"><input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0 accent-violet-600" checked={form.role === "administrador" || form.permissions.includes(permission)} disabled={form.role === "administrador" || ADMIN_ONLY.has(permission)} onChange={() => toggle(permission)} />{label}{ADMIN_ONLY.has(permission) && form.role !== "administrador" && <span className="text-[10px] text-slate-400">Apenas administrador</span>}</label>)}</div>
              </div>;
            })}</div>
          </section>;
        })}{form.role === "administrador" && <p className="text-xs text-slate-500">O administrador tem acesso completo e suas permissões não podem ser limitadas aqui.</p>}</div>
        <label className="block text-sm font-medium">{form.id ? "Redefinir senha desta pessoa" : "Senha inicial"}<input type="password" minLength={12} className={field} value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required={!form.id} autoComplete="new-password" placeholder="Pelo menos 12 caracteres" /></label>
        <div className="flex flex-wrap justify-end gap-3">{form.id && <button type="button" disabled={saving || !form.password} onClick={resetPassword} className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm disabled:opacity-40 dark:border-slate-700">Redefinir senha</button>}<button type="submit" disabled={saving} className="rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Salvando…" : "Salvar acesso"}</button></div>
      </form> : <div className="flex min-h-80 flex-col items-center justify-center rounded-3xl border border-dashed border-slate-300 p-8 text-center dark:border-slate-700"><UsersRound className="mb-3 h-9 w-9 text-violet-500" /><p className="font-semibold">Selecione uma pessoa ou crie um acesso</p><p className="mt-2 text-sm text-slate-500">O perfil define um ponto de partida; depois ajuste cada permissão.</p></div>}
    </div>
    <section className="rounded-3xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900 sm:p-7"><h2 className="font-semibold">Alterações recentes</h2><p className="mt-1 text-sm text-slate-500">Quem alterou acessos ou realizou operações no sistema.</p><div className="mt-4 max-h-72 divide-y divide-slate-100 overflow-auto dark:divide-slate-800">{audit.slice(0, 30).map((item) => <div key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span><strong>{item.actor || "Sistema"}</strong> · {item.action.replaceAll("_", " ")}{item.target ? ` · ${item.target}` : ""}</span><time className="text-xs text-slate-500">{new Date(item.created_at.replace(" ", "T") + "Z").toLocaleString("pt-BR")}</time></div>)}</div></section>
  </div>;
}
