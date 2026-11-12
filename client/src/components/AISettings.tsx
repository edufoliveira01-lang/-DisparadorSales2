import { useCallback, useEffect, useRef, useState } from "react";
import { BrainCircuit, ExternalLink, RefreshCw, Unplug } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Badge } from "@/components/ui/Badge";
import { Checkbox } from "@/components/ui/Checkbox";
import { Skeleton } from "@/components/ui/Skeleton";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
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
  const hasCredential = config && provider !== "codex" ? config.credentials[provider] : false;
  const providerBlocked = Boolean(config && provider === "codex" && !config.chatgpt_login_available);
  const missingAccess = Boolean(config && provider !== "codex" && !key && !config.credentials[provider]);
  const connection = !config ? null
    : config.provider === "codex"
      ? (chat ? (chat.connection.conectado ? <Badge tone="success">Conta conectada</Badge> : <Badge tone="warning">Conta não conectada</Badge>) : null)
      : (config.credentials[config.provider] ? <Badge tone="success">Chave cadastrada</Badge> : <Badge tone="warning">Sem chave</Badge>);
  const status = config ? <>
    <Badge tone="accent">Em uso: {NAMES[config.provider]}</Badge>{connection}
    {changed && <Badge tone="warning">Alterações não salvas</Badge>}
  </> : undefined;
  const pickModel = (value: string) => { setModels({ economico: value, equilibrado: value, precisao: value }); setResult(""); };
  return <>
    <SettingsPanel icon={<BrainCircuit />} title="Inteligência artificial" description="Escolha quem analisa as publicações. Revisões, exemplos e histórico continuam no sistema." status={status}>
      {!config && !error && <div role="status" aria-label="Carregando configuração da IA" className="space-y-3 px-5 py-5"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-10 w-full" /><Skeleton className="h-10 w-full" /></div>}
      {error && <div className="px-5 py-4"><Callout tone="erro">{error}</Callout></div>}
      {busy && <div className="px-5 py-3"><Callout tone="info">Processando a solicitação da IA…</Callout></div>}
      {config && <>
        <SettingsBlock step={1} title="Provedor e acesso" description="De onde vem a inteligência e como o sistema se autentica.">
          <SettingRow label="Provedor de IA" htmlFor="ai-provider" hint="Conta ChatGPT ou chave de API própria.">
            <Select id="ai-provider" value={provider} disabled={busy} onChange={(e) => choose(e.target.value as Provider)}>
              {Object.entries(NAMES).map(([id, name]) => <option key={id} value={id} disabled={id === "codex" && !config.chatgpt_login_available}>{name}</option>)}
            </Select>
          </SettingRow>
          {provider !== "codex" ? <>
            <SettingRow label={hasCredential ? "Nova chave de API" : "Chave de API"} htmlFor="ai-key" hint={hasCredential ? "Opcional. Só preencha para trocar a chave cadastrada." : "Cole a chave fornecida pelo provedor. É criptografada no servidor."}>
              <Input id="ai-key" type="password" autoComplete="new-password" spellCheck={false} maxLength={4096} value={key} disabled={busy} onChange={(e) => { setKey(e.target.value); setResult(""); }} placeholder={hasCredential ? "Deixe vazio para manter a chave cadastrada" : "Cole a chave aqui"} />
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={hasCredential ? "success" : "warning"}>{hasCredential ? "Chave cadastrada" : "Chave ainda não cadastrada"}</Badge>
                {hasCredential && <Button variant="ghost" size="sm" disabled={busy || authorizing} onClick={() => setConfirm("key")}>Remover chave cadastrada</Button>}
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">O uso da API segue a cobrança e os limites da sua conta no provedor.</p>
            </SettingRow>
          </> : <SettingRow label="Conta ChatGPT" hint="A autorização é feita na página oficial da OpenAI, sem senha neste painel.">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={chat?.connection.conectado ? "success" : "warning"}>{chat?.connection.conectado ? "Conta conectada" : "Conta não conectada"}</Badge>
              <Button size="sm" disabled={busy || authorizing || !config.chatgpt_login_available} onClick={() => void action(async () => { const login = await api.post<Login>("/ai/chatgpt/login", {}); setChat((c) => ({ connection: c?.connection || { conectado: false, mensagem: "" }, login })); })}>Conectar conta ChatGPT</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void action(refreshChat)}><RefreshCw className="h-4 w-4" /> Verificar conta</Button>
              {chat?.connection.conectado && <Button size="sm" variant="ghost" disabled={busy || authorizing} onClick={() => setConfirm("chat")}><Unplug className="h-4 w-4" /> Desconectar</Button>}
            </div>
            {config.chatgpt_login_message && <p className="text-xs text-zinc-500 dark:text-zinc-400">{config.chatgpt_login_message}</p>}
            {chat?.login.state === "waiting" && <div role="status" className="space-y-3 rounded-xl border border-accent-200 bg-accent-50 p-4 dark:border-accent-900 dark:bg-accent-900/20">
              <p className="text-sm">Abra a página oficial e informe este código:</p>
              <code className="block break-all text-xl font-semibold tracking-wider">{chat.login.user_code}</code>
              <div className="flex flex-wrap items-center gap-3">
                <a className="inline-flex items-center gap-1 text-sm font-medium text-accent-600 underline dark:text-accent-300" href={chat.login.verification_url} target="_blank" rel="noopener noreferrer">Autorizar na OpenAI <ExternalLink className="h-4 w-4" /></a>
                <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(async () => { await api.post("/ai/chatgpt/cancel", { id: chat.login.id }); await refreshChat(); })}>Cancelar autorização</Button>
              </div>
              <p className="text-xs text-zinc-500 dark:text-zinc-400">A conexão é confirmada automaticamente. O código some ao concluir, cancelar ou expirar.</p>
            </div>}
            {chat?.login.message && <p role="status" className="text-xs text-zinc-500 dark:text-zinc-400">{chat.login.message}</p>}
          </SettingRow>}
        </SettingsBlock>

        <SettingsBlock step={2} title="Modelo" description="Os modelos são consultados direto no provedor, sem precisar salvar antes."
          >
          <div className="flex justify-end -mt-2">
            <Button size="sm" variant="outline" disabled={busy || catalogLoading || !canLoadModels} onClick={() => setCatalogRefresh((n) => n + 1)}><RefreshCw className={`h-4 w-4${catalogLoading ? " animate-spin" : ""}`} /> Atualizar modelos</Button>
          </div>
          {catalogLoading && <Skeleton className="h-10 w-full" />}
          {!canLoadModels && <Callout tone="info">{authorizing ? "Conclua a autorização para carregar os modelos automaticamente." : provider === "codex" ? "Conecte sua conta ChatGPT para listar os modelos automaticamente." : "Cole a chave de API acima para listar os modelos automaticamente."}</Callout>}
          {catalogError && <Callout tone="aviso">Não foi possível carregar os modelos. {catalogError} Confira a chave e clique em Atualizar modelos.</Callout>}
          <SettingRow label="Modelo principal" htmlFor="ai-model" hint="Vale para os três modos de análise.">
            {manualModels ? <Input id="ai-model" value={models.economico} disabled={busy} placeholder="Identificador fornecido pelo provedor" onChange={(e) => pickModel(e.target.value)} />
              : <Select id="ai-model" value={models.economico} disabled={busy || catalogLoading || (!catalog.length && !models.economico)} onChange={(e) => pickModel(e.target.value)}>{modelOptions(models.economico)}</Select>}
            {catalogLoaded && !catalogLoading && <p role="status" className="text-xs text-zinc-500 dark:text-zinc-400">{catalog.length ? `${catalog.length} modelo(s) disponível(is) na sua conta.` : "O provedor não listou modelos para esta conta. Confira o acesso ou tente Atualizar modelos."}</p>}
          </SettingRow>
          <details className="rounded-xl border border-zinc-200 px-4 py-3 text-sm dark:border-zinc-700">
            <summary className="cursor-pointer font-medium text-zinc-800 dark:text-zinc-200">Opções avançadas: modelo por modo de análise</summary>
            <div className="mt-4 space-y-4">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">Os modos controlam lotes e revisão. Com modelos diferentes, casos econômicos inconclusivos podem usar o modelo equilibrado do mesmo provedor.</p>
              {MODES.map((mode) => <SettingRow key={mode} label={MODE_NAMES[mode]} htmlFor={`ai-model-${mode}`}>{manualModels
                ? <Input id={`ai-model-${mode}`} disabled={busy} value={models[mode]} onChange={(e) => { setModels((m) => ({ ...m, [mode]: e.target.value })); setResult(""); }} />
                : <Select id={`ai-model-${mode}`} disabled={busy || catalogLoading || (!catalog.length && !models[mode])} value={models[mode]} onChange={(e) => { setModels((m) => ({ ...m, [mode]: e.target.value })); setResult(""); }}>{modelOptions(models[mode])}</Select>}</SettingRow>)}
              <label className="flex items-center gap-2 text-xs text-zinc-600 dark:text-zinc-300"><Checkbox checked={manualModels} disabled={busy} onChange={(e) => setManualModels(e.target.checked)} /> Informar identificadores manualmente</label>
            </div>
          </details>
        </SettingsBlock>

        <SettingsBlock step={3} title="Testar e salvar" description="O teste envia uma solicitação curta, sem dados de clientes, e pode consumir créditos do provedor.">
          <SettingRow label="Modo para testar" htmlFor="ai-test-mode">
            <Select id="ai-test-mode" value={testMode} disabled={busy} onChange={(e) => { setTestMode(e.target.value as Mode); setResult(""); }}>{MODES.map((m) => <option key={m} value={m}>{MODE_NAMES[m]}</option>)}</Select>
          </SettingRow>
          {result && <Callout tone="ok">{result}</Callout>}
        </SettingsBlock>
        <SettingsFooter left="As alterações valem para as próximas análises. Trabalhos concluídos e revisões humanas são preservados.">
          <Button variant="outline" disabled={busy || authorizing || providerBlocked || !models[testMode] || missingAccess} onClick={() => void action(async () => { const data = await api.post<{ mensagem: string }>("/ai/test", { provider, model: models[testMode], api_key: key.trim() || undefined }); setResult(data.mensagem); })}>Testar conexão</Button>
          <Button disabled={busy || authorizing || providerBlocked || !MODES.every((m) => models[m].trim()) || missingAccess} onClick={() => void action(async () => {
            const data = await api.put<Configuration>("/ai/config", { provider, models, api_key: key.trim() || undefined }); setConfig(data); setModels(data.models[provider]); setKey(""); show("Configuração da IA salva. Os próximos trabalhos usarão esta conexão.", "success");
          })}>Salvar configuração da IA</Button>
        </SettingsFooter>
      </>}
    </SettingsPanel>
    <ConfirmDialog open={confirm !== null} title={confirm === "key" ? "Remover credencial da IA?" : "Desconectar conta ChatGPT?"} message="Se esta for a conexão em uso, a fila será pausada. Configure a conexão e retome a fila quando estiver pronta." confirmLabel={confirm === "key" ? "Remover chave" : "Desconectar"} confirmVariant="danger" loading={busy} onCancel={() => setConfirm(null)} onConfirm={() => void action(async () => {
      if (confirm === "key" && provider !== "codex") { const data = await api.delete<Configuration>(`/ai/credentials/${provider}`); setConfig(data); setKey(""); }
      else { await api.post("/ai/chatgpt/logout", {}); await refreshChat(); }
      setConfirm(null);
    })} />
  </>;
}
