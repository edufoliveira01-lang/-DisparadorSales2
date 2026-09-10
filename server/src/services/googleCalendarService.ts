import crypto from "node:crypto";
import { db } from "../db";
import { deleteSetting, getSetting, setSetting } from "./settingsService";
import { recordSystemLog } from "./systemLogsService";
import type { PericiaAgendada } from "./periciasAgendadasService";

const GOOGLE_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const GOOGLE_USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const TIME_ZONE = "America/Sao_Paulo";
const CONFIG_KEY = "google_calendar_config";

export type GoogleCalendarTimingMode = "all_day" | "fixed_time" | "appointment_time";

export interface GoogleCalendarDestinationConfig {
  destination: number;
  name: string;
  enabled: boolean;
  calendarId: string;
  calendarName: string;
  titleTemplate: string;
  descriptionTemplate: string;
  uppercaseTitle: boolean;
  timingMode: GoogleCalendarTimingMode;
  startDaysBefore: number;
  endDaysAfter: number;
  fixedTime: string;
  durationMinutes: number;
  createMissing: boolean;
  includePhone: boolean;
  includeProcess: boolean;
  includeProfessional: boolean;
  includeLocation: boolean;
  visibility: "default" | "private";
  transparency: "opaque" | "transparent";
  colorId: string;
}

export interface GoogleCalendarConfig {
  syncEnabled: boolean;
  destinations: GoogleCalendarDestinationConfig[];
}

export interface GoogleCalendarListItem {
  id: string;
  summary: string;
  primary: boolean;
  accessRole: string;
  backgroundColor?: string;
}

interface GoogleCalendarEvent {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  extendedProperties?: { private?: Record<string, string> };
}

