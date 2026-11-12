import { useEffect, useRef, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { MessageSquarePlus, MessageSquareText, Save, Trash2 } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { TemplatesPericia } from "./TemplatesPericia";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { SettingsFooter } from "@/components/ui/Settings";
import { CarregandoModelos, GrupoModelos, ModeloCard, PreviaWhatsApp, VariaveisInseriveis, inserirNoCursor } from "@/components/templates/ModeloEditor";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/Toast";
import { cn } from "@/lib/utils";

const CATEGORIES = [
  { path: "/templates", key: "pericia", label: "Perícia" },
  { path: "/templates/audiencia", key: "audiencia", label: "Audiência" },
  { path: "/templates/remarcacao", key: "remarcacao", label: "Remarcação" },
  { path: "/templates/cobranca", key: "cobranca", label: "Cobrança" },
  { path: "/templates/lembretes", key: "lembrete", label: "Lembrete" },
];
const VARIABLES = ["NOME", "TIPO_PERICIA", "DATA", "HORARIO", "LOCAL", "TELEFONE", "WHATSAPP", "PROCESSO", "PROFISSIONAL_PERITO"];
const RESCHEDULE_VARIABLES = ["DATA_ANTERIOR", "HORARIO_ANTERIOR", "LOCAL_ANTERIOR", "NOVA_DATA", "NOVO_HORARIO", "NOVO_LOCAL"];
const EXAMPLE: Record<string, string> = {
  NOME: "Maria da Silva", TIPO_PERICIA: "Perícia médica", DATA: "14/10/2026", HORARIO: "10:00", LOCAL: "Rua das Flores, 100",
  TELEFONE: "(11) 99999-9999", WHATSAPP: "SIM", PROCESSO: "5001306-35.2026.4.03.6321", PROFISSIONAL_PERITO: "Dra. Ana Souza",
  DATA_ANTERIOR: "09/10/2026", HORARIO_ANTERIOR: "08:00", LOCAL_ANTERIOR: "Rua Central, 50",
  NOVA_DATA: "14/10/2026", NOVO_HORARIO: "10:00", NOVO_LOCAL: "Rua das Flores, 100",
  COMPROMISSOS: "• Perícia médica: 14/10/2026 às 10:00\n  Local: Rua das Flores, 100\n  Processo: 5001306-35.2026.4.03.6321",
};
interface Model { id: number; categoria: string; escopo: string; nome: string; mensagem: string; padrao: number }
interface Scope { label: string; content: string }
type Form = Omit<Model, "id">;

export function Templates() {
  const { pathname } = useLocation();
  const dirtyEditor = useRef(false);
  const category = CATEGORIES.find(c => c.path === pathname) || CATEGORIES[0];
  return <div className="space-y-6">
    <PageHeader title="Modelos de mensagens" description="Textos dos avisos de WhatsApp. Escolha a categoria, selecione um modelo e edite com a prévia ao lado." />
    <div className="surface-panel p-2">
      <nav aria-label="Categorias de mensagens" className="flex gap-1 overflow-x-auto">
        {CATEGORIES.map(c => <NavLink key={c.key} to={c.path} end onClick={event => { if (pathname !== c.path && dirtyEditor.current && !window.confirm("Descartar as alterações não salvas?")) event.preventDefault(); else if (pathname !== c.path) dirtyEditor.current = false; }} className={({ isActive }) => cn("shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-colors", isActive ? "bg-accent-50 text-accent-700 dark:bg-accent-900/30 dark:text-accent-300" : "text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800")}>{c.label}</NavLink>)}
      </nav>
    </div>
    {category.key === "pericia" ? <TemplatesPericia /> : <MessageTemplateEditor key={category.key} category={category.key} label={category.label} onDirty={value => { dirtyEditor.current = value; }} />}
  </div>;
}

function MessageTemplateEditor({ category, label, onDirty }: { category: string; label: string; onDirty: (value: boolean) => void }) {
  const { show } = useToast();
  const [models, setModels] = useState<Model[]>([]);
  const [scopes, setScopes] = useState<Record<string, Scope>>({});
  const [selected, setSelected] = useState<number | null>(null);
  const [form, setForm] = useState<Form>({ categoria: category, escopo: "", nome: "", mensagem: "", padrao: 0 });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState("");
  const [previewError, setPreviewError] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const dirty = useRef(false);
  const variables = [...VARIABLES, ...(category === "remarcacao" ? RESCHEDULE_VARIABLES : category === "lembrete" ? ["COMPROMISSOS"] : [])];

  function choose(model: Model) {
    setSelected(model.id);
    setForm({ categoria: model.categoria, escopo: model.escopo, nome: model.nome, mensagem: model.mensagem, padrao: model.padrao });
    dirty.current = false;
    onDirty(false);
  }
  function allowChange() { return !dirty.current || window.confirm("Descartar as alterações não salvas?"); }
  async function load(preferred?: number) {
    const data = await api.get<{ templates: Model[]; scopes: Record<string, Scope> }>(`/message-templates?categoria=${category}`);
    setModels(data.templates);
    setScopes(data.scopes);
    const model = data.templates.find(m => m.id === preferred) || data.templates[0];
    if (model) choose(model);
  }
  useEffect(() => {
    load().catch(error => show(error instanceof ApiError ? error.message : "Erro ao carregar modelos.", "error")).finally(() => setLoading(false));
  }, []);
  useEffect(() => {
    const listener = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", listener);
    return () => window.removeEventListener("beforeunload", listener);
  }, []);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      const vars = { ...EXAMPLE, ...(form.escopo === "audiencia" || category === "audiencia" ? { TIPO_PERICIA: "Audiência", LOCAL: form.escopo === "online" ? "https://exemplo.com/audiencia" : EXAMPLE.LOCAL } : form.escopo === "social" ? { TIPO_PERICIA: "Perícia social" } : {}) };
      api.post<{ mensagem: string }>("/message-templates/preview", { mensagem: form.mensagem, variables: vars }).then(result => {
        if (active) { setPreview(result.mensagem); setPreviewError(""); }
      }).catch(error => { if (active) { setPreview(""); setPreviewError(error instanceof ApiError ? error.message : "Não foi possível gerar a pré-visualização."); } });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [form.mensagem, form.escopo]);

  function edit(data: Partial<Form>) { dirty.current = true; onDirty(true); setForm(current => ({ ...current, ...data })); }
  function newModel() {
    if (!allowChange()) return;
    const scope = form.escopo || Object.keys(scopes)[0];
    setSelected(null);
    setForm({ categoria: category, escopo: scope, nome: "Novo modelo", mensagem: scopes[scope].content, padrao: 0 });
    dirty.current = false;
    onDirty(false);
  }
  function insert(variable: string) {
    const ref = textarea.current;
    const token = `{{${variable}}}`;
    const start = ref?.selectionStart ?? form.mensagem.length;
    const end = ref?.selectionEnd ?? start;
    edit({ mensagem: form.mensagem.slice(0, start) + token + form.mensagem.slice(end) });
    requestAnimationFrame(() => { ref?.focus(); ref?.setSelectionRange(start + token.length, start + token.length); });
  }
  async function save() {
    if (!form.nome.trim() || !form.mensagem.trim() || previewError) { show("Informe nome e mensagem válidos.", "error"); return; }
    setBusy(true);
    try {
      const model = selected ? await api.put<Model>(`/message-templates/${selected}`, form) : await api.post<Model>("/message-templates", form);
      await load(model.id);
      show("Modelo salvo.", "success");
    } catch (error) { show(error instanceof ApiError ? error.message : "Erro ao salvar modelo.", "error"); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!selected || !window.confirm(`Excluir o modelo “${form.nome}”?`)) return;
    setBusy(true);
    try { await api.delete(`/message-templates/${selected}`); await load(); show("Modelo excluído.", "success"); }
    catch (error) { show(error instanceof ApiError ? error.message : "Erro ao excluir modelo.", "error"); }
    finally { setBusy(false); }
  }

  const ehPadraoSalvo = models.find(m => m.id === selected)?.padrao === 1;
  const descricao = category === "remarcacao" ? "Mensagens enviadas quando uma perícia ou audiência é remarcada." : "Crie modelos e defina qual é o padrão de cada aplicação.";
  return <div className="space-y-5">
    <PageHeader compact title={`Mensagens de ${label}`} description={descricao} actions={<Button onClick={newModel} disabled={loading || busy || !Object.keys(scopes).length}><MessageSquarePlus className="h-4 w-4" /> Novo modelo</Button>} />
    {loading ? <CarregandoModelos /> : !models.length && selected === null && !form.nome ? <EmptyState icon={MessageSquareText} title="Nenhum modelo nesta categoria" description="Crie o primeiro modelo para definir o texto enviado." action={<Button onClick={newModel} disabled={!Object.keys(scopes).length}><MessageSquarePlus className="h-4 w-4" /> Novo modelo</Button>} /> : <div className="space-y-5">
      <div className="surface-panel space-y-4 p-4">
        {Object.entries(scopes).map(([scope, config]) => {
          const group = models.filter(m => m.escopo === scope);
          if (!group.length) return null;
          return <GrupoModelos key={scope} titulo={config.label}>{group.map(model => <ModeloCard key={model.id} nome={model.nome} trecho={model.mensagem} padrao={model.padrao === 1} selecionado={selected === model.id} disabled={busy} onClick={() => { if (allowChange()) choose(model); }} />)}</GrupoModelos>;
        })}
        {selected === null && <p className="rounded-lg border border-dashed border-accent-300 bg-accent-50/50 px-3 py-2 text-xs text-accent-700 dark:border-accent-700 dark:bg-accent-900/10 dark:text-accent-300">Novo modelo em edição (ainda não salvo).</p>}
      </div>
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <section className="surface-panel min-w-0 overflow-hidden">
          <div className="space-y-4 p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div><Label>Nome do modelo</Label><Input value={form.nome} disabled={busy} onChange={event => edit({ nome: event.target.value })} /></div>
              <div><Label>Aplicar para</Label><Select value={form.escopo} disabled={selected !== null || busy} onChange={event => edit({ escopo: event.target.value })}>{Object.entries(scopes).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</Select></div>
            </div>
            <label className="flex items-start gap-2.5 text-sm text-zinc-700 dark:text-zinc-200">
              <Checkbox checked={form.padrao === 1} disabled={busy || ehPadraoSalvo} onChange={event => edit({ padrao: event.target.checked ? 1 : 0 })} />
              <span>Usar como padrão para esta aplicação<span className="mt-0.5 block text-xs text-zinc-500 dark:text-zinc-400">{category === "remarcacao" ? "O padrão específico tem prioridade; o modelo de Todos vale quando não houver um específico." : "Para trocar o padrão, marque este modelo e salve."}</span></span>
            </label>
            <VariaveisInseriveis variaveis={variables} disabled={busy} onInsert={variable => inserirNoCursor(textarea, form.mensagem, variable, mensagem => edit({ mensagem }))} />
            <div><Label>Mensagem</Label><Textarea ref={textarea} rows={10} value={form.mensagem} disabled={busy} onChange={event => edit({ mensagem: event.target.value })} className="font-mono text-[13px]" /></div>
          </div>
          <SettingsFooter left={dirty.current ? "Alterações não salvas." : undefined}>
            <Button variant="outline" className="danger-action" disabled={!selected || busy} onClick={remove}><Trash2 className="h-4 w-4" /> Excluir</Button>
            <Button loading={busy} disabled={!form.escopo} onClick={save}><Save className="h-4 w-4" /> Salvar modelo</Button>
          </SettingsFooter>
        </section>
        <aside className="min-w-0 lg:sticky lg:top-24"><PreviaWhatsApp mensagens={[preview]} erro={previewError} /></aside>
      </div>
    </div>}
  </div>;
}
