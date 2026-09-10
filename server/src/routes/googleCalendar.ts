import crypto from "node:crypto";
import { Router, type Request } from "express";
import {
  analyzeGoogleCalendar,
  buildGoogleAuthorizationUrl,
  disconnectGoogleCalendar,
  exchangeGoogleAuthorizationCode,
  getGoogleCalendarStatus,
  getGoogleCalendarSyncJob,
  GoogleCalendarError,
  listWritableGoogleCalendars,
  saveGoogleCalendarConfig,
  startGoogleCalendarSyncJob,
  type GoogleCalendarConfig,
} from "../services/googleCalendarService";
import { recordSystemLog } from "../services/systemLogsService";

export const googleCalendarRouter = Router();

const oauthStates = new Map<string, { sessionId: string; redirectUri: string; expiresAt: number }>();
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

function redirectUriFor(req: Request): string {
  if (process.env.GOOGLE_REDIRECT_URI) return process.env.GOOGLE_REDIRECT_URI;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const protocol = forwardedProto || req.protocol;
  return `${protocol}://${req.get("host")}/api/google-calendar/callback`;
}

function settingsRedirect(result: "connected" | "error", message?: string): string {
  const params = new URLSearchParams({ google_calendar: result });
  if (message) params.set("message", message.slice(0, 300));
  return `/configuracoes?${params.toString()}`;
}

function sendGoogleError(res: import("express").Response, err: unknown): void {
  if (err instanceof GoogleCalendarError) {
    res.status(err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message });
    return;
  }
  console.error("[Google Agenda] Erro inesperado:", err);
  res.status(502).json({ error: "Erro inesperado ao comunicar com o Google Agenda." });
}

googleCalendarRouter.get("/status", (_req, res) => {
  try {
    res.json(getGoogleCalendarStatus());
  } catch (err) {
    sendGoogleError(res, err);
  }
});

googleCalendarRouter.get("/connect", (req, res) => {
  try {
    const sessionId = String(req.cookies.session_id || "");
    if (!sessionId) throw new GoogleCalendarError("Sessão expirada. Entre novamente no sistema.", 401);
    const state = crypto.randomBytes(32).toString("hex");
    const redirectUri = redirectUriFor(req);
    oauthStates.set(state, { sessionId, redirectUri, expiresAt: Date.now() + OAUTH_STATE_TTL_MS });
    for (const [key, value] of oauthStates) {
      if (value.expiresAt < Date.now()) oauthStates.delete(key);
    }
    res.redirect(buildGoogleAuthorizationUrl(state, redirectUri));
  } catch (err) {
    if (err instanceof GoogleCalendarError) {
      return res.redirect(settingsRedirect("error", err.message));
    }
    res.redirect(settingsRedirect("error", "Não foi possível iniciar a conexão com o Google."));
  }
});

googleCalendarRouter.get("/callback", async (req, res) => {
  const state = String(req.query.state || "");
  const pending = oauthStates.get(state);
  oauthStates.delete(state);
  try {
    if (req.query.error) throw new GoogleCalendarError("A conexão com o Google foi cancelada.", 400);
    const code = String(req.query.code || "");
    if (!pending || pending.expiresAt < Date.now() || pending.sessionId !== String(req.cookies.session_id || "")) {
      throw new GoogleCalendarError("A solicitação de conexão expirou. Tente novamente.", 400);
    }
    if (!code) throw new GoogleCalendarError("O Google não retornou o código de autorização.", 400);
    await exchangeGoogleAuthorizationCode(code, pending.redirectUri);
    res.redirect(settingsRedirect("connected"));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Não foi possível conectar a conta Google.";
    recordSystemLog({
      nivel: "erro",
      categoria: "google_calendar",
      evento: "falha_oauth",
      titulo: "Falha ao conectar a conta Google",
      mensagem: message,
      origem: "usuario",
    });
    res.redirect(settingsRedirect("error", message));
  }
});

googleCalendarRouter.get("/calendars", async (_req, res) => {
  try {
    res.json(await listWritableGoogleCalendars());
  } catch (err) {
    sendGoogleError(res, err);
  }
});

googleCalendarRouter.put("/config", (req, res) => {
  try {
    const config = saveGoogleCalendarConfig(req.body as Partial<GoogleCalendarConfig>);
    res.json({ ok: true, config });
  } catch (err) {
    sendGoogleError(res, err);
  }
});

googleCalendarRouter.post("/analyze", async (_req, res) => {
  try {
    res.json(await analyzeGoogleCalendar());
  } catch (err) {
    sendGoogleError(res, err);
  }
});

googleCalendarRouter.post("/sync", (_req, res) => {
  try {
    const response = startGoogleCalendarSyncJob();
    res.status(response.started ? 202 : 200).json({ ok: true, ...response });
  } catch (err) {
    sendGoogleError(res, err);
  }
});

googleCalendarRouter.get("/sync/status", (_req, res) => {
  res.json(getGoogleCalendarSyncJob());
});

googleCalendarRouter.post("/disconnect", async (_req, res) => {
  try {
    await disconnectGoogleCalendar();
    res.json({ ok: true });
  } catch (err) {
    sendGoogleError(res, err);
  }
});