interface GoogleEventListResponse {
  items?: GoogleCalendarEvent[];
  nextPageToken?: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

interface GoogleEventLink {
  pericia_id: number;
  destination: number;
  calendar_id: string;
  google_event_id: string;
  sync_status: "sincronizado" | "pendente" | "erro";
  last_error: string | null;
}

export interface GoogleCalendarAnalysisDestination {
  destination: number;
  name: string;
  calendarName: string;
  total: number;
  linked: number;
  matched: number;
  missing: number;
  conflicts: number;
  conflictItems: Array<{ periciaId: number; nome: string; data: string; horario: string | null }>;
}

export interface GoogleCalendarAnalysis {
  totalEvents: number;
  destinations: GoogleCalendarAnalysisDestination[];
}

export interface GoogleCalendarSyncResult {
  total: number;
  linked: number;
  created: number;
  updated: number;
  deleted: number;
  skipped: number;
  conflicts: number;
  errors: number;
}

export class GoogleCalendarError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

export const DEFAULT_GOOGLE_CALENDAR_TITLE_TEMPLATE = "{tipo} - {data} - {horario} - {nome} - {telefone} - {processo}";
export const DEFAULT_GOOGLE_CALENDAR_DESCRIPTION_TEMPLATE = [
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

const DEFAULT_DESTINATION = (destination: number): GoogleCalendarDestinationConfig => ({
  destination,
  name: destination === 1 ? "Período da perícia" : destination === 2 ? "Compromisso das 23h" : `Destino ${destination}`,
  enabled: destination === 1,
  calendarId: "",
  calendarName: "",
  titleTemplate: DEFAULT_GOOGLE_CALENDAR_TITLE_TEMPLATE,
  descriptionTemplate: DEFAULT_GOOGLE_CALENDAR_DESCRIPTION_TEMPLATE,
  uppercaseTitle: true,
  timingMode: destination === 1 ? "all_day" : destination === 2 ? "fixed_time" : "appointment_time",
  startDaysBefore: destination === 1 ? 5 : 0,
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
});

export const DEFAULT_GOOGLE_CALENDAR_CONFIG: GoogleCalendarConfig = {
  syncEnabled: false,
  destinations: [DEFAULT_DESTINATION(1), DEFAULT_DESTINATION(2)],
};

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

function normalizeText(value: string | null | undefined): string {
  return (value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function parseJson<T>(value: string | null): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function clampedInteger(value: unknown, minimum: number, maximum: number, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) return fallback;
  return parsed;
}

function validTime(value: unknown, fallback = "23:00"): string {
  if (typeof value !== "string" || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) return fallback;
  return value;
}

function sanitizeDestination(
  value: Partial<GoogleCalendarDestinationConfig> | undefined,
  destination: number,
  legacyDuration = 60
): GoogleCalendarDestinationConfig {
  const fallback = DEFAULT_DESTINATION(destination);
  const timingModes: GoogleCalendarTimingMode[] = ["all_day", "fixed_time", "appointment_time"];
  const titleTemplate = typeof value?.titleTemplate === "string" && value.titleTemplate.trim()
    ? value.titleTemplate.trim().slice(0, 500)
    : fallback.titleTemplate;
  const descriptionTemplate = typeof value?.descriptionTemplate === "string" && value.descriptionTemplate.trim()
    ? value.descriptionTemplate.trim().slice(0, 4_000)
    : fallback.descriptionTemplate;

  return {
    destination,
    name: typeof value?.name === "string" && value.name.trim() ? value.name.trim().slice(0, 100) : fallback.name,
    enabled: value?.enabled === true,
    calendarId: typeof value?.calendarId === "string" ? value.calendarId.trim().slice(0, 500) : "",
    calendarName: typeof value?.calendarName === "string" ? value.calendarName.trim().slice(0, 200) : "",
    titleTemplate,
    descriptionTemplate,
    uppercaseTitle: value?.uppercaseTitle !== false,
    timingMode: timingModes.includes(value?.timingMode as GoogleCalendarTimingMode)
      ? (value?.timingMode as GoogleCalendarTimingMode)
      : fallback.timingMode,
    startDaysBefore: clampedInteger(value?.startDaysBefore, 0, 365, fallback.startDaysBefore),
    endDaysAfter: clampedInteger(value?.endDaysAfter, 0, 365, fallback.endDaysAfter),
    fixedTime: validTime(value?.fixedTime, fallback.fixedTime),
    durationMinutes: clampedInteger(value?.durationMinutes, 5, 1440, legacyDuration),
    createMissing: value?.createMissing === true,
    includePhone: value?.includePhone !== false,
    includeProcess: value?.includeProcess !== false,
    includeProfessional: value?.includeProfessional !== false,
    includeLocation: value?.includeLocation !== false,
    visibility: value?.visibility === "private" ? "private" : "default",
    transparency: value?.transparency === "transparent" ? "transparent" : "opaque",
    colorId: typeof value?.colorId === "string" && /^([1-9]|1[01])$/.test(value.colorId) ? value.colorId : "",
  };
}

export function getGoogleCalendarConfig(): GoogleCalendarConfig {
  const saved = parseJson<Partial<GoogleCalendarConfig> & { durationMinutes?: number }>(getSetting(CONFIG_KEY));
  const legacyDuration = clampedInteger(saved?.durationMinutes, 5, 1440, 60);
  const inputDestinations = Array.isArray(saved?.destinations)
    ? saved.destinations.slice(0, 50)
    : DEFAULT_GOOGLE_CALENDAR_CONFIG.destinations;
  const used = new Set<number>();
  const destinations = inputDestinations.map((item, index) => {
    let destination = clampedInteger(item?.destination, 1, 2_147_483_647, index + 1);
    while (used.has(destination)) destination += 1;
    used.add(destination);
    return sanitizeDestination(item, destination, legacyDuration);
  });
  return {
    syncEnabled: saved?.syncEnabled === true,
    destinations,
  };
}

export function saveGoogleCalendarConfig(input: Partial<GoogleCalendarConfig>): GoogleCalendarConfig {
  if (!Array.isArray(input.destinations) || input.destinations.length > 50) {
    throw new GoogleCalendarError("Informe no máximo 50 destinos de sincronização.", 400);
  }
  const ids = input.destinations.map((item) => Number(item?.destination));
  if (ids.some((id) => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) {
    throw new GoogleCalendarError("Os identificadores dos destinos são inválidos ou repetidos.", 400);
  }
  const config: GoogleCalendarConfig = {
    syncEnabled: input.syncEnabled === true,
    destinations: input.destinations.map((item) => sanitizeDestination(item, Number(item.destination))),
  };
  const enabled = config.destinations.filter((item) => item.enabled);
  if (config.syncEnabled && enabled.length === 0) {
    throw new GoogleCalendarError("Ative pelo menos uma agenda de destino.", 400);
  }
  if (enabled.some((item) => !item.calendarId)) {
    throw new GoogleCalendarError("Selecione uma agenda para cada destino ativo.", 400);
  }
  if (new Set(enabled.map((item) => item.calendarId)).size !== enabled.length) {
    throw new GoogleCalendarError("Cada destino ativo deve usar uma agenda diferente para evitar eventos duplicados.", 400);
  }
  if (config.syncEnabled && !getSetting("google_refresh_token")) {
    throw new GoogleCalendarError("Conecte sua conta Google antes de ativar a sincronização.", 400);
  }

  setSetting(CONFIG_KEY, JSON.stringify(config));
  if (config.destinations.length === 0) {
    db.prepare("DELETE FROM google_calendar_event_links").run();
  } else {
    const placeholders = config.destinations.map(() => "?").join(",");
    db.prepare(`DELETE FROM google_calendar_event_links WHERE destination NOT IN (${placeholders})`)
      .run(...config.destinations.map((item) => item.destination));
  }
  recordSystemLog({
    nivel: "info",
    categoria: "google_calendar",
    evento: "configuracao_salva",
    titulo: "Configuração do Google Agenda atualizada",
    origem: "usuario",
    detalhes: {
      sincronizacaoAtiva: config.syncEnabled,
      agendas: enabled.map((item) => ({ destino: item.destination, nome: item.calendarName })),
    },
  });
  return config;
}

export function googleOAuthServerConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.ENCRYPTION_KEY);
}

function googleCredentials(): { clientId: string; clientSecret: string } {
  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  if (!clientId || !clientSecret || !process.env.ENCRYPTION_KEY) {
    throw new GoogleCalendarError("A integração ainda não foi habilitada no servidor. Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e ENCRYPTION_KEY.", 503);
  }
  return { clientId, clientSecret };
}

export function buildGoogleAuthorizationUrl(state: string, redirectUri: string): string {
  const { clientId } = googleCredentials();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    state,
    scope: [
      "openid",
      "email",
      "https://www.googleapis.com/auth/calendar.calendarlist.readonly",
      "https://www.googleapis.com/auth/calendar.events",
    ].join(" "),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? parseJson<T>(text) : null;
  if (!response.ok) {
    const errorBody = body as { error?: { message?: string } | string; error_description?: string } | null;
    const googleMessage = typeof errorBody?.error === "object" ? errorBody.error.message : errorBody?.error;
    throw new GoogleCalendarError(googleMessage || errorBody?.error_description || `O Google respondeu com HTTP ${response.status}.`, response.status);
  }
  return (body || {}) as T;
}

export async function exchangeGoogleAuthorizationCode(code: string, redirectUri: string): Promise<void> {
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
  });
  const token = await readJsonResponse<GoogleTokenResponse>(response);
  if (!token.access_token) throw new GoogleCalendarError("O Google não retornou um token de acesso.");
  const previousRefreshToken = getSetting("google_refresh_token");
  const refreshToken = token.refresh_token || previousRefreshToken;
  if (!refreshToken) {
    throw new GoogleCalendarError("O Google não retornou a autorização permanente. Desconecte o acesso nas configurações da conta Google e tente novamente.");
  }
  setSetting("google_refresh_token", refreshToken);
  cachedAccessToken = { token: token.access_token, expiresAt: Date.now() + Math.max(60, (token.expires_in || 3600) - 60) * 1000 };

