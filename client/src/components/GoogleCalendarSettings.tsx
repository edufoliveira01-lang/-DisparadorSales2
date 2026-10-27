import { useCallback, useEffect, useState } from "react";
import "./GoogleCalendarSettings.css";
import {
  CalendarSync, CalendarDays, CheckCircle2, ChevronDown, Clock3, ExternalLink, FileText, Link2, ListChecks, Plus,
  RefreshCw, Settings2, ShieldCheck, SlidersHorizontal, Trash2, Unplug, Save,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  GoogleCalendarAnalysis,
  GoogleCalendarConfig,
  GoogleCalendarDestinationConfig,
  GoogleCalendarListItem,
  GoogleCalendarStatus,
  GoogleCalendarSyncJob,
  GoogleCalendarSyncResult,
} from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input, Label, Textarea } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

const DEFAULT_TITLE_TEMPLATE = "{tipo} - {data} - {horario} - {nome} - {telefone} - {processo}";
const DEFAULT_DESCRIPTION_TEMPLATE = [
  "{descricao_original}",
  "TIPO: {tipo};",
  "DATA: {data};",
  "HORÁRIO: {horario};",
  "LOCAL: {local};",
  "NOME: {nome};",
  "TELEFONE: {telefone};",
  "WHATSAPP: {whatsapp};",
  "PROCESSO: {processo};",
  "PROFISSIONAL/PERITO: {profissional};",
].join("\n");
const TEMPLATE_TOKENS = ["{tipo}", "{data}", "{horario}", "{local}", "{nome}", "{telefone}", "{whatsapp}", "{processo}", "{profissional}"];
const ORIGINAL_DESCRIPTION_TOKEN = "{descricao_original}";
const ORIGINAL_DESCRIPTION_PATTERN = /\{(?:descricao|descrição)_original\}/gi;
const DESCRIPTION_START = "--- INÍCIO DISPARAZAP ---";
const DESCRIPTION_END = "--- FIM DISPARAZAP ---";

function ToggleLine({ checked, onChange, children }: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: React.ReactNode;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 text-sm text-zinc-600 dark:text-zinc-300">
      <Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </label>
  );
}

function newDestination(destination: number): GoogleCalendarDestinationConfig {
  return {
    destination,
    name: `Destino ${destination}`,
    enabled: false,
    calendarId: "",
    calendarName: "",
    titleTemplate: DEFAULT_TITLE_TEMPLATE,
    descriptionTemplate: DEFAULT_DESCRIPTION_TEMPLATE,
    descriptionMode: "preserve",
    uppercaseTitle: true,
    timingMode: "appointment_time",
    startDaysBefore: 0,
    endDaysAfter: 0,
    fixedTime: "23:00",
    durationMinutes: 60,
    eventMode: "create_additional",
    includePhone: true,
    includeProcess: true,
    includeProfessional: true,
    includeLocation: true,
    visibility: "default",
    transparency: "opaque",
    colorId: "",
  };
}

function titlePreview(config: GoogleCalendarDestinationConfig): string {
  const values: Record<string, string> = {
    tipo: "PERÍCIA MÉDICA",
    data: "02/12/2026",
    horario: "10:00",
    nome: "CLIENTE EXEMPLO",
    telefone: "(13) 99711-4872",
    whatsapp: "SIM",
    processo: "1003033-76.2025.8.26.0075",
    profissional: "PROFISSIONAL",
    local: "LOCAL DA PERÍCIA",
  };
  const rendered = config.titleTemplate.replace(
    /\{(tipo|data|horario|nome|telefone|whatsapp|processo|profissional|local)\}/gi,
    (_match, token: string) => values[token.toLowerCase()] || ""
  );
  return config.uppercaseTitle ? rendered.toLocaleUpperCase("pt-BR") : rendered;
}

