import { useCallback, useEffect, useRef, useState } from "react";
import { BrainCircuit, ExternalLink, KeyRound, RefreshCw, Unplug } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input, Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useToast } from "@/components/ui/Toast";

type Provider = "codex" | "openai" | "anthropic";
type Mode = "economico" | "equilibrado" | "precisao";
type Models = Record<Mode, string>;
interface Configuration { provider: Provider; models: Record<Provider, Models>; revision: number; credentials: Record<"openai" | "anthropic", boolean>; chatgpt_login_available: boolean; chatgpt_login_message: string }
interface Login { state: "idle" | "busy" | "starting" | "waiting" | "completed" | "cancelled" | "failed"; id?: string; user_code?: string; verification_url?: string; expires_at?: string; message?: string }
interface ChatStatus { connection: { conectado: boolean; mensagem: string }; login: Login }
const NAMES: Record<Provider, string> = { codex: "OpenAI · conta ChatGPT", openai: "OpenAI · API", anthropic: "Anthropic · Claude API" };
const MODE_NAMES: Record<Mode, string> = { economico: "Econômico", equilibrado: "Equilibrado", precisao: "Máxima precisão" };
const MODES: Mode[] = ["economico", "equilibrado", "precisao"];
const message = (error: unknown) => error instanceof ApiError ? error.message : "Não foi possível concluir a operação da IA.";