  const profileResponse = await fetch(GOOGLE_USERINFO_URL, { headers: { Authorization: `Bearer ${token.access_token}` } });
  if (profileResponse.ok) {
    const profile = await profileResponse.json() as { email?: string };
    if (profile.email) setSetting("google_account_email", profile.email);
  }
  recordSystemLog({
    nivel: "info",
    categoria: "google_calendar",
    evento: "conta_conectada",
    titulo: "Conta Google conectada",
    mensagem: getSetting("google_account_email"),
    origem: "usuario",
  });
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) return cachedAccessToken.token;
  const refreshToken = getSetting("google_refresh_token");
  if (!refreshToken) throw new GoogleCalendarError("A conta Google não está conectada.", 401);
  const { clientId, clientSecret } = googleCredentials();
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const token = await readJsonResponse<GoogleTokenResponse>(response);
  if (!token.access_token) throw new GoogleCalendarError("Não foi possível renovar o acesso ao Google Agenda.", 401);
  cachedAccessToken = { token: token.access_token, expiresAt: Date.now() + Math.max(60, (token.expires_in || 3600) - 60) * 1000 };
  return token.access_token;
}

async function googleRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken();
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body) headers.set("Content-Type", "application/json");
  const response = await fetch(`${GOOGLE_API}${path}`, { ...init, headers });
  if (response.status === 401) {
    cachedAccessToken = null;
  }
  return readJsonResponse<T>(response);
}

export async function disconnectGoogleCalendar(): Promise<void> {
  const refreshToken = getSetting("google_refresh_token");
  if (refreshToken) {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: "POST" }).catch(() => undefined);
  }
  cachedAccessToken = null;
  deleteSetting("google_refresh_token");
  deleteSetting("google_account_email");
  const config = getGoogleCalendarConfig();
  config.syncEnabled = false;
  setSetting(CONFIG_KEY, JSON.stringify(config));
  recordSystemLog({
    nivel: "info",
    categoria: "google_calendar",
    evento: "conta_desconectada",
    titulo: "Conta Google desconectada",
    origem: "usuario",
  });
}

