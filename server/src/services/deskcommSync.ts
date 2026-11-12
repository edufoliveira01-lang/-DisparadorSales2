/**
 * Com o WhatsApp do Deskcomm, as respostas e confirmações de leitura chegam lá, não no Sales. Esta rotina
 * consulta as conversas das mensagens que o Sales enviou e traz de volta: entregue (✓✓), lido (✓✓ azul) e
 * resposta do cliente (para "Aguardando resposta" e para mover o cartão no Trello).
 */
import { db } from "../db";
import { emitEvent } from "../websocket";
import { getSetting } from "./settingsService";
import { moveCard } from "./trelloService";
import { mensagensDaConversa, envioPeloDeskcommLigado, type MensagemDoDeskcomm } from "./gestao/deskcomm";
import { usaDeskcomm } from "./canalWhatsapp";
import { updateLogAckByMessageId } from "./logsService";
import { findAwaitingByPhoneDigits, resolvePendingReplyIfAwaiting, updatePendingReplyAckByMessageId, type PendingReply } from "./pendingRepliesService";

type Http = typeof fetch;
interface Linha { message_id: string; conversation_id: string; telefone_digits: string; ack: number; criada_em: string }

const ms = (iso: string) => Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : `${iso.replace(" ", "T")}Z`);
const ackDaMensagem = (m: MensagemDoDeskcomm): number | null => {
  if (m.status === "failed" || m.status === "error") return -1;
  if (m.read_at || (typeof m.ack === "number" && m.ack >= 3)) return 3;
  if (m.delivered_at || (typeof m.ack === "number" && m.ack === 2)) return 2;
  return null;
};

async function concluirResposta(p: PendingReply, preview: string | null) {
  const resolvido = resolvePendingReplyIfAwaiting(p.id, "mensagem", preview);
  if (!resolvido) return;
  emitEvent("pendingReply:resolved", resolvido);
  const key = getSetting("trello_key"), token = getSetting("trello_token"), lista = getSetting("trello_confirm_list_id");
  if (key && token && lista) { try { await moveCard(key, token, p.card_id, lista); } catch (e) { console.error(`[Deskcomm] Não consegui mover o cartão ${p.card_id} após a resposta:`, e); } }
}

/** Uma rodada: confere as conversas com mensagens ainda sem leitura ou com resposta esperada. */
export async function sincronizarDeskcomm(http: Http = fetch): Promise<{ conversas: number; respostas: number; acks: number }> {
  const resumo = { conversas: 0, respostas: 0, acks: 0 };
  if (!usaDeskcomm() || !envioPeloDeskcommLigado()) return resumo;
  const linhas = db.prepare(`
    SELECT * FROM deskcomm_mensagens m
    WHERE m.criada_em >= datetime('now','-4 days')
      AND (m.ack < 3 OR EXISTS (SELECT 1 FROM pending_replies p WHERE p.telefone_digits = m.telefone_digits AND p.status = 'aguardando'))
    ORDER BY m.criada_em DESC LIMIT 300`).all() as Linha[];
  const porConversa = new Map<string, Linha[]>();
  for (const l of linhas) porConversa.set(l.conversation_id, [...(porConversa.get(l.conversation_id) ?? []), l]);
  const atualizar = db.prepare("UPDATE deskcomm_mensagens SET ack = ? WHERE message_id = ?");

  for (const [conversa, enviadas] of [...porConversa].slice(0, 40)) {
    let mensagens: MensagemDoDeskcomm[];
    try { mensagens = await mensagensDaConversa(conversa, http); } catch { continue; }
    resumo.conversas++;
    for (const e of enviadas) {
      const m = mensagens.find((x) => x.id === e.message_id);
      const ack = m ? ackDaMensagem(m) : null;
      if (ack !== null && (ack === -1 || ack > e.ack)) {
        atualizar.run(ack, e.message_id);
        const log = updateLogAckByMessageId(e.message_id, ack); if (log) emitEvent("send:ack-update", log);
        const pend = updatePendingReplyAckByMessageId(e.message_id, ack); if (pend) emitEvent("pendingReply:ack-update", pend);
        resumo.acks++;
      }
      const espera = findAwaitingByPhoneDigits(e.telefone_digits);
      if (!espera) continue;
      const desde = Math.min(ms(espera.created_at), ms(e.criada_em));
      const resposta = mensagens.filter((x) => x.direction === "inbound" && ms(x.created_at) > desde).sort((a, b) => ms(a.created_at) - ms(b.created_at))[0];
      if (resposta) {
        await concluirResposta(espera, resposta.type === "reaction" ? null : (resposta.body ?? "").trim().slice(0, 140) || null);
        resumo.respostas++;
      }
    }
  }
  return resumo;
}

let rodando = false;
export function iniciarSincronizacaoDoDeskcomm(): void {
  setInterval(() => {
    if (rodando || !usaDeskcomm()) return;
    rodando = true;
    void sincronizarDeskcomm().catch((e) => console.error("[Deskcomm] sincronização:", e)).finally(() => { rodando = false; });
  }, 60_000).unref();
}
