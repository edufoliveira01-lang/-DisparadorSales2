import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, History, KeyRound, Search, ShieldCheck, UserPlus, UsersRound } from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Callout, SettingRow, SettingsBlock, SettingsPanel } from "@/components/ui/Settings";
import { useAuth, type Permission, type Role, type TeamUser } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/Toast";
import { ADMIN_ONLY, DEPENDENCIES, PermissionsEditor } from "@/components/equipe/permissoes";
import { cn } from "@/lib/utils";

type Profiles = { roles: Record<Role, Permission[]>; permissions: Permission[] };
type Form = { id?: number; display_name: string; username: string; email: string; role: Role; active: boolean; permissions: Permission[]; password: string };
type Audit = { id: number; action: string; actor: string | null; target: string | null; details_json: string | null; created_at: string };
const ROLE_LABEL: Record<Role, string> = { administrador: "Administrador", gestor: "Gestor", advogado: "Advogado", atendimento: "Atendimento", consulta: "Consulta" };
const ROLE_HELP: Record<Role, string> = {
  administrador: "Acesso completo, inclusive equipe, integrações e backup.",
  gestor: "Acesso amplo ao dia a dia e ao financeiro; sem equipe, integrações e backup.",
  advogado: "Processos, prazos e gestão do escritório; sem mensagens e financeiro.",
  atendimento: "Agenda, mensagens, contatos e atendimento ao cliente.",
  consulta: "Somente leitura nas áreas básicas, sem editar nada.",
};
const empty = (permissions: Permission[]): Form => ({ display_name: "", username: "", email: "", role: "atendimento", active: true, permissions, password: "" });
const nomeDe = (person: TeamUser) => person.display_name || person.username;
const sortKey = (form: Form) => JSON.stringify({ ...form, permissions: [...form.permissions].sort() });