export function getGoogleCalendarStatus() {
  const config = getGoogleCalendarConfig();
  const stats = db.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN sync_status = 'erro' THEN 1 ELSE 0 END) AS errors,
       MAX(synced_at) AS lastSync
     FROM google_calendar_event_links`
  ).get() as { total: number; errors: number | null; lastSync: string | null };
  return {
    serverConfigured: googleOAuthServerConfigured(),
    connected: Boolean(getSetting("google_refresh_token")),
    accountEmail: getSetting("google_account_email"),
    config,
    linkedEvents: stats.total || 0,
    syncErrors: stats.errors || 0,
    lastSync: stats.lastSync,
  };
}

export async function listWritableGoogleCalendars(): Promise<GoogleCalendarListItem[]> {
  const items: GoogleCalendarListItem[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({ minAccessRole: "writer", maxResults: "250" });
    if (pageToken) params.set("pageToken", pageToken);
    const result = await googleRequest<{ items?: Array<{ id: string; summary?: string; primary?: boolean; accessRole?: string; backgroundColor?: string }>; nextPageToken?: string }>(
      `/users/me/calendarList?${params.toString()}`
    );
    for (const item of result.items || []) {
      items.push({
        id: item.id,
        summary: item.summary || item.id,
        primary: item.primary === true,
        accessRole: item.accessRole || "writer",
        backgroundColor: item.backgroundColor,
      });
    }
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  return items.sort((a, b) => Number(b.primary) - Number(a.primary) || a.summary.localeCompare(b.summary, "pt-BR"));
}

function eventDateKey(pericia: PericiaAgendada): string {
  const match = pericia.data.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) throw new GoogleCalendarError(`Data inválida no compromisso #${pericia.id}.`, 400);
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addWallClockMinutes(ymd: string, time: string, minutes: number): { ymd: string; time: string } {
  const [year, month, day] = ymd.split("-").map(Number);
  const [hour, minute] = time.split(":").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day, hour, minute + minutes));
  return {
    ymd: `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`,
    time: `${String(result.getUTCHours()).padStart(2, "0")}:${String(result.getUTCMinutes()).padStart(2, "0")}`,
  };
}

function addDays(ymd: string, days: number): string {
  const [year, month, day] = ymd.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

function googleTemplateValues(pericia: PericiaAgendada): Record<string, string> {
  const telefone = (pericia.telefone || "").replace(/\s*-\s*(?=\d{4}\s*$)/, " - ");
  return {
    tipo: (pericia.tipo || "").toLocaleUpperCase("pt-BR"),
    data: pericia.data || "",
    horario: pericia.horario || "",
    nome: (pericia.nome || "").toLocaleUpperCase("pt-BR"),
    telefone,
    whatsapp: (pericia.whatsapp || "").toLocaleUpperCase("pt-BR"),
    processo: pericia.processo || "",
    profissional: (pericia.profissional_perito || "").toLocaleUpperCase("pt-BR"),
    local: pericia.local || "",
  };
}

function renderGoogleTemplate(template: string, pericia: PericiaAgendada): string {
  const values = googleTemplateValues(pericia);
  return template.replace(
    /\{(tipo|data|horario|nome|telefone|whatsapp|processo|profissional|local)\}/gi,
    (_match, token: string) => values[token.toLowerCase()] || ""
  );
}

function titleFor(pericia: PericiaAgendada, destination: GoogleCalendarDestinationConfig): string {
  const rendered = renderGoogleTemplate(destination.titleTemplate, pericia).replace(/\s+/g, " ").trim();
  const title = rendered || `${pericia.tipo} - ${pericia.nome}`;
  return destination.uppercaseTitle ? title.toLocaleUpperCase("pt-BR") : title;
}

function eventTiming(
  pericia: PericiaAgendada,
  destination: GoogleCalendarDestinationConfig
): Pick<GoogleCalendarEvent, "start" | "end"> {
  const ymd = eventDateKey(pericia);
  if (destination.timingMode === "all_day") {
    return {
      start: { date: addDays(ymd, -destination.startDaysBefore) },
      // A data final de eventos de dia inteiro no Google é exclusiva. Somamos um dia
      // para que "0 dias depois" ainda inclua integralmente o dia da perícia.
      end: { date: addDays(ymd, destination.endDaysAfter + 1) },
    };
  }

  const time = destination.timingMode === "fixed_time"
    ? destination.fixedTime
    : pericia.horario;
  if (!time) {
    return { start: { date: ymd }, end: { date: addDays(ymd, 1) } };
  }
  const end = addWallClockMinutes(ymd, time, destination.durationMinutes);
  return {
    start: { dateTime: `${ymd}T${time}:00-03:00`, timeZone: TIME_ZONE },
    end: { dateTime: `${end.ymd}T${end.time}:00-03:00`, timeZone: TIME_ZONE },
  };
}

export function buildGoogleEvent(
  pericia: PericiaAgendada,
  destination: GoogleCalendarDestinationConfig
): GoogleCalendarEvent {
  const description = renderGoogleTemplate(destination.descriptionTemplate, pericia).trim();

  const event: GoogleCalendarEvent = {
    summary: titleFor(pericia, destination),
    description,
    location: destination.includeLocation ? pericia.local || undefined : undefined,
    visibility: destination.visibility,
    transparency: destination.transparency,
    extendedProperties: {
      private: {
        disparazapId: String(pericia.id),
        disparazapCardId: pericia.card_id,
        disparazapDestination: String(destination.destination),
      },
    },
    ...eventTiming(pericia, destination),
  } as GoogleCalendarEvent & { visibility: string; transparency: string };

  const extended = event as GoogleCalendarEvent & {
    reminders?: { useDefault: boolean; overrides: never[] };
    colorId?: string;
  };
  extended.reminders = { useDefault: false, overrides: [] };
  if (destination.colorId) extended.colorId = destination.colorId;
  return extended;
}

function googleEventStartKey(event: GoogleCalendarEvent): string {
  if (event.start?.date) return `${event.start.date}|`;
  const dateTime = event.start?.dateTime || "";
  return dateTime ? `${dateTime.slice(0, 10)}|${dateTime.slice(11, 16)}` : "";
}

function localEventStartKey(pericia: PericiaAgendada, destination: GoogleCalendarDestinationConfig): string {
  const start = eventTiming(pericia, destination).start;
  if (start?.date) return `${start.date}|`;
  const dateTime = start?.dateTime || "";
  return dateTime ? `${dateTime.slice(0, 10)}|${dateTime.slice(11, 16)}` : "";
}

function eventSearchText(event: GoogleCalendarEvent): string {
  return normalizeText([event.summary, event.description, event.location].filter(Boolean).join(" "));
}

function findExistingEvent(
  pericia: PericiaAgendada,
  destination: GoogleCalendarDestinationConfig,
  events: GoogleCalendarEvent[],
  usedIds: Set<string>
): { event: GoogleCalendarEvent | null; conflict: boolean } {
  const byInternalId = events.filter((event) => {
    const properties = event.extendedProperties?.private;
    return event.id && !usedIds.has(event.id) && properties?.disparazapId === String(pericia.id)
      && (!properties.disparazapDestination || properties.disparazapDestination === String(destination.destination));
  });
  if (byInternalId.length === 1) return { event: byInternalId[0], conflict: false };

  const startKey = localEventStartKey(pericia, destination);
  const name = normalizeText(pericia.nome);
  const process = normalizeText(pericia.processo);
  const type = normalizeText(pericia.tipo);
  const candidates = events
    .filter((event) => event.id && !usedIds.has(event.id) && googleEventStartKey(event) === startKey)
    .map((event) => {
      const text = eventSearchText(event);
      let score = 0;
      if (process && text.includes(process)) score += 80;
      if (name && text.includes(name)) score += 50;
      if (type && text.includes(type)) score += 10;
      return { event, score };
    })
    // Nome sozinho é insuficiente: duas perícias distintas do mesmo cliente podem ocorrer no
    // mesmo horário. Exige processo ou a combinação de cliente + tipo para vincular com segurança.
    .filter((candidate) => candidate.score >= 60)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) return { event: null, conflict: false };
  if (candidates.length > 1 && candidates[0].score === candidates[1].score) return { event: null, conflict: true };
  return { event: candidates[0].event, conflict: false };
}

