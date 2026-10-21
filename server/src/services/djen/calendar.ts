import crypto from "node:crypto";
import { db } from "../../db";
import {
  googleRequest,
  getGoogleCalendarConfig,
  GoogleCalendarError,
} from "../googleCalendarService";
import { configPrazos } from "./deadlines";
import { somarDias, dataValida } from "./api";
import { WorkflowInputError } from "./workflow";
import { registrarHistoricoDjen } from "./history";
const ativos = new Set<string>();
export async function enviarPrazoAgenda(publicacaoId: number, prazoId: number) {
  const c = configPrazos();
  if (!c.calendarId)
    throw new WorkflowInputError(
      "Configure a agenda de prazos em Configurações → Prazos e calendários.",
    );
  if (
    getGoogleCalendarConfig().destinations.some(
      (d) => d.calendarId === c.calendarId,
    )
  )
    throw new WorkflowInputError(
      "A agenda de prazos deve ser diferente das agendas configuradas para perícias.",
    );
  const p = db
    .prepare(
      "SELECT dp.*,pr.numero,p.tribunal FROM djen_prazos dp JOIN djen_publicacoes p ON p.id=dp.publicacao_id JOIN djen_processos pr ON pr.chave=p.processo_chave WHERE dp.id=? AND dp.publicacao_id=?",
    )
    .get(prazoId, publicacaoId) as
    | {
        descricao: string;
        inicio: string | null;
        termino: string | null;
        status: string;
        observacoes: string;
        numero: string;
        tribunal: string;
      }
    | undefined;
  if (!p || p.status !== "aberto" || !p.termino || !dataValida(p.termino))
    throw new WorkflowInputError(
      "Salve um prazo em aberto com término válido antes de adicionar à agenda.",
    );
  const eventId = crypto
      .createHash("sha256")
      .update(`djen-prazo:${c.calendarId}:${prazoId}`)
      .digest("hex")
      .slice(0, 48),
    chave = `${prazoId}:${c.calendarId}`;
  if (ativos.has(chave))
    throw new WorkflowInputError("Este prazo já está sendo enviado à agenda.");
  ativos.add(chave);
  const endpoint = `/calendars/${encodeURIComponent(c.calendarId)}/events`;
  const event = {
    summary: `Prazo: ${p.descricao} · ${p.numero}`,
    description: `Processo: ${p.numero}\nTribunal: ${p.tribunal}\nInício do prazo: ${p.inicio || "não informado"}\nTérmino: ${p.termino}\n${p.observacoes}`,
    start: { date: p.termino },
    end: { date: somarDias(p.termino, 1) },
    extendedProperties: {
      private: {
        djenPrazoId: String(prazoId),
        djenPublicacaoId: String(publicacaoId),
      },
    },
  };
  try {
    let saved: { id?: string; htmlLink?: string };
    try {
      saved = await googleRequest(endpoint, {
        method: "POST",
        body: JSON.stringify({ ...event, id: eventId }),
      });
    } catch (e) {
      if (!(e instanceof GoogleCalendarError) || e.status !== 409) throw e;
      saved = await googleRequest(`${endpoint}/${eventId}`, {
        method: "PATCH",
        body: JSON.stringify(event),
      });
    }
    db.prepare(
      "INSERT INTO djen_agenda_links(prazo_id,calendar_id,event_id,url) VALUES (?,?,?,?) ON CONFLICT(prazo_id,calendar_id) DO UPDATE SET event_id=excluded.event_id,url=excluded.url,updated_at=CURRENT_TIMESTAMP",
    ).run(prazoId, c.calendarId, eventId, saved.htmlLink || null);
    registrarHistoricoDjen(
      publicacaoId,
      "agenda",
      "Prazo adicionado/atualizado na agenda processual.",
      { prazoId, agenda: c.calendarName },
    );
    return { ok: true, url: saved.htmlLink || null };
  } finally {
    ativos.delete(chave);
  }
}