function descriptionPreview(config: GoogleCalendarDestinationConfig): string {
  const values: Record<string, string> = {
    tipo: "PERÍCIA MÉDICA",
    data: "02/12/2026",
    horario: "10:00",
    local: "Rua Marrey Júnior, s/nº (entrada lateral do Fórum Central) - Sala 9E - Santos/SP",
    nome: "CLIENTE EXEMPLO",
    telefone: "(13) 99711-4872",
    whatsapp: "SIM",
    processo: "1003033-76.2025.8.26.0075",
    profissional: "",
  };
  const rendered = config.descriptionTemplate.replace(
    /\{(tipo|data|horario|nome|telefone|whatsapp|processo|profissional|local)\}/gi,
    (_match, token: string) => values[token.toLowerCase()] || ""
  ).trim();
  const original = "Informações que já existiam na descrição do evento.";
  const withoutOriginal = rendered.replace(ORIGINAL_DESCRIPTION_PATTERN, "").trim();
  if (config.descriptionMode === "keep_original") return original;
  if (config.descriptionMode === "replace") return withoutOriginal;

  const block = (value: string) => value.trim() ? `${DESCRIPTION_START}\n${value.trim()}\n${DESCRIPTION_END}` : "";
  const token = rendered.match(/\{(?:descricao|descrição)_original\}/i);
  if (!token || token.index === undefined) return [original, block(withoutOriginal)].filter(Boolean).join("\n\n");
  const before = rendered.slice(0, token.index).replace(ORIGINAL_DESCRIPTION_PATTERN, "").trim();
  const after = rendered.slice(token.index + token[0].length).replace(ORIGINAL_DESCRIPTION_PATTERN, "").trim();
  return [block(before), original, block(after)].filter(Boolean).join("\n\n");
}