function deterministicGoogleEventId(calendarId: string, periciaId: number, destination: number): string {
  return crypto.createHash("sha256").update(`${calendarId}:${periciaId}:${destination}`).digest("hex").slice(0, 48);
}

function eventSearchWindow(
  pericia: PericiaAgendada,
  destination: GoogleCalendarDestinationConfig
): { timeMin: string; timeMax: string } {
  const timing = eventTiming(pericia, destination);
  const startDate = timing.start?.date || timing.start?.dateTime?.slice(0, 10) || eventDateKey(pericia);
  const rawEndDate = timing.end?.date || timing.end?.dateTime?.slice(0, 10) || startDate;
  const endDate = timing.end?.date ? rawEndDate : addDays(rawEndDate, 1);
  return {
    timeMin: `${startDate}T00:00:00-03:00`,
    timeMax: `${endDate}T00:00:00-03:00`,
  };
}

async function listGoogleEvents(calendarId: string, timeMin: string, timeMax?: string): Promise<GoogleCalendarEvent[]> {
  const all: GoogleCalendarEvent[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "false",
      orderBy: "startTime",
      maxResults: "2500",
      timeMin,
    });
    if (timeMax) params.set("timeMax", timeMax);
    if (pageToken) params.set("pageToken", pageToken);
    const result = await googleRequest<GoogleEventListResponse>(
      `/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`
    );
    all.push(...(result.items || []).filter((event) => event.status !== "cancelled"));
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  return all;
}

