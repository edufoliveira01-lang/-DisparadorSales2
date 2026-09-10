import { useCallback, useEffect, useState } from "react";
import {
  CalendarSync, CheckCircle2, ExternalLink, Link2, Plus,
  RefreshCw, ShieldCheck, Trash2, Unplug,
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
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { Badge } from "@/components/ui/Badge";
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
    <div className="flex items-center gap-2 text-sm text-zinc-600 dark:text-zinc-300">
      <Checkbox checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span>{children}</span>
    </div>
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
    createMissing: false,
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
    data: "14/10/2026",
    horario: "10:00",
    nome: "MÁRCIA APARECIDA CARVALHO NEVES",
    telefone: "(13) 99711-4872",
    whatsapp: "SIM",
    processo: "1003033-76.2025.8.26.0075",
    profissional: "PROFISSIONAL",
    local: "LOCAL DA PERÍCIA",
  };
  const rendered = config.titleTemplate.replace(
    /\{(tipo|data|horario|nome|telefone|processo|profissional|local)\}/gi,
    (_match, token: string) => values[token.toLowerCase()] || ""
  );
  return config.uppercaseTitle ? rendered.toLocaleUpperCase("pt-BR") : rendered;
}

function descriptionPreview(config: GoogleCalendarDestinationConfig): string {
  const values: Record<string, string> = {
    tipo: "PERÍCIA MÉDICA",
    data: "27/11/2026",
    horario: "12:00",
    local: "Rua Marrey Júnior, s/nº (entrada lateral do Fórum Central) - Sala 9E - Santos/SP",
    nome: "KARINA VIEIRA",
    telefone: "(11) 98893 - 5160",
    whatsapp: "SIM",
    processo: "1016617-71.2025.8.26.0477",
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

function DestinationEditor({ config, calendars, onChange, onRemove, isPrimary }: {
  config: GoogleCalendarDestinationConfig;
  calendars: GoogleCalendarListItem[];
  onChange: (value: GoogleCalendarDestinationConfig) => void;
  onRemove: () => void;
  isPrimary: boolean;
}) {
  const update = <K extends keyof GoogleCalendarDestinationConfig>(key: K, value: GoogleCalendarDestinationConfig[K]) => {
    onChange({ ...config, [key]: value });
  };
  const selected = calendars.find((calendar) => calendar.id === config.calendarId);

  return (
    <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <Label>Nome da configuração</Label>
          <Input value={config.name} onChange={(event) => update("name", event.target.value)} placeholder={`Destino ${config.destination}`} />
          {isPrimary && <p className="mt-1 text-xs text-blue-600 dark:text-blue-400">Destino principal: reaproveita o evento criado manualmente.</p>}
        </div>
        <div className="flex items-center gap-2 pt-7">
          <ToggleLine checked={config.enabled} onChange={(checked) => update("enabled", checked)}>Ativo</ToggleLine>
          <Button variant="ghost" size="icon" className="text-red-500 hover:text-red-600" onClick={onRemove} title="Remover configuração">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <div>
        <Label>Agenda do Google</Label>
        <Select
          value={config.calendarId}
          onChange={(event) => {
            const calendar = calendars.find((item) => item.id === event.target.value);
            onChange({ ...config, calendarId: event.target.value, calendarName: calendar?.summary || "" });
          }}
        >
          <option value="">Selecione uma agenda…</option>
          {config.calendarId && !selected && <option value={config.calendarId}>{config.calendarName || "Agenda selecionada"}</option>}
          {calendars.map((calendar) => (
            <option key={calendar.id} value={calendar.id}>
              {calendar.summary}{calendar.primary ? " (principal)" : ""}
            </option>
          ))}
        </Select>
      </div>

      <div>
        <Label>Modelo do título</Label>
        <Input value={config.titleTemplate} onChange={(event) => update("titleTemplate", event.target.value)} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {TEMPLATE_TOKENS.map((token) => (
            <button
              key={token}
              type="button"
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-500 hover:border-accent-400 hover:text-accent-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
              onClick={() => update("titleTemplate", `${config.titleTemplate}${config.titleTemplate ? " " : ""}${token}`)}
            >
              {token}
            </button>
          ))}
        </div>
        <p className="mt-2 break-words rounded-lg bg-white px-3 py-2 text-xs text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
          Prévia: {titlePreview(config)}
        </p>
        <div className="mt-2">
          <ToggleLine checked={config.uppercaseTitle} onChange={(checked) => update("uppercaseTitle", checked)}>Converter o título para maiúsculas</ToggleLine>
        </div>
      </div>

      <div>
        <Label>Quando o evento acontece</Label>
        <Select value={config.timingMode} onChange={(event) => update("timingMode", event.target.value as GoogleCalendarDestinationConfig["timingMode"])}>
          <option value="all_day">Dia inteiro — período configurável</option>
          <option value="fixed_time">Horário fixo</option>
          <option value="appointment_time">Data e horário da perícia</option>
        </Select>
      </div>

      {config.timingMode === "all_day" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label>Iniciar quantos dias antes</Label>
            <Input type="number" min={0} max={365} value={config.startDaysBefore} onChange={(event) => update("startDaysBefore", Number(event.target.value))} />
          </div>
          <div>
            <Label>Terminar quantos dias depois</Label>
            <Input type="number" min={0} max={365} value={config.endDaysAfter} onChange={(event) => update("endDaysAfter", Number(event.target.value))} />
            <p className="mt-1 text-xs text-zinc-400">Use 0 para terminar no próprio dia da perícia.</p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {config.timingMode === "fixed_time" && (
            <div>
              <Label>Horário fixo</Label>
              <Input type="time" value={config.fixedTime} onChange={(event) => update("fixedTime", event.target.value)} />
            </div>
          )}
          <div>
            <Label>Duração em minutos</Label>
            <Input type="number" min={5} max={1440} value={config.durationMinutes} onChange={(event) => update("durationMinutes", Number(event.target.value))} />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Disponibilidade</Label>
          <Select value={config.transparency} onChange={(event) => update("transparency", event.target.value as "opaque" | "transparent")}>
            <option value="opaque">Ocupado</option>
            <option value="transparent">Livre</option>
          </Select>
        </div>
        <div>
          <Label>Privacidade</Label>
          <Select value={config.visibility} onChange={(event) => update("visibility", event.target.value as "default" | "private")}>
            <option value="default">Padrão da agenda</option>
            <option value="private">Privado</option>
          </Select>
        </div>
        <div>
          <Label>Cor no Google (opcional)</Label>
          <Select value={config.colorId} onChange={(event) => update("colorId", event.target.value)}>
            <option value="">Padrão da agenda</option>
            {Array.from({ length: 11 }, (_, index) => String(index + 1)).map((color) => (
              <option key={color} value={color}>Cor {color}</option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label>Tratamento da descrição existente</Label>
        <Select
          value={config.descriptionMode}
          onChange={(event) => update("descriptionMode", event.target.value as GoogleCalendarDestinationConfig["descriptionMode"])}
        >
          <option value="preserve">Preservar e complementar (recomendado)</option>
          <option value="replace">Substituir pela descrição configurada</option>
          <option value="keep_original">Manter somente a descrição original</option>
        </Select>
        <p className="mt-1 text-xs text-zinc-400">
          No modo preservar, somente o bloco identificado do DisparaZap será atualizado nas próximas sincronizações.
        </p>
      </div>

      <div>
        <Label>Modelo da descrição</Label>
        <Textarea
          rows={10}
          value={config.descriptionTemplate}
          onChange={(event) => update("descriptionTemplate", event.target.value)}
          className="font-mono text-xs leading-5"
          disabled={config.descriptionMode === "keep_original"}
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {[...(config.descriptionMode === "preserve" ? [ORIGINAL_DESCRIPTION_TOKEN] : []), ...TEMPLATE_TOKENS].map((token) => (
            <button
              key={token}
              type="button"
              className="rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs text-zinc-500 hover:border-accent-400 hover:text-accent-600 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400"
              onClick={() => update("descriptionTemplate", `${config.descriptionTemplate}${config.descriptionTemplate ? "\n" : ""}${token}`)}
            >
              {token}
            </button>
          ))}
        </div>
        <p className="mt-2 text-xs text-zinc-400">
          {config.descriptionMode === "preserve"
            ? `Use ${ORIGINAL_DESCRIPTION_TOKEN} para escolher onde o texto original aparecerá. Sem a variável, ele ficará no início.`
            : config.descriptionMode === "replace"
              ? "A descrição atual será substituída integralmente por este modelo."
              : "A descrição do Google não será alterada pelo sistema."}
        </p>
        <pre className="mt-2 whitespace-pre-wrap break-words rounded-lg bg-white px-3 py-2 font-sans text-xs leading-5 text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400">
          {descriptionPreview(config)}
        </pre>
        <div className="mt-2">
        <ToggleLine checked={config.includeLocation} onChange={(checked) => update("includeLocation", checked)}>Preencher também o campo “Local” do Google</ToggleLine>
        </div>
      </div>

      <div className="space-y-2 rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-700 dark:bg-zinc-950">
        {isPrimary ? (
          <p className="text-xs leading-5 text-blue-700 dark:text-blue-400">
            Este destino nunca cria uma cópia: ele procura e vincula o evento manual pelo processo, nome, tipo e data.
          </p>
        ) : (
          <>
            <ToggleLine checked={config.createMissing} onChange={(checked) => update("createMissing", checked)}>
              Criar evento se nenhuma correspondência for encontrada
            </ToggleLine>
            <p className="text-xs leading-5 text-zinc-400">
              Ative para criar este evento adicional quando ele ainda não existir. Os lembretes do Google ficam desativados.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

export function GoogleCalendarSettings() {
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const nextStatus = await api.get<GoogleCalendarStatus>("/google-calendar/status");
      setStatus(nextStatus);
      setConfig(nextStatus.config);
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

  async function resolveConflict(destination: number, periciaId: number, googleEventId: string) {
    const key = `${destination}:${periciaId}:${googleEventId}`;
    setResolvingConflict(key);
    try {
      await api.post("/google-calendar/conflicts/resolve", { destination, periciaId, googleEventId });
      const nextAnalysis = await api.post<GoogleCalendarAnalysis>("/google-calendar/analyze");
      setAnalysis(nextAnalysis);
      show("Evento selecionado, vinculado e sincronizado. O sistema continuará usando esse mesmo evento.", "success");
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

  return (
    <CollapsibleCard
      icon={<CalendarSync className="h-4 w-4 text-blue-500" />}
      title="Integração com o Google Agenda"
      storageKey="google-calendar"
      headerExtra={status?.connected ? (
        <Badge tone={status.config.syncEnabled ? "success" : "info"}>
          <CheckCircle2 className="h-3.5 w-3.5" /> {status.config.syncEnabled ? "Sincronizando" : "Conectado"}
        </Badge>
      ) : undefined}
    >
      {loading || !status || !config ? (
        <div className="flex items-center gap-2 py-4 text-sm text-zinc-500"><RefreshCw className="h-4 w-4 animate-spin" /> Carregando integração…</div>
      ) : !status.serverConfigured ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-300">
          <p className="font-medium">Configuração única necessária no servidor</p>
          <p className="mt-1">Cadastre GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI e uma ENCRYPTION_KEY segura no arquivo de ambiente para liberar o botão de conexão.</p>
        </div>
      ) : !status.connected ? (
        <div className="space-y-4">
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Conecte sua conta com autorização oficial do Google. O DisparaZap terá acesso somente às agendas autorizadas e armazenará o token de renovação criptografado.
          </p>
          <Button onClick={() => { window.location.href = "/api/google-calendar/connect"; }}>
            <ExternalLink className="h-4 w-4" /> Conectar conta Google
          </Button>
        </div>
      ) : (
        <div className="space-y-5">
          <div className="flex flex-col gap-3 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4 dark:border-emerald-900/60 dark:bg-emerald-950/20 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="flex items-center gap-2 font-medium text-emerald-800 dark:text-emerald-300"><ShieldCheck className="h-4 w-4" /> Conta conectada</p>
              <p className="mt-1 text-sm text-emerald-700 dark:text-emerald-400">{status.accountEmail || "Conta Google autorizada"}</p>
            </div>
            <Button variant="outline" size="sm" onClick={disconnect} loading={disconnecting}><Unplug className="h-4 w-4" /> Desconectar</Button>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Destinos de sincronização</p>
              <p className="text-xs text-zinc-500">Adicione ou remova quantas configurações precisar. Cada destino funciona de forma independente.</p>
            </div>
            <Button variant="outline" size="sm" onClick={addDestination} disabled={config.destinations.length >= 50}>
              <Plus className="h-4 w-4" /> Adicionar destino
            </Button>
          </div>

          {syncing && (
            <div className="flex items-center gap-2 rounded-xl border border-blue-200 bg-blue-50/60 p-3 text-sm text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-300">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Sincronização em andamento no servidor. Esta tela mostrará o resultado assim que terminar.
            </div>
          )}

          {config.destinations.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 px-4 py-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
              Nenhum destino configurado. Clique em “Adicionar destino” para começar.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
              {config.destinations.map((destination, index) => (
                <DestinationEditor
                  key={destination.destination}
                  config={destination}
                  calendars={calendars}
                  isPrimary={destination.destination === config.destinations.find((item) => item.enabled && item.calendarId)?.destination}
                  onChange={(value) => updateDestination(index, value)}
                  onRemove={() => removeDestination(index)}
                />
              ))}
            </div>
          )}

          <div className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
            <ToggleLine checked={config.syncEnabled} onChange={(checked) => { setConfig({ ...config, syncEnabled: checked }); setAnalysis(null); }}>
              Sincronizar automaticamente criações, edições, reagendamentos e exclusões
            </ToggleLine>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-300">
            <p className="flex items-center gap-2 font-medium"><Link2 className="h-4 w-4" /> Vinculação segura, sem duplicidade</p>
            <p className="mt-1 text-xs leading-5 text-blue-700 dark:text-blue-400">
              O primeiro destino procura o evento manual principalmente pelo processo e confirma nome, tipo e data em uma faixa de sete dias. Os destinos seguintes criam apenas os eventos adicionais configurados. Casos ambíguos aguardam sua escolha e não geram cópias.
            </p>
          </div>

          {analysis && (
            <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Resultado da análise — {analysis.totalEvents} compromisso(s) de hoje em diante</p>
              <div className="grid gap-3 lg:grid-cols-2">
                {analysis.destinations.map((item) => {
                  const destination = config.destinations.find((candidate) => candidate.destination === item.destination);
                  const isPrimaryDestination = item.destination === config.destinations.find((candidate) => candidate.enabled && candidate.calendarId)?.destination;
                  return (
                    <div key={item.destination} className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
                      <p className="font-medium">{item.name}: {item.calendarName}</p>
                      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                        {item.linked} já vinculados · {item.matched} existentes encontrados · {item.missing} não encontrados {isPrimaryDestination ? "(aguardam evento manual)" : destination?.createMissing ? "(serão criados)" : "(não serão criados)"} · {item.conflicts} para revisão
                      </p>
                      {item.conflictItems.length > 0 && (
                        <div className="mt-3 space-y-3">
                          {item.conflictItems.map((conflict) => (
                            <div key={conflict.periciaId} className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200">
                              <p className="font-medium">Escolha o evento de #{conflict.periciaId} · {conflict.nome} · {conflict.data} {conflict.horario || ""}</p>
                              <div className="mt-2 space-y-2">
                                {conflict.candidates.map((candidate) => {
                                  const key = `${item.destination}:${conflict.periciaId}:${candidate.eventId}`;
                                  return (
                                    <button
                                      key={candidate.eventId}
                                      type="button"
                                      disabled={Boolean(resolvingConflict)}
                                      onClick={() => resolveConflict(item.destination, conflict.periciaId, candidate.eventId)}
                                      className="block w-full rounded-md border border-amber-200 bg-white p-2 text-left transition hover:border-blue-400 hover:bg-blue-50 disabled:cursor-wait disabled:opacity-60 dark:border-amber-900 dark:bg-zinc-950 dark:hover:border-blue-700 dark:hover:bg-blue-950/30"
                                    >
                                      <span className="block font-medium text-zinc-900 dark:text-zinc-100">{candidate.title}</span>
                                      <span className="mt-1 block text-zinc-500 dark:text-zinc-400">
                                        {formatCandidateMoment(candidate.start)}{candidate.location ? ` · ${candidate.location}` : ""}
                                      </span>
                                      <span className="mt-1 block font-medium text-blue-600 dark:text-blue-400">
                                        {resolvingConflict === key ? "Vinculando…" : "Usar este evento"}
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

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-zinc-400">
              {status.linkedEvents} vínculo(s) salvo(s){status.syncErrors ? ` · ${status.syncErrors} com erro` : ""}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => saveConfig()} loading={saving}>Salvar</Button>
              <Button variant="outline" onClick={analyze} loading={analyzing} disabled={saving}><RefreshCw className="h-4 w-4" /> Analisar agendas</Button>
              <Button onClick={sync} loading={syncing} disabled={!config.syncEnabled || saving}><CalendarSync className="h-4 w-4" /> Sincronizar agora</Button>
            </div>
          </div>
        </div>
      )}
    </CollapsibleCard>
  );
}