export function Team() {
  const { user } = useAuth();
  const { show } = useToast();
  const [people, setPeople] = useState<TeamUser[]>([]);
  const [profiles, setProfiles] = useState<Profiles | null>(null);
  const [form, setForm] = useState<Form | null>(null);
  const [base, setBase] = useState("");
  const [audit, setAudit] = useState<Audit[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<"pessoas" | "auditoria">("pessoas");
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [leaveTo, setLeaveTo] = useState<(() => void) | null>(null);
  const load = async () => {
    const [nextPeople, nextProfiles, nextAudit] = await Promise.all([
      api.get<TeamUser[]>("/team"), api.get<Profiles>("/team/profiles"), api.get<Audit[]>("/team/audit"),
    ]);
    setPeople(nextPeople); setProfiles(nextProfiles); setAudit(nextAudit);
  };
  useEffect(() => { void load().catch(() => show("Não foi possível carregar a equipe.", "error")).finally(() => setLoading(false)); }, []);
  const dirty = form !== null && sortKey(form) !== base;
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const open = (next: Form) => { setForm(next); setBase(sortKey(next)); };
  const select = (person: TeamUser) => open({ ...person, email: person.email || "", display_name: person.display_name || person.username, permissions: [...person.permissions], password: "" });
  const guard = (action: () => void) => { if (dirty) setLeaveTo(() => action); else action(); };
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
      setForm({ ...form, password: "" }); setBase(sortKey({ ...form, password: "" })); await load(); show("Senha redefinida. As sessões anteriores foram encerradas.", "success");
      if (form.id === user.id) window.location.replace("/login");
    } catch (error) { show(error instanceof ApiError ? error.message : "Falha ao redefinir senha.", "error"); }
    finally { setSaving(false); }
  };

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return people.filter((person) => (!term || `${nomeDe(person)} ${person.username} ${person.email || ""}`.toLowerCase().includes(term))
      && (!roleFilter || person.role === roleFilter)
      && (!statusFilter || (statusFilter === "ativo") === person.active));
  }, [people, search, roleFilter, statusFilter]);
  const filtering = Boolean(search || roleFilter || statusFilter);

  if (form) return <div className="space-y-5">
    <PageHeader title="Equipe e acessos" description="Cada pessoa vê apenas as áreas autorizadas. Mudanças de perfil encerram as sessões anteriores." />
    <form onSubmit={save} className="space-y-5">
      <button type="button" onClick={() => guard(() => setForm(null))} className="inline-flex items-center gap-1.5 text-sm font-medium text-zinc-600 hover:text-accent-600 dark:text-zinc-300"><ArrowLeft className="h-4 w-4" /> Voltar para as pessoas</button>
      <SettingsPanel icon={<ShieldCheck />} title={form.id ? `Editar acesso: ${form.display_name || form.username}` : "Nova pessoa"} description={form.id ? "Altere os dados, o perfil e as permissões desta pessoa." : "Preencha os dados e escolha o perfil; depois ajuste as permissões se precisar."} status={<Badge tone={form.active ? "success" : "neutral"}>{form.active ? "Ativo" : "Inativo"}</Badge>}>
        <SettingsBlock title="1. Identificação" description="Como a pessoa aparece no sistema e entra nele.">
          <SettingRow label="Nome da pessoa" htmlFor="eq-nome"><Input id="eq-nome" value={form.display_name} onChange={(event) => setForm({ ...form, display_name: event.target.value })} required /></SettingRow>
          <SettingRow label="Usuário para login" htmlFor="eq-usuario"><Input id="eq-usuario" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} required autoComplete="off" /></SettingRow>
          <SettingRow label="E-mail individual" hint="Usado na recuperação de senha." htmlFor="eq-email"><Input id="eq-email" type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></SettingRow>
        </SettingsBlock>
        <SettingsBlock title="2. Perfil" description="O perfil define um ponto de partida; depois você ajusta cada permissão.">
          <div role="radiogroup" aria-label="Perfil" className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {(Object.keys(ROLE_LABEL) as Role[]).map((role) => <label key={role} className={cn("flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition-colors", form.role === role ? "border-accent-500 bg-accent-50 dark:bg-accent-900/20" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/50")}>
              <input type="radio" name="perfil" className="mt-1 h-4 w-4 accent-accent-600" checked={form.role === role} onChange={() => setForm({ ...form, role, permissions: [...(profiles?.roles[role] || [])] })} />
              <span><strong className="block text-sm text-zinc-900 dark:text-zinc-100">{ROLE_LABEL[role]}</strong><span className="block text-xs text-zinc-500 dark:text-zinc-400">{ROLE_HELP[role]}</span></span>
            </label>)}
          </div>
          {form.id && form.role !== (people.find((p) => p.id === form.id)?.role) && <Callout tone="aviso">Ao salvar a mudança de perfil, as sessões anteriores desta pessoa serão encerradas e as permissões voltam ao padrão do novo perfil.</Callout>}
        </SettingsBlock>
        <SettingsBlock title="3. Permissões" description="Abra cada área para ver e ajustar o que a pessoa pode fazer.">
          <PermissionsEditor role={form.role} permissions={form.permissions} onToggle={toggle} onToggleGroup={toggleGroup} />
        </SettingsBlock>
        <SettingsBlock title="4. Senha" description={form.id ? "Deixe em branco para manter a senha atual." : "A pessoa entra com esta senha."}>
          <SettingRow label={form.id ? "Redefinir senha desta pessoa" : "Senha inicial"} hint="Pelo menos 12 caracteres." htmlFor="eq-senha">
            <div className="flex flex-wrap gap-2">
              <Input id="eq-senha" type="password" minLength={12} className="min-w-0 flex-1 sm:max-w-sm" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} required={!form.id} autoComplete="new-password" placeholder="Pelo menos 12 caracteres" />
              {form.id && <Button type="button" variant="outline" disabled={saving || !form.password} onClick={resetPassword}><KeyRound className="h-4 w-4" /> Redefinir senha</Button>}
            </div>
            {form.id && <p className="text-xs text-zinc-500 dark:text-zinc-400">Redefinir encerra as sessões anteriores desta pessoa.</p>}
          </SettingRow>
        </SettingsBlock>
        <SettingsBlock title="5. Situação">
          <label className="flex cursor-pointer items-start gap-3 text-sm text-zinc-800 dark:text-zinc-200">
            <Checkbox className="mt-0.5" checked={form.active} disabled={form.id === user.id} onChange={(event) => setForm({ ...form, active: event.target.checked })} />
            <span><strong className="block font-medium">Acesso ativo</strong><span className="block text-xs text-zinc-500 dark:text-zinc-400">{form.id === user.id ? "Você não pode desativar o seu próprio acesso." : "Pessoas inativas não conseguem entrar no sistema."}</span></span>
          </label>
        </SettingsBlock>
      </SettingsPanel>
      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-zinc-200 bg-white/95 px-4 py-3 shadow-float backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/95">
        <span className={cn("text-xs", dirty ? "font-medium text-amber-700 dark:text-amber-300" : "text-zinc-500 dark:text-zinc-400")} role="status">{dirty ? "Há alterações não salvas." : "Nenhuma alteração pendente."}</span>
        <div className="flex gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={() => guard(() => setForm(null))}>{dirty ? "Descartar" : "Fechar"}</Button>
          <Button type="submit" loading={saving} disabled={Boolean(form.id) && !dirty}>{saving ? "Salvando…" : "Salvar acesso"}</Button>
        </div>
      </div>
    </form>
    <ConfirmDialog open={leaveTo !== null} title="Descartar alterações?" message="Há alterações não salvas nesta pessoa. Se sair agora, elas serão perdidas." confirmLabel="Descartar e sair" onCancel={() => setLeaveTo(null)} onConfirm={() => { const action = leaveTo; setLeaveTo(null); action?.(); }} />
  </div>;

  return <div className="space-y-5">
    <PageHeader title="Equipe e acessos" description="Cada pessoa vê apenas as áreas autorizadas. Mudanças de perfil encerram as sessões anteriores." actions={<Button onClick={() => profiles && open(empty([...profiles.roles.atendimento]))} disabled={!profiles}><UserPlus className="h-4 w-4" /> Adicionar pessoa</Button>} />
    <div className="flex gap-1 border-b border-zinc-200 dark:border-zinc-800" role="tablist">
      {([["pessoas", "Pessoas", UsersRound], ["auditoria", "Alterações recentes", History]] as const).map(([id, label, Icon]) => <button key={id} type="button" role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium", tab === id ? "border-accent-500 text-accent-700 dark:text-accent-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200")}><Icon className="h-4 w-4" />{label}</button>)}
    </div>
    {tab === "pessoas" ? <SettingsPanel icon={<UsersRound />} title="Pessoas com acesso" description={`${people.length} ${people.length === 1 ? "pessoa cadastrada" : "pessoas cadastradas"}.`}>
      <div className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_11rem_11rem]">
        <div className="relative"><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, usuário ou e-mail" aria-label="Buscar pessoas" /></div>
        <Select value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)} aria-label="Filtrar por perfil"><option value="">Todos os perfis</option>{Object.entries(ROLE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</Select>
        <Select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por situação"><option value="">Qualquer situação</option><option value="ativo">Ativo</option><option value="inativo">Inativo</option></Select>
      </div>
      {loading ? <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        : filtered.length === 0 ? <div className="p-5"><EmptyState icon={UsersRound} title={filtering ? "Nenhuma pessoa encontrada" : "Nenhuma pessoa cadastrada"} description={filtering ? "Ajuste a busca ou os filtros." : "Adicione a primeira pessoa para liberar o acesso."} action={filtering ? <Button variant="outline" onClick={() => { setSearch(""); setRoleFilter(""); setStatusFilter(""); }}>Limpar filtros</Button> : undefined} /></div>
        : <ul>
          <li className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1fr)_9rem_6rem] gap-4 bg-zinc-50/70 px-5 py-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:bg-zinc-800/30 dark:text-zinc-400 md:grid"><span>Pessoa</span><span>Usuário</span><span>Perfil</span><span>Situação</span></li>
          {filtered.map((person) => <li key={person.id} className="border-t border-zinc-100 dark:border-zinc-800">
            <button type="button" onClick={() => select(person)} className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 px-5 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/50 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_9rem_6rem] md:gap-4">
              <span className="flex min-w-0 items-center gap-3 md:col-span-1">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent-100 text-xs font-semibold text-accent-700 dark:bg-accent-900/40 dark:text-accent-300">{nomeDe(person).slice(0, 2).toUpperCase()}</span>
                <span className="min-w-0"><strong className="block truncate text-sm text-zinc-900 dark:text-zinc-100">{nomeDe(person)}{person.id === user.id && <span className="ml-2 text-[11px] font-normal text-zinc-400">você</span>}</strong><span className="block truncate text-xs text-zinc-500 md:hidden">{person.username} · {ROLE_LABEL[person.role]}</span></span>
              </span>
              <span className="hidden truncate text-sm text-zinc-600 dark:text-zinc-300 md:block">{person.username}</span>
              <span className="hidden text-sm text-zinc-600 dark:text-zinc-300 md:block">{ROLE_LABEL[person.role]}</span>
              <span className="col-start-3 md:col-start-auto"><Badge tone={person.active ? "success" : "neutral"}>{person.active ? "Ativo" : "Inativo"}</Badge></span>
            </button>
          </li>)}
        </ul>}
    </SettingsPanel> : <SettingsPanel icon={<History />} title="Alterações recentes" description="Quem alterou acessos ou realizou operações no sistema (últimas 30).">
      {audit.length === 0 ? <div className="p-5"><EmptyState icon={History} title="Nenhuma alteração registrada" /></div>
        : <ul className="max-h-[32rem] divide-y divide-zinc-100 overflow-auto dark:divide-zinc-800">{audit.slice(0, 30).map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 px-5 py-3 text-sm"><span><strong>{item.actor || "Sistema"}</strong> · {item.action.replaceAll("_", " ")}{item.target ? ` · ${item.target}` : ""}</span><time className="text-xs text-zinc-500">{new Date(item.created_at.replace(" ", "T") + "Z").toLocaleString("pt-BR")}</time></li>)}</ul>}
    </SettingsPanel>}
  </div>;
}