const getLinkStmt = db.prepare(
  "SELECT * FROM google_calendar_event_links WHERE pericia_id = ? AND destination = ?"
);
const listLinksStmt = db.prepare("SELECT * FROM google_calendar_event_links WHERE pericia_id = ? ORDER BY destination");
const upsertLinkStmt = db.prepare(`
  INSERT INTO google_calendar_event_links
    (pericia_id, destination, calendar_id, google_event_id, sync_status, last_error, synced_at, updated_at)
  VALUES (@pericia_id, @destination, @calendar_id, @google_event_id, @sync_status, @last_error, @synced_at, CURRENT_TIMESTAMP)
  ON CONFLICT(pericia_id, destination) DO UPDATE SET
    calendar_id = excluded.calendar_id,
    google_event_id = excluded.google_event_id,
    sync_status = excluded.sync_status,
    last_error = excluded.last_error,
    synced_at = excluded.synced_at,
    updated_at = CURRENT_TIMESTAMP
`);
const updateLinkErrorStmt = db.prepare(`
  UPDATE google_calendar_event_links
  SET sync_status = 'erro', last_error = ?, updated_at = CURRENT_TIMESTAMP
  WHERE pericia_id = ? AND destination = ?
`);
const deleteLinkStmt = db.prepare("DELETE FROM google_calendar_event_links WHERE pericia_id = ? AND destination = ?");

/**
 * Mantém o mesmo evento do Google quando o importador registra um reagendamento como uma
 * nova linha local. Assim, a sincronização seguinte altera data, título e horário do evento
 * já existente em vez de apagá-lo e tentar criar outro.
 */
export function transferGoogleCalendarLinks(previousPericiaId: number, nextPericiaId: number): void {
  const transfer = db.transaction(() => {
    const links = listLinksStmt.all(previousPericiaId) as GoogleEventLink[];
    for (const link of links) {
      const nextLink = getLinkStmt.get(nextPericiaId, link.destination) as GoogleEventLink | undefined;
      if (nextLink) {
        deleteLinkStmt.run(previousPericiaId, link.destination);
        continue;
      }
      db.prepare(
        "UPDATE google_calendar_event_links SET pericia_id = ?, updated_at = CURRENT_TIMESTAMP WHERE pericia_id = ? AND destination = ?"
      ).run(nextPericiaId, previousPericiaId, link.destination);
    }
  });
  transfer();
}

function saveLink(periciaId: number, destination: number, calendarId: string, googleEventId: string): void {
  upsertLinkStmt.run({
    pericia_id: periciaId,
    destination,
    calendar_id: calendarId,
    google_event_id: googleEventId,
    sync_status: "sincronizado",
    last_error: null,
    synced_at: new Date().toISOString(),
  });
}

async function deleteRemoteEvent(link: GoogleEventLink): Promise<boolean> {
  try {
    await googleRequest<Record<string, never>>(
      `/calendars/${encodeURIComponent(link.calendar_id)}/events/${encodeURIComponent(link.google_event_id)}`,
      { method: "DELETE" }
    );
    deleteLinkStmt.run(link.pericia_id, link.destination);
    return true;
  } catch (err) {
    if (err instanceof GoogleCalendarError && (err.status === 404 || err.status === 410)) {
      deleteLinkStmt.run(link.pericia_id, link.destination);
      return true;
    }
    updateLinkErrorStmt.run((err as Error).message, link.pericia_id, link.destination);
    return false;
  }
}