export function AISettings() {
  const { show } = useToast();
  const [config, setConfig] = useState<Configuration | null>(null);
  const [provider, setProvider] = useState<Provider>("codex");
  const [models, setModels] = useState<Models>({ economico: "", equilibrado: "", precisao: "" });
  const [key, setKey] = useState("");
  const [catalog, setCatalog] = useState<{ id: string; name: string }[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogError, setCatalogError] = useState("");
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogRefresh, setCatalogRefresh] = useState(0);
  const [manualModels, setManualModels] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState("");
  const [chat, setChat] = useState<ChatStatus | null>(null);
  const [testMode, setTestMode] = useState<Mode>("economico");
  const [confirm, setConfirm] = useState<"key" | "chat" | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    void api.get<Configuration>("/ai/config").then((data) => {
      if (!active) return; setConfig(data); setProvider(data.provider); setModels(data.models[data.provider]);
    }).catch((e) => { if (active) setError(message(e)); });
    return () => { active = false; };
  }, []);
  const refreshChat = useCallback(async () => {
    try { const data = await api.get<ChatStatus>("/ai/chatgpt/status", { background: true }); if (mounted.current) setChat(data); }
    catch (e) { if (mounted.current) setError(message(e)); }
  }, []);
  useEffect(() => { if (provider === "codex") void refreshChat(); }, [provider, refreshChat]);
  const authorizing = Boolean(chat && ["starting", "waiting", "busy"].includes(chat.login.state));
  const canLoadModels = Boolean(config && !authorizing && (provider === "codex"
    ? config.chatgpt_login_available && chat?.connection.conectado
    : key.trim() || config.credentials[provider]));
  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    setCatalog([]); setCatalogError(""); setCatalogLoaded(false);
    setCatalogLoading(canLoadModels);
    if (!canLoadModels) return;
    // Aguarda a digitação da chave e descarta respostas da conexão anterior.
    const timer = setTimeout(() => {
      void api.post<{ models: { id: string; name: string }[] }>("/ai/models", { provider, api_key: key.trim() || undefined }, { signal: controller.signal, background: true }).then((data) => {
        if (!active) return;
        setCatalog(data.models); setCatalogLoaded(true);
      }).catch((e) => { if (active) setCatalogError(message(e)); })
        .finally(() => { if (active) setCatalogLoading(false); });
    }, key.trim() ? 800 : 0);
    return () => { active = false; clearTimeout(timer); controller.abort(); };
  }, [provider, key, canLoadModels, config?.revision, catalogRefresh]);
  useEffect(() => {
    if (!authorizing) return;
    let running = false;
    const timer = setInterval(() => { if (!running) { running = true; void refreshChat().finally(() => { running = false; }); } }, 2000);
    return () => clearInterval(timer);
  }, [authorizing, refreshChat]);
  async function action(fn: () => Promise<void>) {
    if (busy) return; setBusy(true); setError(""); setResult("");
    try { await fn(); } catch (e) { if (mounted.current) setError(message(e)); }
    finally { if (mounted.current) setBusy(false); }
  }
  function choose(value: Provider) { if (!config) return; setProvider(value); setModels({ ...config.models[value] }); setKey(""); setCatalog([]); setManualModels(false); setResult(""); setError(""); }
  function modelOptions(current: string) {
    return <><option value="">Selecione um modelo</option>
      {current && !catalog.some((m) => m.id === current) && <option value={current}>{current} (configurado; confirme a disponibilidade)</option>}
      {catalog.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
    </>;
  }
  const changed = Boolean(config && (provider !== config.provider || JSON.stringify(models) !== JSON.stringify(config.models[provider]) || key));
  return <section className="surface-panel space-y-5 p-5 sm:p-6" aria-label="Inteligência artificial">
    <div className="flex items-start gap-3"><span className="rounded-xl bg-violet-100 p-3 text-violet-700 dark:bg-violet-950 dark:text-violet-300"><BrainCircuit className="h-5 w-5" /></span><div>
      <h2 className="text-lg font-semibold">Inteligência artificial</h2>
      <p className="mt-1 text-sm text-zinc-500">Escolha quem analisa suas publicações. As revisões, os exemplos e o histórico continuam no sistema.</p>
    </div></div>
    {!config && !error && <p role="status" className="text-sm text-zinc-500">Carregando configuração da IA…</p>}
    {busy && <p role="status" className="text-sm text-violet-700 dark:text-violet-300">Processando a solicitação da IA…</p>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">{error}</p>}
    {config && <>
      <div className="rounded-xl border border-violet-100 bg-violet-50/60 p-3 text-sm dark:border-violet-900 dark:bg-violet-950/30"><span className="text-zinc-500">Em uso: </span><strong>{NAMES[config.provider]}</strong>{changed && <span className="ml-2 text-xs text-amber-700 dark:text-amber-300">Alterações não salvas</span>}</div>
      <div><Label htmlFor="ai-provider">Provedor de IA</Label><Select id="ai-provider" value={provider} disabled={busy} onChange={(e) => choose(e.target.value as Provider)}>
        {Object.entries(NAMES).map(([id, name]) => <option key={id} value={id} disabled={id === "codex" && !config.chatgpt_login_available}>{name}</option>)}
      </Select></div>
      {provider !== "codex" ? <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" /> Credencial da API</h3><span className="text-xs text-zinc-500">{config.credentials[provider] ? "Chave cadastrada" : "Chave ainda não cadastrada"}</span></div>
        <Label htmlFor="ai-key">{config.credentials[provider] ? "Nova chave de API (opcional)" : "Chave de API"}</Label>
        <Input id="ai-key" type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} value={key} disabled={busy} onChange={(e) => { setKey(e.target.value); setResult(""); }} placeholder={config.credentials[provider] ? "Deixe vazio para manter a chave cadastrada" : "Cole a chave fornecida pelo provedor"} />
        <p className="text-xs text-zinc-500">A chave é criptografada no servidor. O uso da API segue a cobrança e os limites da sua conta no provedor.</p>
        {config.credentials[provider] && <Button variant="ghost" size="sm" disabled={busy || authorizing} onClick={() => setConfirm("key")}>Remover chave cadastrada</Button>}
      </div> : <div className="space-y-3 rounded-2xl border border-zinc-200 p-4 dark:border-zinc-700">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Conta ChatGPT</h3><span className="text-xs text-zinc-500">{chat?.connection.conectado ? "Conta conectada" : "Conta não conectada"}</span></div>
        <p className="text-xs leading-relaxed text-zinc-500">{config.chatgpt_login_message} A autorização é concluída na página oficial da OpenAI, sem senha neste painel e sem acesso por SSH.</p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || authorizing || !config.chatgpt_login_available} onClick={() => void action(async () => { const login = await api.post<Login>("/ai/chatgpt/login", {}); setChat((c) => ({ connection: c?.connection || { conectado: false, mensagem: "" }, login })); })}>Conectar conta ChatGPT</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void action(refreshChat)}><RefreshCw className="h-4 w-4" /> Verificar conta</Button>
          {chat?.connection.conectado && <Button size="sm" variant="ghost" disabled={busy || authorizing} onClick={() => setConfirm("chat")}><Unplug className="h-4 w-4" /> Desconectar</Button>}
        </div>
        {chat?.login.state === "waiting" && <div role="status" className="space-y-3 rounded-xl bg-violet-50 p-4 dark:bg-violet-950/40">
          <p className="text-sm">Abra a página oficial e informe este código:</p><code className="block break-all text-xl font-semibold tracking-wider">{chat.login.user_code}</code>
          <div className="flex flex-wrap items-center gap-3"><a className="inline-flex items-center gap-1 text-sm font-medium text-violet-700 underline dark:text-violet-300" href={chat.login.verification_url} target="_blank" rel="noopener noreferrer">Autorizar na OpenAI <ExternalLink className="h-4 w-4" /></a>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(async () => { await api.post("/ai/chatgpt/cancel", { id: chat.login.id }); await refreshChat(); })}>Cancelar autorização</Button></div>
          <p className="text-xs text-zinc-500">O painel confirma a conexão automaticamente. O código deixa de ser exibido ao concluir, cancelar ou expirar.</p>
        </div>}
        {chat?.login.message && <p role="status" className="text-xs text-zinc-500">{chat.login.message}</p>}
      </div>}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold">Modelo</h3><Button size="sm" variant="outline" disabled={busy || catalogLoading || !canLoadModels} onClick={() => setCatalogRefresh((n) => n + 1)}><RefreshCw className={`h-4 w-4${catalogLoading ? " animate-spin" : ""}`} /> Atualizar modelos</Button></div>
        {catalogLoading && <p role="status" className="text-xs text-violet-700 dark:text-violet-300">Buscando os modelos disponíveis na sua conta…</p>}
        {!canLoadModels && <p role="status" className="text-xs text-zinc-500">{authorizing ? "Conclua a autorização para carregar os modelos automaticamente." : provider === "codex" ? "Conecte sua conta ChatGPT para exibir as opções de modelos automaticamente." : "Cole sua chave de API acima. As opções de modelos serão carregadas automaticamente, sem precisar salvar antes."}</p>}
        {catalogError && <p role="alert" className="rounded-xl bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">Não foi possível carregar os modelos. {catalogError} Confira a chave e clique em Atualizar modelos para tentar novamente.</p>}
        {catalogLoaded && !catalogLoading && <p role="status" className="text-xs text-zinc-500">{catalog.length ? `${catalog.length} modelo(s) listado(s). Escolha uma opção abaixo.` : "O provedor não listou modelos para esta conta. Confira o acesso da chave ou tente Atualizar modelos."}</p>}
        <Label htmlFor="ai-model">Modelo principal</Label>
        {manualModels ? <Input id="ai-model" value={models.economico} disabled={busy} placeholder="Identificador fornecido pelo provedor" onChange={(e) => { setModels({ economico: e.target.value, equilibrado: e.target.value, precisao: e.target.value }); setResult(""); }} />
          : <Select id="ai-model" value={models.economico} disabled={busy || catalogLoading || (!catalog.length && !models.economico)} onChange={(e) => { setModels({ economico: e.target.value, equilibrado: e.target.value, precisao: e.target.value }); setResult(""); }}>{modelOptions(models.economico)}</Select>}
        <p className="text-xs text-zinc-500">A escolha do modelo principal vale para os três modos. O catálogo é consultado no provedor; confirme o suporte à análise com Testar conexão.</p>
        <details className="rounded-xl border border-zinc-200 p-3 text-sm dark:border-zinc-700"><summary className="cursor-pointer font-medium">Modelos por modo de análise</summary><div className="mt-3 grid gap-3">
          {MODES.map((mode) => <div key={mode}><Label htmlFor={`ai-model-${mode}`}>{MODE_NAMES[mode]}</Label>{manualModels
            ? <Input id={`ai-model-${mode}`} disabled={busy} value={models[mode]} onChange={(e) => { setModels((m) => ({ ...m, [mode]: e.target.value })); setResult(""); }} />
            : <Select id={`ai-model-${mode}`} disabled={busy || catalogLoading || (!catalog.length && !models[mode])} value={models[mode]} onChange={(e) => { setModels((m) => ({ ...m, [mode]: e.target.value })); setResult(""); }}>{modelOptions(models[mode])}</Select>}</div>)}
          <p className="text-xs text-zinc-500">Os modos controlam lotes e revisão. Se escolher modelos diferentes, casos econômicos inconclusivos podem usar o modelo equilibrado do mesmo provedor.</p>
          <label className="flex items-center gap-2 text-xs text-zinc-500"><input type="checkbox" checked={manualModels} disabled={busy} onChange={(e) => setManualModels(e.target.checked)} /> Informar identificadores manualmente (avançado)</label>
        </div></details>
      </div>
      <div className="flex flex-wrap items-end gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-700">
        <div className="min-w-36"><Label htmlFor="ai-test-mode">Modo para testar</Label><Select id="ai-test-mode" value={testMode} disabled={busy} onChange={(e) => { setTestMode(e.target.value as Mode); setResult(""); }}>{MODES.map((m) => <option key={m} value={m}>{MODE_NAMES[m]}</option>)}</Select></div>
        <Button variant="outline" disabled={busy || authorizing || (provider === "codex" && !config.chatgpt_login_available) || !models[testMode] || (provider !== "codex" && !key && !config.credentials[provider])} onClick={() => void action(async () => { const data = await api.post<{ mensagem: string }>("/ai/test", { provider, model: models[testMode], api_key: key.trim() || undefined }); setResult(data.mensagem); })}>Testar conexão</Button>
        <Button disabled={busy || authorizing || (provider === "codex" && !config.chatgpt_login_available) || !MODES.every((m) => models[m].trim()) || (provider !== "codex" && !key && !config.credentials[provider])} onClick={() => void action(async () => {
          const data = await api.put<Configuration>("/ai/config", { provider, models, api_key: key.trim() || undefined }); setConfig(data); setModels(data.models[provider]); setKey(""); show("Configuração da IA salva. Os próximos trabalhos usarão esta conexão.", "success");
        })}>Salvar configuração da IA</Button>
      </div>
      {result && <p role="status" className="rounded-xl bg-zinc-50 p-3 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{result}</p>}
      <p className="text-xs leading-relaxed text-zinc-500">As alterações valem para as próximas análises deste escritório. Trabalhos já concluídos e revisões humanas são preservados. O teste envia apenas uma solicitação curta, sem dados de clientes, e pode consumir créditos do provedor.</p>
    </>}
    <ConfirmDialog open={confirm !== null} title={confirm === "key" ? "Remover credencial da IA?" : "Desconectar conta ChatGPT?"} message="Se esta for a conexão em uso, a fila será pausada. Configure a conexão e retome a fila quando estiver pronta." confirmLabel={confirm === "key" ? "Remover chave" : "Desconectar"} confirmVariant="danger" loading={busy} onCancel={() => setConfirm(null)} onConfirm={() => void action(async () => {
      if (confirm === "key" && provider !== "codex") { const data = await api.delete<Configuration>(`/ai/credentials/${provider}`); setConfig(data); setKey(""); }
      else { await api.post("/ai/chatgpt/logout", {}); await refreshChat(); }
      setConfirm(null);
    })} />
  </section>;
}
