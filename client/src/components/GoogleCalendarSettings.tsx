import { useCallback, useEffect, useState } from "react";
import { CalendarSync, CheckCircle2, ExternalLink, Link2, RefreshCw, ShieldCheck, Unplug } from "lucide-react";
import { api, ApiError } from "@/lib/api";
import type {
  GoogleCalendarAnalysis,
  GoogleCalendarConfig,
  GoogleCalendarDestinationConfig,
  GoogleCalendarListItem,
  GoogleCalendarStatus,
  GoogleCalendarSyncResult,
} from "@/lib/types";
import { useToast } from "@/components/ui/Toast";
import { CollapsibleCard } from "@/components/ui/CollapsibleCard";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { Input, Label } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";

function ToggleLine({
  checked,
  onChange,
  children,
}: {
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

function parseReminders(value: string): number[] {
  return Array.from(new Set(
    value
      .split(/[,;\s]+/)
      .map((item) => Number(item))
      .filter((item) => Number.isInteger(item) && item >= 0 && item <= 40_320)
  )).slice(0, 5);
}

function DestinationEditor({
  config,
  calendars,
  onChange,
}: {
  config: GoogleCalendarDestinationConfig;
  calendars: GoogleCalendarListItem[];
  onChange: (value: GoogleCalendarDestinationConfig) => void;
}) {
  const [remindersText, setRemindersText] = useState(config.reminderMinutes.join(", "));
  const update = <K extends keyof GoogleCalendarDestinationConfig>(key: K, value: GoogleCalendarDestinationConfig[K]) => {
    onChange({ ...config, [key]: value });
  };
  const selected = calendars.find((calendar) => calendar.id === config.calendarId);

  return (
    <div className="space-y-4 rounded-xl border border-zinc-200 bg-zinc-50/60 p-4 dark:border-zinc-800 dark:bg-zinc-900/40">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="font-medium text-zinc-900 dark:text-zinc-100">Destino {config.destination}</p>
          <p className="text-xs text-zinc-500">Configuração independente desta agenda</p>
        </div>
        <ToggleLine checked={config.enabled} onChange={(checked) => update("enabled", checked)}>Ativo</ToggleLine>
      </div>

      <div>
        <Label>Agenda do Google</Label>
        <Select
          value={config.calendarId}
          disabled={!config.enabled}
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
        <Label>Título do evento</Label>
        <Select value={config.titleFormat} disabled={!config.enabled} onChange={(event) => update("titleFormat", event.target.value as GoogleCalendarDestinationConfig["titleFormat"])}>
          <option value="tipo_nome">Tipo — Cliente</option>
          <option value="nome_tipo">Cliente — Tipo</option>
          <option value="somente_nome">Somente cliente</option>
          <option value="tipo_processo">Tipo — Processo</option>
        </Select>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Disponibilidade</Label>
          <Select value={config.transparency} disabled={!config.enabled} onChange={(event) => update("transparency", event.target.value as "opaque" | "transparent")}>
            <option value="opaque">Ocupado</option>
            <option value="transparent">Livre</option>
          </Select>
        </div>
        <div>
          <Label>Privacidade</Label>
          <Select value={config.visibility} disabled={!config.enabled} onChange={(event) => update("visibility", event.target.value as "default" | "private")}>
            <option value="default">Padrão da agenda</option>
            <option value="private">Privado</option>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <Label>Lembretes em minutos</Label>
          <Input
            disabled={!config.enabled}
            value={remindersText}
            onChange={(event) => setRemindersText(event.target.value)}
            onBlur={() => {
              const parsed = parseReminders(remindersText);
              setRemindersText(parsed.join(", "));
              update("reminderMinutes", parsed);
            }}
            placeholder="1440, 60"
          />
          <p className="mt-1 text-xs text-zinc-400">Ex.: 1440 = 1 dia; 60 = 1 hora. Até 5 avisos.</p>
        </div>
        <div>
          <Label>Cor no Google (opcional)</Label>
          <Select value={config.colorId} disabled={!config.enabled} onChange={(event) => update("colorId", event.target.value)}>
            <option value="">Padrão da agenda</option>
            {Array.from({ length: 11 }, (_, index) => String(index + 1)).map((color) => (
              <option key={color} value={color}>Cor {color}</option>
            ))}
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <ToggleLine checked={config.includeProcess} onChange={(checked) => update("includeProcess", checked)}>Incluir processo</ToggleLine>
        <ToggleLine checked={config.includePhone} onChange={(checked) => update("includePhone", checked)}>Incluir telefone</ToggleLine>
        <ToggleLine checked={config.includeProfessional} onChange={(checked) => update("includeProfessional", checked)}>Incluir profissional/perito</ToggleLine>
        <ToggleLine checked={config.includeLocation} onChange={(checked) => update("includeLocation", checked)}>Incluir local</ToggleLine>
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

  function updateDestination(index: 0 | 1, value: GoogleCalendarDestinationConfig) {
    if (!config) return;
    const destinations = [...config.destinations] as GoogleCalendarConfig["destinations"];
    destinations[index] = value;
    setConfig({ ...config, destinations });
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
      const response = await api.post<{ ok: true; result: GoogleCalendarSyncResult }>("/google-calendar/sync");
      const result = response.result;
      show(
        `Google Agenda atualizado: ${result.created} criado(s), ${result.linked} vinculado(s), ${result.updated} atualizado(s)${result.errors ? ` e ${result.errors} erro(s)` : ""}.`,
        result.errors ? "info" : "success"
      );
      setAnalysis(null);
      await load();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "Não foi possível sincronizar as agendas.", "error");
    } finally {
      setSyncing(false);
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

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <DestinationEditor config={config.destinations[0]} calendars={calendars} onChange={(value) => updateDestination(0, value)} />
            <DestinationEditor config={config.destinations[1]} calendars={calendars} onChange={(value) => updateDestination(1, value)} />
          </div>

          <div className="grid grid-cols-1 gap-4 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800 sm:grid-cols-[220px_1fr] sm:items-end">
            <div>
              <Label>Duração padrão</Label>
              <Input type="number" min={15} max={480} value={config.durationMinutes} onChange={(event) => setConfig({ ...config, durationMinutes: Number(event.target.value) })} />
              <p className="mt-1 text-xs text-zinc-400">Em minutos; usada para calcular o término.</p>
            </div>
            <ToggleLine checked={config.syncEnabled} onChange={(checked) => { setConfig({ ...config, syncEnabled: checked }); setAnalysis(null); }}>
              Sincronizar automaticamente novas criações, edições e exclusões
            </ToggleLine>
          </div>

          <div className="rounded-xl border border-blue-200 bg-blue-50/60 p-4 text-sm text-blue-800 dark:border-blue-900/60 dark:bg-blue-950/20 dark:text-blue-300">
            <p className="flex items-center gap-2 font-medium"><Link2 className="h-4 w-4" /> Primeira sincronização sem duplicidade</p>
            <p className="mt-1 text-xs leading-5 text-blue-700 dark:text-blue-400">
              A análise procura eventos já existentes pelo identificador, processo, cliente, data e horário. Correspondências seguras são vinculadas; casos ambíguos ficam sem alteração para revisão.
            </p>
          </div>

          {analysis && (
            <div className="space-y-3 rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
              <p className="font-medium text-zinc-900 dark:text-zinc-100">Resultado da análise — {analysis.totalEvents} compromisso(s) de hoje em diante</p>
              <div className="grid gap-3 lg:grid-cols-2">
                {analysis.destinations.map((item) => (
                  <div key={item.destination} className="rounded-lg bg-zinc-50 p-3 text-sm dark:bg-zinc-900">
                    <p className="font-medium">Destino {item.destination}: {item.calendarName}</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {item.linked} já vinculados · {item.matched} existentes encontrados · {item.missing} a criar · {item.conflicts} para revisão
                    </p>
                    {item.conflictItems.length > 0 && (
                      <details className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                        <summary className="cursor-pointer">Ver casos ambíguos</summary>
                        <ul className="mt-1 space-y-1 pl-4">
                          {item.conflictItems.map((conflict) => <li key={conflict.periciaId}>#{conflict.periciaId} · {conflict.nome} · {conflict.data} {conflict.horario || ""}</li>)}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
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