async function syncPericiaToDestination(
  pericia: PericiaAgendada,
  destination: GoogleCalendarDestinationConfig,
  skipExistingLookup = false
): Promise<"linked" | "created" | "updated" | "skipped" | "conflict"> {
  let link = getLinkStmt.get(pericia.id, destination.destination) as GoogleEventLink | undefined;
  if (link && link.calendar_id !== destination.calendarId) {
    // A agenda pode conter um evento criado manualmente antes da vinculação. Ao trocar o
    // destino, removemos somente o vínculo local para nunca apagar esse evento por engano.
    deleteLinkStmt.run(link.pericia_id, link.destination);
    link = undefined;
  }

  const payload = buildGoogleEvent(pericia, destination);
  if (link) {
    try {
      const updated = await googleRequest<GoogleCalendarEvent>(
        `/calendars/${encodeURIComponent(destination.calendarId)}/events/${encodeURIComponent(link.google_event_id)}`,
        { method: "PATCH", body: JSON.stringify(payload) }
      );
      saveLink(pericia.id, destination.destination, destination.calendarId, updated.id || link.google_event_id);
      return "updated";
    } catch (err) {
      if (!(err instanceof GoogleCalendarError) || (err.status !== 404 && err.status !== 410)) {
        updateLinkErrorStmt.run((err as Error).message, pericia.id, destination.destination);
        throw err;
      }
      deleteLinkStmt.run(pericia.id, destination.destination);
    }
  }

  if (!skipExistingLookup) {
    const window = eventSearchWindow(pericia, destination);
    const existingEvents = await listGoogleEvents(
      destination.calendarId,
      window.timeMin,
      window.timeMax
    );
    const existing = findExistingEvent(pericia, destination, existingEvents, new Set());
    if (existing.conflict) return "conflict";
    if (existing.event?.id) {
      const updated = await googleRequest<GoogleCalendarEvent>(
        `/calendars/${encodeURIComponent(destination.calendarId)}/events/${encodeURIComponent(existing.event.id)}`,
        { method: "PATCH", body: JSON.stringify(payload) }
      );
      saveLink(pericia.id, destination.destination, destination.calendarId, updated.id || existing.event.id);
      return "linked";
    }
  }

  if (!destination.createMissing) return "skipped";

  const googleEventId = deterministicGoogleEventId(destination.calendarId, pericia.id, destination.destination);
  try {
    const created = await googleRequest<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(destination.calendarId)}/events`,
      { method: "POST", body: JSON.stringify({ ...payload, id: googleEventId }) }
    );
    saveLink(pericia.id, destination.destination, destination.calendarId, created.id || googleEventId);
  } catch (err) {
    if (!(err instanceof GoogleCalendarError) || err.status !== 409) throw err;
    await googleRequest<GoogleCalendarEvent>(
      `/calendars/${encodeURIComponent(destination.calendarId)}/events/${googleEventId}`,
      { method: "PATCH", body: JSON.stringify(payload) }
    );
    saveLink(pericia.id, destination.destination, destination.calendarId, googleEventId);
  }
  return "created";
}

export async function syncGoogleCalendarPericia(periciaId: number): Promise<GoogleCalendarSyncResult> {
  const result: GoogleCalendarSyncResult = { total: 0, linked: 0, created: 0, updated: 0, deleted: 0, skipped: 0, conflicts: 0, errors: 0 };
  const config = getGoogleCalendarConfig();
  if (!config.syncEnabled || !getSetting("google_refresh_token")) return result;
  const pericia = db.prepare("SELECT * FROM pericias_agendadas WHERE id = ?").get(periciaId) as PericiaAgendada | undefined;
  if (!pericia || pericia.status !== "ativa") return deleteGoogleCalendarPericia(periciaId);

  for (const destination of config.destinations.filter((item) => item.enabled && item.calendarId)) {
    result.total += 1;
    try {
      const action = await syncPericiaToDestination(pericia, destination);
      result[action === "conflict" ? "conflicts" : action] += 1;
    } catch (err) {
      result.errors += 1;
      recordSystemLog({
        nivel: "erro",
        categoria: "google_calendar",
        evento: "falha_sincronizacao_evento",
        titulo: "Falha ao sincronizar evento com o Google Agenda",
        mensagem: (err as Error).message,
        origem: "automatico",
        detalhes: { periciaId, destino: destination.destination, agenda: destination.calendarName },
      });
    }
  }
  return result;
}

export async function deleteGoogleCalendarPericia(periciaId: number): Promise<GoogleCalendarSyncResult> {
  const result: GoogleCalendarSyncResult = { total: 0, linked: 0, created: 0, updated: 0, deleted: 0, skipped: 0, conflicts: 0, errors: 0 };
  if (!getSetting("google_refresh_token")) return result;
  const links = listLinksStmt.all(periciaId) as GoogleEventLink[];
  for (const link of links) {
    result.total += 1;
    if (await deleteRemoteEvent(link)) result.deleted += 1;
    else result.errors += 1;
  }
  return result;
}

function futurePericias(): PericiaAgendada[] {
  const today = todayInSaoPaulo();
  return (db.prepare("SELECT * FROM pericias_agendadas WHERE status = 'ativa' ORDER BY data_hora_ms").all() as PericiaAgendada[])
    .filter((pericia) => eventDateKey(pericia) >= today);
}

export async function analyzeGoogleCalendar(): Promise<GoogleCalendarAnalysis> {
  const config = getGoogleCalendarConfig();
  if (!getSetting("google_refresh_token")) throw new GoogleCalendarError("Conecte sua conta Google primeiro.", 400);
  const pericias = futurePericias();
  const destinations: GoogleCalendarAnalysisDestination[] = [];

  for (const destination of config.destinations.filter((item) => item.enabled && item.calendarId)) {
    const events = await listGoogleEvents(destination.calendarId, `${todayInSaoPaulo()}T00:00:00-03:00`);
    const used = new Set<string>();
    const summary: GoogleCalendarAnalysisDestination = {
      destination: destination.destination,
      name: destination.name,
      calendarName: destination.calendarName,
      total: pericias.length,
      linked: 0,
      matched: 0,
      missing: 0,
      conflicts: 0,
      conflictItems: [],
    };
    for (const pericia of pericias) {
      const link = getLinkStmt.get(pericia.id, destination.destination) as GoogleEventLink | undefined;
      if (link && link.calendar_id === destination.calendarId) {
        summary.linked += 1;
        used.add(link.google_event_id);
        continue;
      }
      const match = findExistingEvent(pericia, destination, events, used);
      if (match.conflict) {
        summary.conflicts += 1;
        summary.conflictItems.push({ periciaId: pericia.id, nome: pericia.nome, data: pericia.data, horario: pericia.horario });
      } else if (match.event?.id) {
        summary.matched += 1;
        used.add(match.event.id);
      } else {
        summary.missing += 1;
      }
    }
    destinations.push(summary);
  }
  return { totalEvents: pericias.length, destinations };
}

async function cleanupOrphanLinks(result: GoogleCalendarSyncResult): Promise<void> {
  const links = db.prepare(`
    SELECT links.* FROM google_calendar_event_links links
    LEFT JOIN pericias_agendadas p ON p.id = links.pericia_id
    WHERE p.id IS NULL
  `).all() as GoogleEventLink[];
  for (const link of links) {
    result.total += 1;
    if (await deleteRemoteEvent(link)) result.deleted += 1;
    else result.errors += 1;
  }
}

export async function syncAllGoogleCalendar(): Promise<GoogleCalendarSyncResult> {
  const config = getGoogleCalendarConfig();
  if (!config.syncEnabled) throw new GoogleCalendarError("Ative a sincronização antes de executar.", 400);
  if (!getSetting("google_refresh_token")) throw new GoogleCalendarError("Conecte sua conta Google primeiro.", 400);
  const result: GoogleCalendarSyncResult = { total: 0, linked: 0, created: 0, updated: 0, deleted: 0, skipped: 0, conflicts: 0, errors: 0 };
  await cleanupOrphanLinks(result);
  const pericias = futurePericias();

  // Uma única leitura por agenda mantém a primeira sincronização rápida mesmo com centenas
  // de compromissos. A lista em memória também impede que o mesmo evento manual seja ligado
  // a dois compromissos diferentes durante a reconciliação.
  for (const destination of config.destinations.filter((item) => item.enabled && item.calendarId)) {
    const events = await listGoogleEvents(destination.calendarId, `${todayInSaoPaulo()}T00:00:00-03:00`);
    const usedIds = new Set<string>();
    const currentLinks = db.prepare(
      "SELECT * FROM google_calendar_event_links WHERE destination = ? AND calendar_id = ?"
    ).all(destination.destination, destination.calendarId) as GoogleEventLink[];
    for (const link of currentLinks) usedIds.add(link.google_event_id);

    for (const pericia of pericias) {
      result.total += 1;
      try {
        const currentLink = getLinkStmt.get(pericia.id, destination.destination) as GoogleEventLink | undefined;
        if (currentLink?.calendar_id === destination.calendarId) {
          const action = await syncPericiaToDestination(pericia, destination, true);
          result[action === "conflict" ? "conflicts" : action] += 1;
          continue;
        }
        if (currentLink) {
          deleteLinkStmt.run(currentLink.pericia_id, currentLink.destination);
        }

        const match = findExistingEvent(pericia, destination, events, usedIds);
        if (match.conflict) {
          result.conflicts += 1;
          continue;
        }
        if (match.event?.id) {
          saveLink(pericia.id, destination.destination, destination.calendarId, match.event.id);
          usedIds.add(match.event.id);
          await syncPericiaToDestination(pericia, destination, true);
          result.linked += 1;
          continue;
        }

        const action = await syncPericiaToDestination(pericia, destination, true);
        result[action === "conflict" ? "conflicts" : action] += 1;
      } catch (err) {
        result.errors += 1;
        recordSystemLog({
          nivel: "erro",
          categoria: "google_calendar",
          evento: "falha_sincronizacao_evento",
          titulo: "Falha ao sincronizar evento com o Google Agenda",
          mensagem: (err as Error).message,
          origem: "usuario",
          detalhes: { periciaId: pericia.id, destino: destination.destination, agenda: destination.calendarName },
        });
      }
    }
  }
  recordSystemLog({
    nivel: result.errors > 0 ? "aviso" : "info",
    categoria: "google_calendar",
    evento: "sincronizacao_manual",
    titulo: "Sincronização com o Google Agenda concluída",
    mensagem: result.errors > 0 ? `${result.errors} evento(s) apresentaram erro.` : null,
    origem: "usuario",
    detalhes: result,
  });
  return result;
}

type QueueAction = "upsert" | "delete";
const syncQueue = new Map<number, QueueAction>();
let queueRunning = false;

async function drainQueue(): Promise<void> {
  if (queueRunning) return;
  queueRunning = true;
  try {
    while (syncQueue.size > 0) {
      const [id, action] = syncQueue.entries().next().value as [number, QueueAction];
      syncQueue.delete(id);
      if (action === "delete") await deleteGoogleCalendarPericia(id);
      else await syncGoogleCalendarPericia(id);
    }
  } finally {
    queueRunning = false;
  }
}

export function scheduleGoogleCalendarSync(periciaId: number): void {
  syncQueue.set(periciaId, "upsert");
  setImmediate(() => drainQueue().catch((err) => console.error("[Google Agenda] Erro na fila de sincronização:", err)));
}

export function scheduleGoogleCalendarDelete(periciaId: number): void {
  syncQueue.set(periciaId, "delete");
  setImmediate(() => drainQueue().catch((err) => console.error("[Google Agenda] Erro na fila de exclusão:", err)));
}