function formatCandidateMoment(value: string): string {
  if (!value) return "Horário não informado";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year} · dia inteiro`;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("pt-BR");
}

const TOKEN_LABELS: Record<string, string> = {
  "{tipo}": "Tipo", "{data}": "Data", "{horario}": "Horário", "{local}": "Local",
  "{nome}": "Nome", "{telefone}": "Telefone", "{whatsapp}": "WhatsApp",
  "{processo}": "Processo", "{profissional}": "Profissional", "{descricao_original}": "Descrição original",
};

function timingSummary(config: GoogleCalendarDestinationConfig): string {
  if (config.timingMode === "all_day") return `Dia inteiro · ${config.startDaysBefore} dia(s) antes`;
  if (config.timingMode === "fixed_time") return `Às ${config.fixedTime} · ${config.durationMinutes} min`;
  return `Horário da perícia · ${config.durationMinutes} min`;
}

function TemplateTokens({ description = false, preserve = false, onInsert }: {
  description?: boolean; preserve?: boolean; onInsert: (token: string) => void;
}) {
  return <div className="ga-tokens" aria-label={`Inserir informação ${description ? "na descrição" : "no título"}`}>
    <span>Inserir:</span>
    {[...(preserve ? [ORIGINAL_DESCRIPTION_TOKEN] : []), ...TEMPLATE_TOKENS].map(token => (
      <button key={token} type="button" title={token}
        aria-label={`Inserir ${TOKEN_LABELS[token]} ${description ? "na descrição" : "no título"}`}
        onClick={() => onInsert(token)}>{TOKEN_LABELS[token]}</button>
    ))}
  </div>;
}

function DestinationEditor({ config, calendars, onChange, onRemove }: {
  config: GoogleCalendarDestinationConfig;
  calendars: GoogleCalendarListItem[];
  onChange: (value: GoogleCalendarDestinationConfig) => void;
  onRemove: () => void;
}) {
  const [openSection, setOpenSection] = useState("agenda");
  const update = <K extends keyof GoogleCalendarDestinationConfig>(key: K, value: GoogleCalendarDestinationConfig[K]) => onChange({ ...config, [key]: value });
  const selected = calendars.find(calendar => calendar.id === config.calendarId);
  const sections = [
    { id: "agenda", title: "Agenda e vínculo", summary: config.calendarName || "Escolha a agenda de destino", icon: CalendarDays },
    { id: "timing", title: "Data e horário", summary: timingSummary(config), icon: Clock3 },
    { id: "content", title: "Título e descrição", summary: config.descriptionMode === "keep_original" ? "Título personalizado · descrição original" : "Personalize as informações do evento", icon: FileText },
    { id: "options", title: "Aparência e privacidade", summary: `${config.transparency === "opaque" ? "Ocupado" : "Livre"} · ${config.visibility === "private" ? "Privado" : "Padrão da agenda"}`, icon: SlidersHorizontal },
  ];
  return <div className="ga-editor">
    <div className="ga-editor-heading">
      <div><span className="ga-eyebrow">CONFIGURAÇÃO DO DESTINO</span><h3>{config.name || `Destino ${config.destination}`}</h3></div>
      <ToggleLine checked={config.enabled} onChange={checked => update("enabled", checked)}>Destino ativo</ToggleLine>
    </div>
    <div className="ga-sections">
      {sections.map(({ id, title, summary, icon: Icon }) => <section key={id} className={`ga-section ${openSection === id ? "is-open" : ""}`}>
        <button type="button" className="ga-section-heading" aria-expanded={openSection === id}
          aria-controls={`ga-${config.destination}-${id}`} onClick={() => setOpenSection(openSection === id ? "" : id)}>
          <span className="ga-section-icon"><Icon size={18} /></span>
          <span><strong>{title}</strong><small>{summary}</small></span><ChevronDown size={17} />
        </button>
        {openSection === id && <div id={`ga-${config.destination}-${id}`} className="ga-section-body">
          {id === "agenda" && <>
            <div className="ga-field-grid">
              <div><Label htmlFor={`ga-name-${config.destination}`}>Nome deste destino</Label>
                <Input id={`ga-name-${config.destination}`} value={config.name} onChange={event => update("name", event.target.value)} placeholder="Ex.: Período da perícia" /></div>
              <div><Label htmlFor={`ga-calendar-${config.destination}`}>Agenda do Google</Label>
                <Select id={`ga-calendar-${config.destination}`} value={config.calendarId} onChange={event => {
                  const calendar = calendars.find(item => item.id === event.target.value);
                  onChange({ ...config, calendarId: event.target.value, calendarName: calendar?.summary || "" });
                }}>
                  <option value="">Selecione uma agenda…</option>
                  {config.calendarId && !selected && <option value={config.calendarId}>{config.calendarName || "Agenda selecionada"}</option>}
                  {calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? " (principal)" : ""}</option>)}
                </Select></div>
            </div>
            <div><Label htmlFor={`ga-mode-${config.destination}`}>Se o evento ainda não estiver na agenda</Label>
              <Select id={`ga-mode-${config.destination}`} value={config.eventMode} onChange={event => update("eventMode", event.target.value as GoogleCalendarDestinationConfig["eventMode"])}>
                <option value="reuse_manual">Aguardar um evento existente</option><option value="create_additional">Criar somente se não encontrar um existente</option>
              </Select>
              <p className="ga-help">{config.eventMode === "reuse_manual" ? "Somente reaproveita eventos existentes. Se não encontrar, aguarda sem criar uma cópia." : "Primeiro procura um evento correspondente. A criação acontece apenas se nenhum for encontrado."}</p>
            </div>
            <div className="ga-note"><Link2 size={16} /><p>A vinculação usa processo, nome, tipo e data. Quando há mais de uma possibilidade, você escolhe o evento na análise.</p></div>
          </>}
          {id === "timing" && <>
            <div><Label htmlFor={`ga-timing-${config.destination}`}>Como exibir a perícia na agenda</Label>
              <Select id={`ga-timing-${config.destination}`} value={config.timingMode} onChange={event => update("timingMode", event.target.value as GoogleCalendarDestinationConfig["timingMode"])}>
                <option value="all_day">Dia inteiro, com período configurável</option><option value="fixed_time">Em um horário fixo</option><option value="appointment_time">Na data e no horário da perícia</option>
              </Select></div>
            {config.timingMode === "all_day" ? <>
              <div className="ga-field-grid">
                <div><Label htmlFor={`ga-before-${config.destination}`}>Começar quantos dias antes?</Label><Input id={`ga-before-${config.destination}`} type="number" min={0} max={365} value={config.startDaysBefore} onChange={event => update("startDaysBefore", Number(event.target.value))} /></div>
                <div><Label htmlFor={`ga-after-${config.destination}`}>Terminar quantos dias depois?</Label><Input id={`ga-after-${config.destination}`} type="number" min={0} max={365} value={config.endDaysAfter} onChange={event => update("endDaysAfter", Number(event.target.value))} /></div>
              </div>
              <div className="ga-period"><span>{config.startDaysBefore} dia(s) antes</span><i /><strong>Dia da perícia</strong><i /><span>{config.endDaysAfter ? `${config.endDaysAfter} dia(s) depois` : "Termina neste dia"}</span></div>
              <p className="ga-help">O dia da perícia está incluído no período. Use zero para começar ou terminar nesse mesmo dia.</p>
            </> : <div className="ga-field-grid">
              {config.timingMode === "fixed_time" && <div><Label htmlFor={`ga-time-${config.destination}`}>Horário fixo</Label><Input id={`ga-time-${config.destination}`} type="time" value={config.fixedTime} onChange={event => update("fixedTime", event.target.value)} /></div>}
              <div><Label htmlFor={`ga-duration-${config.destination}`}>Duração em minutos</Label><Input id={`ga-duration-${config.destination}`} type="number" min={5} max={1440} value={config.durationMinutes} onChange={event => update("durationMinutes", Number(event.target.value))} /></div>
            </div>}
          </>}
          {id === "content" && <>
            <div><Label htmlFor={`ga-title-${config.destination}`}>Modelo do título</Label>
              <Input id={`ga-title-${config.destination}`} value={config.titleTemplate} onChange={event => update("titleTemplate", event.target.value)} />
              <TemplateTokens onInsert={token => update("titleTemplate", `${config.titleTemplate}${config.titleTemplate ? " " : ""}${token}`)} />
              <ToggleLine checked={config.uppercaseTitle} onChange={checked => update("uppercaseTitle", checked)}>Título em letras maiúsculas</ToggleLine>
            </div>
            <div><Label htmlFor={`ga-description-mode-${config.destination}`}>Como tratar a descrição que já existe</Label>
              <Select id={`ga-description-mode-${config.destination}`} value={config.descriptionMode} onChange={event => update("descriptionMode", event.target.value as GoogleCalendarDestinationConfig["descriptionMode"])}>
                <option value="preserve">Preservar e complementar</option><option value="replace">Substituir pelo modelo abaixo</option><option value="keep_original">Manter somente a descrição original</option>
              </Select>
              <p className="ga-help">{config.descriptionMode === "preserve" ? "Mantém as anotações originais e atualiza apenas o bloco do DisparaZap." : config.descriptionMode === "replace" ? "O conteúdo atual da descrição será substituído pelo seu modelo." : "A descrição que está no Google será mantida, sem alterações."}</p>
            </div>
            {config.descriptionMode !== "keep_original" && <div><Label htmlFor={`ga-description-${config.destination}`}>Modelo da descrição</Label>
              <Textarea id={`ga-description-${config.destination}`} rows={6} value={config.descriptionTemplate} onChange={event => update("descriptionTemplate", event.target.value)} className="font-mono text-xs leading-5" />
              <TemplateTokens description preserve={config.descriptionMode === "preserve"} onInsert={token => update("descriptionTemplate", `${config.descriptionTemplate}${config.descriptionTemplate ? "\n" : ""}${token}`)} />
              {config.descriptionMode === "preserve" && <p className="ga-help">Insira “Descrição original” para definir onde as anotações existentes aparecerão.</p>}
            </div>}
            <div className="ga-preview"><span className="ga-eyebrow">PRÉVIA DO EVENTO · EXEMPLO</span><h4>{titlePreview(config)}</h4><pre>{descriptionPreview(config)}</pre></div>
          </>}
          {id === "options" && <>
            <div className="ga-field-grid">
              <div><Label htmlFor={`ga-availability-${config.destination}`}>Disponibilidade</Label><Select id={`ga-availability-${config.destination}`} value={config.transparency} onChange={event => update("transparency", event.target.value as "opaque" | "transparent")}><option value="opaque">Ocupado</option><option value="transparent">Livre</option></Select></div>
              <div><Label htmlFor={`ga-privacy-${config.destination}`}>Privacidade</Label><Select id={`ga-privacy-${config.destination}`} value={config.visibility} onChange={event => update("visibility", event.target.value as "default" | "private")}><option value="default">Padrão da agenda</option><option value="private">Privado</option></Select></div>
              <div><Label htmlFor={`ga-color-${config.destination}`}>Cor do evento no Google</Label><Select id={`ga-color-${config.destination}`} value={config.colorId} onChange={event => update("colorId", event.target.value)}><option value="">Padrão da agenda</option>{Array.from({ length:11 }, (_, index) => String(index+1)).map(color => <option key={color} value={color}>Cor {color}</option>)}</Select></div>
            </div>
            <ToggleLine checked={config.includeLocation} onChange={checked => update("includeLocation", checked)}>Preencher o campo “Local” com o endereço da perícia</ToggleLine>
          </>}
        </div>}
      </section>)}
    </div>
    <div className="ga-editor-end"><span>As regras deste destino são independentes das outras agendas.</span><Button variant="ghost" size="sm" onClick={onRemove} className="text-red-500"><Trash2 size={14} /> Remover destino</Button></div>
  </div>;
}

export function GoogleCalendarSettings({ alwaysOpen = false }: { alwaysOpen?: boolean }) {
  const { show } = useToast();
  const [status, setStatus] = useState<GoogleCalendarStatus | null>(null);
  const [config, setConfig] = useState<GoogleCalendarConfig | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarListItem[]>([]);
  const [analysis, setAnalysis] = useState<GoogleCalendarAnalysis | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [resolvingConflict, setResolvingConflict] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [view, setView] = useState<"destinations" | "analysis">("destinations");
  const [selectedDestination, setSelectedDestination] = useState<number | null>(null);
  const [savedConfig, setSavedConfig] = useState<string | null>(null);
  const [duplicateChoice, setDuplicateChoice] = useState<{
    destination: number; periciaId: number; eventId: string; title: string; start: string; removeCount: number;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await api.get<GoogleCalendarStatus>("/google-calendar/status");
      setStatus(nextStatus);
      setConfig(nextStatus.config);
      setSavedConfig(JSON.stringify(nextStatus.config));
      if (nextStatus.connected) {
        setCalendars(await api.get<GoogleCalendarListItem[]>("/google-calendar/calendars"));
      } else {
        setCalendars([]);
      }
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Erro ao carregar a integração com o Google Agenda.", "error");
    } finally {
      setLoading(false);
    }
  }, [show]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const oauthResult = params.get("google_calendar");
    if (oauthResult === "connected") show("Conta Google conectada. Agora selecione as agendas de destino.", "success");
    if (oauthResult === "error") show(params.get("message") || "Não foi possível conectar a conta Google.", "error");
    if (oauthResult) {
      params.delete("google_calendar");
      params.delete("message");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
    load();
  }, [load, show]);

  function updateDestination(index: number, value: GoogleCalendarDestinationConfig) {
    if (!config) return;
    const destinations = [...config.destinations];
    destinations[index] = value;
    setConfig({ ...config, destinations });
    setAnalysis(null);
  }

  function addDestination() {
    if (!config || config.destinations.length >= 50) return;
    const nextId = Math.max(0, ...config.destinations.map((item) => item.destination)) + 1;
    setConfig({ ...config, destinations: [...config.destinations, newDestination(nextId)] });
    setSelectedDestination(nextId);
    setView("destinations");
    setAnalysis(null);
  }

  function removeDestination(index: number) {
    if (!config) return;
    const destinations = config.destinations.filter((_item, currentIndex) => currentIndex !== index);
    setConfig({ ...config, destinations, syncEnabled: destinations.length > 0 ? config.syncEnabled : false });
    setAnalysis(null);
  }

  async function saveConfig(showSuccess = true): Promise<boolean> {
    if (!config) return false;
    setSaving(true);
    try {
      const response = await api.put<{ ok: true; config: GoogleCalendarConfig }>("/google-calendar/config", config);
      setConfig(response.config);
      setSavedConfig(JSON.stringify(response.config));
      if (showSuccess) show("Configurações do Google Agenda salvas.", "success");
      return true;
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Não foi possível salvar as configurações.", "error");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function analyze() {
    if (!await saveConfig(false)) return;
    setAnalyzing(true);
    try {
      const result = await api.post<GoogleCalendarAnalysis>("/google-calendar/analyze");
      setAnalysis(result);
      setView("analysis");
      show("Análise concluída. Nenhum evento foi alterado.", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Não foi possível analisar as agendas.", "error");
    } finally {
      setAnalyzing(false);
    }
  }

  async function sync() {
    if (!await saveConfig(false)) return;
    setSyncing(true);
    try {
      const response = await api.post<{ ok: true; started: boolean; job: GoogleCalendarSyncJob }>("/google-calendar/sync");
      let job = response.job;
      while (job.state === "running") {
        await new Promise((resolve) => window.setTimeout(resolve, 2_000));
        job = await api.get<GoogleCalendarSyncJob>("/google-calendar/sync/status");
      }
      if (job.state === "failed") {
        throw new Error(job.error || "A sincronização com o Google Agenda não pôde ser concluída.");
      }
      const result: GoogleCalendarSyncResult | null = job.result;
      if (!result) throw new Error("O servidor não retornou o resultado da sincronização.");
      let nextAnalysis: GoogleCalendarAnalysis | null = null;
      if (result.conflicts > 0) {
        nextAnalysis = await api.post<GoogleCalendarAnalysis>("/google-calendar/analyze");
      }
      setAnalysis(nextAnalysis);
      setView(nextAnalysis ? "analysis" : "destinations");
      show(
        `Google Agenda atualizado: ${result.created} criado(s), ${result.linked} vinculado(s), ${result.updated} atualizado(s), ${result.skipped} não encontrado(s)${result.conflicts ? ` e ${result.conflicts} aguardando sua escolha` : ""}${result.errors ? ` e ${result.errors} erro(s)` : ""}.`,
        result.errors || result.conflicts ? "info" : "success"
      );
      await load();
    } catch (err) {
      show(err instanceof Error ? err.message : "Não foi possível sincronizar as agendas.", "error");
    } finally {
      setSyncing(false);
    }
  }

  async function resolveConflict(destination: number, periciaId: number, googleEventId: string, removeDuplicates = false) {
    const key = `${destination}:${periciaId}:${googleEventId}`;
    setResolvingConflict(key);
    try {
      await api.post("/google-calendar/conflicts/resolve", { destination, periciaId, googleEventId, removeDuplicates });
      const nextAnalysis = await api.post<GoogleCalendarAnalysis>("/google-calendar/analyze");
      setAnalysis(nextAnalysis);
      setDuplicateChoice(null);
      show(removeDuplicates ? "Duplicidade resolvida. O evento escolhido será reutilizado nas próximas sincronizações." : "Evento selecionado, vinculado e sincronizado. O sistema continuará usando esse mesmo evento.", "success");
      await load();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Não foi possível vincular o evento escolhido.", "error");
    } finally {
      setResolvingConflict(null);
    }
  }

  async function disconnect() {
    setDisconnecting(true);
    try {
      await api.post("/google-calendar/disconnect");
      show("Conta Google desconectada. Os eventos já existentes não foram apagados.", "info");
      setAnalysis(null);
      await load();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Não foi possível desconectar a conta.", "error");
    } finally {
      setDisconnecting(false);
    }
  }

  const activeIndex = config ? Math.max(0, config.destinations.findIndex(item => item.destination === selectedDestination)) : 0;
  const activeDestination = config?.destinations[activeIndex];
  const dirty = Boolean(config && savedConfig !== JSON.stringify(config));
  const busy = saving || analyzing || syncing || Boolean(resolvingConflict);
  const reviewCount = analysis?.destinations.reduce((total, item) => total + item.conflicts, 0) || 0;

  return (
    <section className="google-agenda" aria-label="Integração com o Google Agenda" data-always-open={alwaysOpen}>
      <header className="ga-header">
        <div className="ga-heading"><span className="ga-brand"><CalendarSync size={24} /></span><div><span className="ga-eyebrow">CONEXÕES</span><h2>Google Agenda</h2><p>Organize como suas perícias aparecem em cada agenda.</p></div></div>
        {status?.connected && <span className="ga-status"><CheckCircle2 size={13} /> Conta conectada</span>}
      </header>
      {loading || !status || !config ? <div className="ga-loading" role="status"><RefreshCw size={19} className="animate-spin" /> Carregando suas agendas…</div>
        : !status.serverConfigured ? <div className="ga-empty"><CalendarSync size={28} /><h3>Integração ainda não configurada</h3><p>A conexão com o Google precisa ser habilitada no servidor para disponibilizar suas agendas.</p></div>
        : !status.connected ? <div className="ga-empty"><CalendarDays size={32} /><h3>Suas agendas, conectadas ao DisparaZap</h3><p>Autorize sua conta Google para vincular as perícias às agendas que você escolher.</p><Button onClick={() => { window.location.href = "/api/google-calendar/connect"; }}><ExternalLink size={16} /> Conectar conta Google</Button></div>
        : <>
          <div className="ga-account"><div><ShieldCheck size={17} /><span>{status.accountEmail || "Conta Google autorizada"}</span></div><Button variant="ghost" size="sm" onClick={disconnect} loading={disconnecting} disabled={busy}><Unplug size={14} /> Desconectar</Button></div>
          <div className="ga-toolbar">
            <div className="ga-toolbar-info"><strong>{config.destinations.filter(item => item.enabled && item.calendarId).length} destinos ativos</strong><span>{status.linkedEvents} eventos vinculados{status.syncErrors > 0 ? ` · ${status.syncErrors} com erro` : ""}</span></div>
            <div className="ga-actions"><Button variant="outline" size="sm" onClick={analyze} loading={analyzing} disabled={busy}><ListChecks size={16} /> Analisar agendas</Button><Button size="sm" onClick={sync} loading={syncing} disabled={!config.syncEnabled || busy}><RefreshCw size={15} /> Sincronizar agora</Button></div>
          </div>
          <div className="ga-automation"><div><strong>Sincronização automática</strong><p>Acompanhar criações, edições, reagendamentos e exclusões.</p></div><ToggleLine checked={config.syncEnabled} onChange={checked => { setConfig({ ...config, syncEnabled: checked }); setAnalysis(null); }}>{config.syncEnabled ? "Ativada" : "Pausada"}</ToggleLine></div>
          {syncing && <div className="ga-note" role="status"><RefreshCw size={17} className="animate-spin" /><p>Sincronizando no servidor. O resultado aparecerá assim que terminar.</p></div>}
          <div className="ga-tabs" aria-label="Área do Google Agenda">
            <button type="button" aria-pressed={view === "destinations"} onClick={() => setView("destinations")}><Settings2 size={16} /> Configurar destinos</button>
            <button type="button" aria-pressed={view === "analysis"} onClick={() => setView("analysis")}><ListChecks size={16} /> Análise e revisão{reviewCount > 0 && <span>{reviewCount}</span>}</button>
          </div>
          {view === "destinations" ? <div className="ga-destinations-view">
            <div className="ga-destinations-heading"><div><h3>Para onde os eventos vão</h3><p>Selecione um destino para ajustar suas regras.</p></div><Button variant="ghost" size="sm" onClick={addDestination} disabled={config.destinations.length >= 50 || busy}><Plus size={16} /> Adicionar destino</Button></div>
            {config.destinations.length === 0 ? <div className="ga-empty"><CalendarDays size={28} /><h3>Configure sua primeira agenda</h3><p>Adicione um destino para escolher a agenda e definir como os eventos aparecem.</p><Button variant="outline" onClick={addDestination}><Plus size={16} /> Adicionar primeiro destino</Button></div> : <>
              <div className="ga-destination-picker" aria-label="Destinos de sincronização">
                {config.destinations.map((item,index) => <button key={item.destination} type="button" className={`ga-destination ${activeIndex === index ? "is-selected" : ""}`} aria-pressed={activeIndex === index} onClick={() => setSelectedDestination(item.destination)}>
                  <div className="ga-destination-top"><span>DESTINO {String(index+1).padStart(2,"0")}</span><small className={item.enabled ? "is-enabled" : ""}>{item.enabled ? "Ativo" : "Pausado"}</small></div>
                  <strong>{item.name || `Destino ${item.destination}`}</strong><p><CalendarDays size={13} /><span>{item.calendarName || "Escolha uma agenda"}</span></p><footer><Clock3 size={12} />{timingSummary(item)}{activeIndex === index && <CheckCircle2 size={15} />}</footer>
                </button>)}
              </div>
              {activeDestination && <DestinationEditor key={activeDestination.destination} config={activeDestination} calendars={calendars} onChange={value => updateDestination(activeIndex,value)} onRemove={() => removeDestination(activeIndex)} />}
            </>}
          </div> : <div className="ga-analysis-view">
                      {analysis && (
            <div className="ga-analysis-results">
              <div className="ga-analysis-heading"><div><span className="ga-eyebrow">RESULTADO DA ANÁLISE</span><h3>{analysis.totalEvents} compromissos de hoje em diante</h3><p>Confira a situação em cada agenda e resolva os itens que precisam de escolha.</p></div></div>
              <div className="ga-analysis-destinations">
                {analysis.destinations.map((item) => {
                  const destination = config.destinations.find((candidate) => candidate.destination === item.destination);
                  return (
                    <div key={item.destination} className="ga-analysis-destination">
                      <div className="ga-result-title"><CalendarDays size={18} /><div><h4>{item.name}</h4><p>{item.calendarName}</p></div>{item.conflicts > 0 && <span className="ga-status is-warning">Revisão necessária</span>}</div>
                      <div className="ga-result-metrics">
                        <div><strong>{item.linked}</strong><span>Vinculados</span></div><div><strong>{item.matched}</strong><span>Encontrados</span></div><div><strong>{item.missing}</strong><span>Não encontrados</span></div><div className={item.conflicts ? "needs-review" : ""}><strong>{item.conflicts}</strong><span>Para revisão</span></div>
                      </div>
                      {item.missing > 0 && <p className="ga-help">{destination?.eventMode === "reuse_manual" ? "Os não encontrados aguardam um evento existente na agenda." : "Os não encontrados serão criados na próxima sincronização, se continuarem ausentes."}</p>}
                      {item.conflictItems.length > 0 && (
                        <div className="mt-3 space-y-3">
                          {item.conflictItems.map((conflict) => (
                            <div key={conflict.periciaId} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                              {conflict.duplicate && <p className="mb-2 font-semibold">Eventos repetidos — escolha qual manter</p>}
                              <p className="font-medium">Escolha o evento de #{conflict.periciaId} · {conflict.nome} · {conflict.data} {conflict.horario || ""}</p>
                              <div className="ga-conflict-candidates">
                                {conflict.candidates.map((candidate) => {
                                  const key = `${item.destination}:${conflict.periciaId}:${candidate.eventId}`;
                                  return (
                                    <button
                                      key={candidate.eventId}
                                      type="button"
                                      disabled={Boolean(resolvingConflict)}
                                      onClick={() => conflict.duplicate
                                        ? setDuplicateChoice({destination:item.destination,periciaId:conflict.periciaId,eventId:candidate.eventId,title:candidate.title,start:candidate.start,removeCount:conflict.candidates.length-1})
                                        : resolveConflict(item.destination, conflict.periciaId, candidate.eventId)}
                                      className="ga-conflict-candidate"
                                    >
                                      <span className="block font-medium text-zinc-900 dark:text-zinc-100">{candidate.title}</span>
                                      <span className="mt-1 block text-zinc-500 dark:text-zinc-400">
                                        {formatCandidateMoment(candidate.start)}{candidate.end ? ` · Fim: ${formatCandidateMoment(candidate.end)}` : ""}{candidate.location ? ` · ${candidate.location}` : ""}
                                      </span>
                                      <span className="mt-1 block font-medium text-blue-600 dark:text-blue-400">
                                        {resolvingConflict === key ? "Vinculando…" : conflict.duplicate ? "Manter este e remover as outras cópias" : "Usar este evento"}
                                      </span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}


            {!analysis && <div className="ga-empty"><ListChecks size={30} /><h3>Veja o que já está nas suas agendas</h3><p>A análise identifica eventos existentes e mostra as opções que precisam da sua revisão.</p><Button variant="outline" onClick={analyze} loading={analyzing} disabled={busy}><ListChecks size={16} /> Analisar agora</Button><small>A análise não altera os eventos.</small></div>}
          </div>}
          <footer className="ga-savebar"><div><span className={`ga-save-indicator ${dirty ? "is-dirty" : ""}`} /><span><strong>{dirty ? "Alterações não salvas" : "Configurações salvas"}</strong><small>As configurações de todos os destinos são salvas juntas.</small></span></div><Button size="sm" onClick={() => saveConfig()} loading={saving} disabled={!dirty || busy}><Save size={15} /> Salvar alterações</Button></footer>
        </>}
          <ConfirmDialog
      open={Boolean(duplicateChoice)}
      title="Resolver eventos repetidos?"
      message={`Manter “${duplicateChoice?.title || ""}”, com início em ${formatCandidateMoment(duplicateChoice?.start || "")}, e remover ${duplicateChoice?.removeCount || 0} outra(s) cópia(s) desta agenda? As próximas sincronizações usarão o evento escolhido.`}
      confirmLabel="Manter e remover cópias"
      loading={Boolean(resolvingConflict)}
      onCancel={() => { if (!resolvingConflict) setDuplicateChoice(null); }}
      onConfirm={() => { if (duplicateChoice) void resolveConflict(duplicateChoice.destination, duplicateChoice.periciaId, duplicateChoice.eventId, true); }}
    />
    </section>
  );
}
