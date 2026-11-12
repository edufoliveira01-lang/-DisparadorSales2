import { useCallback, useEffect, useState } from "react";
import {
  CalendarSync, CalendarDays, CheckCircle2, ChevronDown, Clock3, ExternalLink, FileText, ListChecks, Plus,
  RefreshCw, Settings2, SlidersHorizontal, Trash2, Unplug, Save,
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
import { Input, Textarea } from "@/components/ui/Input";
import { Badge } from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Skeleton";
import { EmptyState } from "@/components/ui/EmptyState";
import { Callout, SettingRow, SettingsBlock, SettingsFooter, SettingsPanel } from "@/components/ui/Settings";
import { cn } from "@/lib/utils";
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
  return <div className="flex flex-wrap items-center gap-1.5 text-xs" aria-label={`Inserir informação ${description ? "na descrição" : "no título"}`}>
    <span className="mr-1 text-zinc-500 dark:text-zinc-400">Inserir:</span>
    {[...(preserve ? [ORIGINAL_DESCRIPTION_TOKEN] : []), ...TEMPLATE_TOKENS].map(token => (
      <button key={token} type="button" title={token}
        aria-label={`Inserir ${TOKEN_LABELS[token]} ${description ? "na descrição" : "no título"}`}
        className="rounded-md border border-zinc-200 px-2 py-1 text-zinc-600 transition-colors hover:border-accent-300 hover:bg-accent-50 hover:text-accent-700 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-accent-900/30"
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
  const id0 = config.destination;
  const sections = [
    { id: "agenda", title: "Agenda e vínculo", summary: config.calendarName || "Escolha a agenda de destino", icon: CalendarDays },
    { id: "timing", title: "Data e horário", summary: timingSummary(config), icon: Clock3 },
    { id: "content", title: "Título e descrição", summary: config.descriptionMode === "keep_original" ? "Título personalizado · descrição original" : "Personalize as informações do evento", icon: FileText },
    { id: "options", title: "Opções avançadas: aparência e privacidade", summary: `${config.transparency === "opaque" ? "Ocupado" : "Livre"} · ${config.visibility === "private" ? "Privado" : "Padrão da agenda"}`, icon: SlidersHorizontal },
  ];
  return <div className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h3 className="min-w-0 break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">Regras de «{config.name || `Destino ${config.destination}`}»</h3>
      <ToggleLine checked={config.enabled} onChange={checked => update("enabled", checked)}>Destino ativo</ToggleLine>
    </div>
    <div className="divide-y divide-zinc-200 overflow-hidden rounded-xl border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
      {sections.map(({ id, title, summary, icon: Icon }) => <section key={id}>
        <button type="button" aria-expanded={openSection === id} aria-controls={`ga-${id0}-${id}`}
          className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-zinc-50 dark:hover:bg-zinc-800/40"
          onClick={() => setOpenSection(openSection === id ? "" : id)}>
          <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", openSection === id ? "bg-accent-50 text-accent-600 dark:bg-accent-900/30 dark:text-accent-300" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800")}><Icon size={16} /></span>
          <span className="min-w-0 flex-1"><strong className="block text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</strong><small className="block break-words text-xs text-zinc-500 dark:text-zinc-400">{summary}</small></span>
          <ChevronDown size={16} className={cn("shrink-0 text-zinc-400 transition-transform", openSection === id && "rotate-180")} />
        </button>
        {openSection === id && <div id={`ga-${id0}-${id}`} className="space-y-4 border-t border-zinc-100 px-4 py-4 dark:border-zinc-800">
          {id === "agenda" && <>
            <SettingRow label="Nome deste destino" htmlFor={`ga-name-${id0}`} hint="Só para você identificar.">
              <Input id={`ga-name-${id0}`} value={config.name} onChange={event => update("name", event.target.value)} placeholder="Ex.: Período da perícia" />
            </SettingRow>
            <SettingRow label="Agenda do Google" htmlFor={`ga-calendar-${id0}`} hint="Onde os eventos serão criados.">
              <Select id={`ga-calendar-${id0}`} value={config.calendarId} onChange={event => {
                const calendar = calendars.find(item => item.id === event.target.value);
                onChange({ ...config, calendarId: event.target.value, calendarName: calendar?.summary || "" });
              }}>
                <option value="">Selecione uma agenda…</option>
                {config.calendarId && !selected && <option value={config.calendarId}>{config.calendarName || "Agenda selecionada"}</option>}
                {calendars.map(calendar => <option key={calendar.id} value={calendar.id}>{calendar.summary}{calendar.primary ? " (principal)" : ""}</option>)}
              </Select>
            </SettingRow>
            <SettingRow label="Se o evento ainda não estiver na agenda" htmlFor={`ga-mode-${id0}`} hint={config.eventMode === "reuse_manual" ? "Só reaproveita eventos existentes; se não achar, aguarda sem criar cópia." : "Procura um evento correspondente e só cria se nenhum for encontrado."}>
              <Select id={`ga-mode-${id0}`} value={config.eventMode} onChange={event => update("eventMode", event.target.value as GoogleCalendarDestinationConfig["eventMode"])}>
                <option value="reuse_manual">Aguardar um evento existente</option><option value="create_additional">Criar somente se não encontrar um existente</option>
              </Select>
            </SettingRow>
            <Callout tone="info">A vinculação usa processo, nome, tipo e data. Havendo mais de uma possibilidade, você escolhe o evento na análise.</Callout>
          </>}
          {id === "timing" && <>
            <SettingRow label="Como exibir a perícia" htmlFor={`ga-timing-${id0}`}>
              <Select id={`ga-timing-${id0}`} value={config.timingMode} onChange={event => update("timingMode", event.target.value as GoogleCalendarDestinationConfig["timingMode"])}>
                <option value="all_day">Dia inteiro, com período configurável</option><option value="fixed_time">Em um horário fixo</option><option value="appointment_time">Na data e no horário da perícia</option>
              </Select>
            </SettingRow>
            {config.timingMode === "all_day" ? <>
              <SettingRow label="Começar quantos dias antes?" htmlFor={`ga-before-${id0}`} hint="Zero começa no próprio dia da perícia.">
                <Input id={`ga-before-${id0}`} type="number" min={0} max={365} value={config.startDaysBefore} onChange={event => update("startDaysBefore", Number(event.target.value))} />
              </SettingRow>
              <SettingRow label="Terminar quantos dias depois?" htmlFor={`ga-after-${id0}`} hint="Zero termina no próprio dia da perícia.">
                <Input id={`ga-after-${id0}`} type="number" min={0} max={365} value={config.endDaysAfter} onChange={event => update("endDaysAfter", Number(event.target.value))} />
              </SettingRow>
              <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-3 text-center text-xs text-zinc-500 dark:border-zinc-800 dark:bg-zinc-800/30 dark:text-zinc-400">
                <span>{config.startDaysBefore} dia(s) antes</span><i className="h-px min-w-3 flex-1 bg-zinc-300 dark:bg-zinc-600" /><strong className="rounded-md bg-accent-50 px-2 py-1 font-medium text-accent-700 dark:bg-accent-900/30 dark:text-accent-300">Dia da perícia</strong><i className="h-px min-w-3 flex-1 bg-zinc-300 dark:bg-zinc-600" /><span>{config.endDaysAfter ? `${config.endDaysAfter} dia(s) depois` : "Termina neste dia"}</span>
              </div>
            </> : <>
              {config.timingMode === "fixed_time" && <SettingRow label="Horário fixo" htmlFor={`ga-time-${id0}`}><Input id={`ga-time-${id0}`} type="time" value={config.fixedTime} onChange={event => update("fixedTime", event.target.value)} /></SettingRow>}
              <SettingRow label="Duração em minutos" htmlFor={`ga-duration-${id0}`}><Input id={`ga-duration-${id0}`} type="number" min={5} max={1440} value={config.durationMinutes} onChange={event => update("durationMinutes", Number(event.target.value))} /></SettingRow>
            </>}
          </>}
          {id === "content" && <>
            <SettingRow label="Modelo do título" htmlFor={`ga-title-${id0}`} hint="Clique nas informações para inseri-las.">
              <Input id={`ga-title-${id0}`} value={config.titleTemplate} onChange={event => update("titleTemplate", event.target.value)} />
              <TemplateTokens onInsert={token => update("titleTemplate", `${config.titleTemplate}${config.titleTemplate ? " " : ""}${token}`)} />
              <ToggleLine checked={config.uppercaseTitle} onChange={checked => update("uppercaseTitle", checked)}>Título em letras maiúsculas</ToggleLine>
            </SettingRow>
            <SettingRow label="Descrição que já existe" htmlFor={`ga-description-mode-${id0}`} hint={config.descriptionMode === "preserve" ? "Mantém as anotações originais e atualiza só o bloco do DisparaZap." : config.descriptionMode === "replace" ? "O conteúdo atual será substituído pelo modelo." : "A descrição do Google fica sem alterações."}>
              <Select id={`ga-description-mode-${id0}`} value={config.descriptionMode} onChange={event => update("descriptionMode", event.target.value as GoogleCalendarDestinationConfig["descriptionMode"])}>
                <option value="preserve">Preservar e complementar</option><option value="replace">Substituir pelo modelo abaixo</option><option value="keep_original">Manter somente a descrição original</option>
              </Select>
            </SettingRow>
            {config.descriptionMode !== "keep_original" && <SettingRow label="Modelo da descrição" htmlFor={`ga-description-${id0}`} hint={config.descriptionMode === "preserve" ? "Insira «Descrição original» para definir onde as anotações existentes aparecem." : undefined}>
              <Textarea id={`ga-description-${id0}`} rows={6} value={config.descriptionTemplate} onChange={event => update("descriptionTemplate", event.target.value)} className="font-mono text-xs leading-5" />
              <TemplateTokens description preserve={config.descriptionMode === "preserve"} onInsert={token => update("descriptionTemplate", `${config.descriptionTemplate}${config.descriptionTemplate ? "\n" : ""}${token}`)} />
            </SettingRow>}
            <div className="min-w-0 rounded-xl border border-zinc-200 border-l-4 border-l-accent-500 bg-zinc-50 p-4 dark:border-zinc-800 dark:border-l-accent-500 dark:bg-zinc-800/30">
              <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Prévia do evento (exemplo)</span>
              <h4 className="mt-2 break-words text-sm font-medium text-zinc-900 dark:text-zinc-100">{titlePreview(config)}</h4>
              <pre className="mt-3 max-h-52 overflow-y-auto whitespace-pre-wrap break-words border-t border-zinc-200 pt-3 font-sans text-xs leading-relaxed text-zinc-600 dark:border-zinc-700 dark:text-zinc-300">{descriptionPreview(config)}</pre>
            </div>
          </>}
          {id === "options" && <>
            <SettingRow label="Disponibilidade" htmlFor={`ga-availability-${id0}`} hint="Como o horário aparece para quem consulta sua agenda."><Select id={`ga-availability-${id0}`} value={config.transparency} onChange={event => update("transparency", event.target.value as "opaque" | "transparent")}><option value="opaque">Ocupado</option><option value="transparent">Livre</option></Select></SettingRow>
            <SettingRow label="Privacidade" htmlFor={`ga-privacy-${id0}`}><Select id={`ga-privacy-${id0}`} value={config.visibility} onChange={event => update("visibility", event.target.value as "default" | "private")}><option value="default">Padrão da agenda</option><option value="private">Privado</option></Select></SettingRow>
            <SettingRow label="Cor do evento no Google" htmlFor={`ga-color-${id0}`}><Select id={`ga-color-${id0}`} value={config.colorId} onChange={event => update("colorId", event.target.value)}><option value="">Padrão da agenda</option>{Array.from({ length:11 }, (_, index) => String(index+1)).map(color => <option key={color} value={color}>Cor {color}</option>)}</Select></SettingRow>
            <ToggleLine checked={config.includeLocation} onChange={checked => update("includeLocation", checked)}>Preencher o campo “Local” com o endereço da perícia</ToggleLine>
          </>}
        </div>}
      </section>)}
    </div>
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <span className="text-xs text-zinc-500 dark:text-zinc-400">As regras deste destino são independentes das outras agendas.</span>
      <Button variant="ghost" size="sm" onClick={onRemove} className="text-red-600 dark:text-red-400"><Trash2 size={14} /> Remover destino</Button>
    </div>
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


  const activeCount = config ? config.destinations.filter(item => item.enabled && item.calendarId).length : 0;
  const statusBadges = status?.connected ? <>
    <Badge tone="success"><CheckCircle2 className="h-3.5 w-3.5" /> Conectado{status.accountEmail ? ` · ${status.accountEmail}` : ""}</Badge>
    {config && <Badge tone={config.syncEnabled ? "info" : "neutral"}>{config.syncEnabled ? "Sincronização ativa" : "Sincronização pausada"}</Badge>}
  </> : status && status.serverConfigured ? <Badge tone="warning">Não conectado</Badge> : status ? <Badge tone="neutral">Indisponível</Badge> : undefined;
  const headerActions = status?.connected ? <Button variant="ghost" size="sm" onClick={disconnect} loading={disconnecting} disabled={busy}><Unplug size={14} /> Desconectar</Button> : undefined;

  return (
    <>
    <SettingsPanel icon={<CalendarSync />} title="Google Agenda" description="Organize como as perícias aparecem em cada agenda." status={statusBadges} actions={headerActions} className="min-w-0" >
      {loading || !status || !config ? <div role="status" aria-label="Carregando suas agendas" className="space-y-3 px-5 py-5"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-10 w-full" /><Skeleton className="h-24 w-full" /></div>
        : !status.serverConfigured ? <div className="px-5 py-5"><Callout tone="aviso">A conexão com o Google ainda não foi habilitada no servidor. Peça ao administrador para configurá-la; depois as suas agendas aparecem aqui.</Callout></div>
        : !status.connected ? <div className="px-5 py-5"><EmptyState icon={CalendarDays} title="Conecte sua conta Google" description="Autorize o acesso para vincular as perícias às agendas que você escolher." action={<Button onClick={() => { window.location.href = "/api/google-calendar/connect"; }}><ExternalLink size={16} /> Conectar conta Google</Button>} /></div>
        : <>
          <SettingsBlock title="Sincronização" description={`${activeCount} destino(s) ativo(s) · ${status.linkedEvents} evento(s) vinculado(s)${status.syncErrors > 0 ? ` · ${status.syncErrors} com erro` : ""}`}>
            <SettingRow label="Sincronização automática" hint="Acompanha criações, edições, reagendamentos e exclusões.">
              <ToggleLine checked={config.syncEnabled} onChange={checked => { setConfig({ ...config, syncEnabled: checked }); setAnalysis(null); }}>{config.syncEnabled ? "Ativada" : "Pausada"}</ToggleLine>
            </SettingRow>
            {status.syncErrors > 0 && <Callout tone="erro">{status.syncErrors} evento(s) com erro na última sincronização. Use Analisar agendas para ver a situação.</Callout>}
            {syncing && <Callout tone="info">Sincronizando no servidor. O resultado aparece assim que terminar.</Callout>}
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={analyze} loading={analyzing} disabled={busy}><ListChecks size={16} /> Analisar agendas</Button>
              <Button size="sm" onClick={sync} loading={syncing} disabled={!config.syncEnabled || busy}><RefreshCw size={15} /> Sincronizar agora</Button>
            </div>
          </SettingsBlock>

          <div className="flex gap-1 border-b border-zinc-200 px-5 pt-2 dark:border-zinc-800" role="group" aria-label="Área do Google Agenda">
            {([["destinations", "Configurar destinos", Settings2], ["analysis", "Análise e revisão", ListChecks]] as const).map(([key, label, Icon]) => (
              <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}
                className={cn("-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors", view === key ? "border-accent-500 text-accent-700 dark:text-accent-300" : "border-transparent text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200")}>
                <Icon size={16} /> {label}{key === "analysis" && reviewCount > 0 && <Badge tone="warning">{reviewCount}</Badge>}
              </button>
            ))}
          </div>

          {view === "destinations" ? <SettingsBlock title="Para onde os eventos vão" description="Selecione um destino para ajustar suas regras.">
            <div className="flex justify-end -mt-2">
              <Button variant="outline" size="sm" onClick={addDestination} disabled={config.destinations.length >= 50 || busy}><Plus size={16} /> Adicionar destino</Button>
            </div>
            {config.destinations.length === 0 ? <EmptyState icon={CalendarDays} title="Configure sua primeira agenda" description="Adicione um destino para escolher a agenda e definir como os eventos aparecem." action={<Button variant="outline" onClick={addDestination}><Plus size={16} /> Adicionar primeiro destino</Button>} /> : <>
              <div className="grid max-h-80 gap-3 overflow-y-auto p-0.5 sm:grid-cols-2 xl:grid-cols-3" aria-label="Destinos de sincronização">
                {config.destinations.map((item, index) => <button key={item.destination} type="button" aria-pressed={activeIndex === index} onClick={() => setSelectedDestination(item.destination)}
                  className={cn("min-w-0 rounded-xl border p-3 text-left transition-colors", activeIndex === index ? "border-accent-500 bg-accent-50/60 dark:bg-accent-900/20" : "border-zinc-200 hover:bg-zinc-50 dark:border-zinc-700 dark:hover:bg-zinc-800/40")}>
                  <div className="flex items-center justify-between gap-2"><span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Destino {String(index + 1).padStart(2, "0")}</span><Badge tone={item.enabled ? "success" : "neutral"}>{item.enabled ? "Ativo" : "Pausado"}</Badge></div>
                  <strong className="mt-2 block break-words text-sm font-semibold text-zinc-900 dark:text-zinc-100">{item.name || `Destino ${item.destination}`}</strong>
                  <p className="mt-1 flex items-start gap-1.5 text-xs text-zinc-500 dark:text-zinc-400"><CalendarDays size={13} className="mt-0.5 shrink-0" /><span className="break-words">{item.calendarName || "Escolha uma agenda"}</span></p>
                  <p className="mt-2 flex items-center gap-1.5 border-t border-zinc-100 pt-2 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"><Clock3 size={12} />{timingSummary(item)}</p>
                </button>)}
              </div>
              {activeDestination && <DestinationEditor key={activeDestination.destination} config={activeDestination} calendars={calendars} onChange={value => updateDestination(activeIndex, value)} onRemove={() => removeDestination(activeIndex)} />}
            </>}
          </SettingsBlock> : <SettingsBlock>
            {analysis ? <>
              <div><h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{analysis.totalEvents} compromissos de hoje em diante</h3><p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">Confira a situação em cada agenda e resolva os itens que precisam de escolha.</p></div>
              <div className="space-y-4">
                {analysis.destinations.map((item) => {
                  const destination = config.destinations.find((candidate) => candidate.destination === item.destination);
                  return (
                    <div key={item.destination} className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
                      <div className="flex flex-wrap items-center gap-2"><CalendarDays size={18} className="shrink-0 text-accent-600" /><div className="min-w-0 flex-1"><h4 className="break-words text-sm font-medium">{item.name}</h4><p className="break-words text-xs text-zinc-500 dark:text-zinc-400">{item.calendarName}</p></div>{item.conflicts > 0 && <Badge tone="warning">Revisão necessária</Badge>}</div>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        {([["Vinculados", item.linked, false], ["Encontrados", item.matched, false], ["Não encontrados", item.missing, false], ["Para revisão", item.conflicts, item.conflicts > 0]] as const).map(([label, value, alert]) => (
                          <div key={label} className={cn("rounded-lg p-2.5", alert ? "bg-amber-50 text-amber-800 dark:bg-amber-950/30 dark:text-amber-200" : "bg-zinc-50 dark:bg-zinc-800/40")}><strong className="block text-xl font-semibold">{value}</strong><span className="text-xs text-zinc-500 dark:text-zinc-400">{label}</span></div>
                        ))}
                      </div>
                      {item.missing > 0 && <p className="text-xs text-zinc-500 dark:text-zinc-400">{destination?.eventMode === "reuse_manual" ? "Os não encontrados aguardam um evento existente na agenda." : "Os não encontrados serão criados na próxima sincronização, se continuarem ausentes."}</p>}
                      {item.conflictItems.length > 0 && (
                        <div className="space-y-3">
                          {item.conflictItems.map((conflict) => (
                            <div key={conflict.periciaId} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                              {conflict.duplicate && <p className="mb-2 font-semibold">Eventos repetidos — escolha qual manter</p>}
                              <p className="font-medium">Escolha o evento de #{conflict.periciaId} · {conflict.nome} · {conflict.data} {conflict.horario || ""}</p>
                              <div className="mt-3 grid gap-2 sm:grid-cols-2">
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
                                      className="min-w-0 break-words rounded-lg border border-amber-200 bg-white p-3 text-left text-xs transition-colors hover:border-accent-400 hover:bg-accent-50 disabled:cursor-wait disabled:opacity-60 dark:border-amber-900/60 dark:bg-zinc-900 dark:hover:bg-accent-900/20"
                                    >
                                      <span className="block font-medium text-zinc-900 dark:text-zinc-100">{candidate.title}</span>
                                      <span className="mt-1 block text-zinc-500 dark:text-zinc-400">
                                        {formatCandidateMoment(candidate.start)}{candidate.end ? ` · Fim: ${formatCandidateMoment(candidate.end)}` : ""}{candidate.location ? ` · ${candidate.location}` : ""}
                                      </span>
                                      <span className="mt-1 block font-medium text-accent-600 dark:text-accent-300">
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
            </> : <EmptyState icon={ListChecks} title="Veja o que já está nas suas agendas" description="A análise identifica eventos existentes e mostra o que precisa da sua revisão. Ela não altera nenhum evento." action={<Button variant="outline" onClick={analyze} loading={analyzing} disabled={busy}><ListChecks size={16} /> Analisar agora</Button>} />}
          </SettingsBlock>}

          <SettingsFooter left={<span className="inline-flex items-center gap-2"><span className={cn("h-2 w-2 rounded-full", dirty ? "bg-amber-500" : "bg-emerald-500")} /><span><strong className="font-medium">{dirty ? "Alterações não salvas" : "Configurações salvas"}</strong> · os destinos são salvos juntos.</span></span>}>
            <Button size="sm" onClick={() => saveConfig()} loading={saving} disabled={!dirty || busy}><Save size={15} /> Salvar alterações</Button>
          </SettingsFooter>
        </>}
    </SettingsPanel>
    <ConfirmDialog
      open={Boolean(duplicateChoice)}
      title="Resolver eventos repetidos?"
      message={`Manter “${duplicateChoice?.title || ""}”, com início em ${formatCandidateMoment(duplicateChoice?.start || "")}, e remover ${duplicateChoice?.removeCount || 0} outra(s) cópia(s) desta agenda? As próximas sincronizações usarão o evento escolhido.`}
      confirmLabel="Manter e remover cópias"
      loading={Boolean(resolvingConflict)}
      onCancel={() => { if (!resolvingConflict) setDuplicateChoice(null); }}
      onConfirm={() => { if (duplicateChoice) void resolveConflict(duplicateChoice.destination, duplicateChoice.periciaId, duplicateChoice.eventId, true); }}
    />
    </>
  );
}
