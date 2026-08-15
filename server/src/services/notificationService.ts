import { listLogsPendentesDeAlerta, marcarAlertaEnviado, type SendLog } from "./logsService";
import {
  listPendingRepliesPendentesDeAlerta,
  marcarAlertaRespostaEnviado,
  type PendingReply,
} from "./pendingRepliesService";
import { getSetting } from "./settingsService";
import { enviarMensagemTelegram } from "./telegramService";
import { enviarMensagemWhapi } from "./whapiService";

const HORAS_PADRAO = 48;

function formatarTelefone(raw: string | null): string {
  if (!raw) return "—";
  let digits = raw.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if (digits.length !== 10 && digits.length !== 11) return raw;
  const ddd = digits.slice(0, 2);
  const rest = digits.slice(2);
  const splitAt = digits.length === 11 ? 5 : 4;
  return `(${ddd}) ${rest.slice(0, splitAt)}-${rest.slice(splitAt)}`;
}

function lerHorasLimite(chave: string): number {
  const configuradas = Number(getSetting(chave));
  return Number.isFinite(configuradas) && configuradas > 0 ? configuradas : HORAS_PADRAO;
}

function motivoDoAlertaEntrega(log: SendLog, horasLimite: number): string {
  if (log.status === "falha") {
    return `Falha no envio${log.erro ? `: ${log.erro}` : "."}`;
  }
  return `Enviado, mas sem confirmação de entrega há mais de ${horasLimite}h.`;
}

function montarMensagemEntrega(logs: SendLog[], horasLimite: number): string {
  const linhas = logs.map(
    (log) =>
      `• ${log.card_nome || "Cliente sem nome"} (${formatarTelefone(log.telefone)})\n  ${motivoDoAlertaEntrega(log, horasLimite)}`
  );
  const titulo =
    logs.length === 1
      ? "⚠️ 1 mensagem do DisparaZap pode não ter chegado ao cliente:"
      : `⚠️ ${logs.length} mensagens do DisparaZap podem não ter chegado aos clientes:`;
  return `${titulo}\n\n${linhas.join("\n\n")}\n\nConfira em Histórico no DisparaZap.`;
}

function montarMensagemResposta(pendentes: PendingReply[], horasLimite: number): string {
  const linhas = pendentes.map(
    (p) => `• ${p.card_nome || "Cliente sem nome"} (${formatarTelefone(p.telefone)})\n  Sem resposta há mais de ${horasLimite}h.`
  );
  const titulo =
    pendentes.length === 1
      ? "🕑 1 cliente ainda não respondeu ao DisparaZap:"
      : `🕑 ${pendentes.length} clientes ainda não responderam ao DisparaZap:`;
  return `${titulo}\n\n${linhas.join("\n\n")}\n\nConfira em Pendentes de Resposta no DisparaZap.`;
}

interface CanalNotificacao {
  nome: string;
  enviar: (texto: string) => Promise<void>;
}

/** Monta a lista de canais de notificação configurados (Telegram e/ou Whapi) — cada um é opcional
 * e independente, então o usuário pode ligar um, o outro, ou os dois ao mesmo tempo. */
function canaisConfigurados(): CanalNotificacao[] {
  const canais: CanalNotificacao[] = [];

  const telegramToken = getSetting("telegram_bot_token");
  const telegramChatId = getSetting("telegram_chat_id");
  if (telegramToken && telegramChatId) {
    canais.push({ nome: "Telegram", enviar: (texto) => enviarMensagemTelegram(telegramToken, telegramChatId, texto) });
  }

  const whapiToken = getSetting("whapi_token");
  const whapiApiUrl = getSetting("whapi_api_url");
  const whapiNumero = getSetting("whapi_numero_notificacao");
  if (whapiToken && whapiApiUrl && whapiNumero) {
    canais.push({ nome: "Whapi", enviar: (texto) => enviarMensagemWhapi(whapiApiUrl, whapiToken, whapiNumero, texto) });
  }

  return canais;
}

/** Manda a mesma mensagem para todos os canais configurados, sem deixar a falha de um bloquear os
 * demais. Devolve true se pelo menos um canal confirmou o envio. */
async function enviarParaTodosOsCanais(canais: CanalNotificacao[], texto: string): Promise<boolean> {
  let algumSucesso = false;
  for (const canal of canais) {
    try {
      await canal.enviar(texto);
      algumSucesso = true;
    } catch (err) {
      console.error(`[Notificações] Erro ao enviar alerta pelo canal ${canal.nome}:`, err);
    }
  }
  return algumSucesso;
}

/**
 * Avisa sobre envios com problema de entrega (falha imediata, ou "enviado" sem confirmar entrega
 * além do prazo configurado) ainda não notificados.
 */
async function verificarEntregasPendentes(canais: CanalNotificacao[]): Promise<void> {
  const horasLimite = lerHorasLimite("telegram_alerta_horas");
  const logs = listLogsPendentesDeAlerta(horasLimite);
  if (logs.length === 0) return;

  const enviado = await enviarParaTodosOsCanais(canais, montarMensagemEntrega(logs, horasLimite));
  if (enviado) {
    marcarAlertaEnviado(logs.map((log) => log.id));
    console.log(`[Notificações] Alerta enviado sobre ${logs.length} envio(s) com problema de entrega.`);
  }
}

/**
 * Avisa sobre pendentes de resposta parados em "aguardando" além do prazo configurado (separado
 * do prazo de entrega — cliente pode ter recebido e simplesmente não respondido ainda).
 */
async function verificarRespostasPendentes(canais: CanalNotificacao[]): Promise<void> {
  const horasLimite = lerHorasLimite("telegram_alerta_horas_resposta");
  const pendentes = listPendingRepliesPendentesDeAlerta(horasLimite);
  if (pendentes.length === 0) return;

  const enviado = await enviarParaTodosOsCanais(canais, montarMensagemResposta(pendentes, horasLimite));
  if (enviado) {
    marcarAlertaRespostaEnviado(pendentes.map((p) => p.id));
    console.log(`[Notificações] Alerta enviado sobre ${pendentes.length} pendente(s) sem resposta.`);
  }
}

/**
 * Verificação periódica combinada: dispara os dois alertas (entrega e resposta) acima em todos os
 * canais configurados. Roda de forma silenciosa se nenhum canal estiver configurado — a
 * funcionalidade é totalmente opcional.
 */
export async function verificarNotificacoesPendentes(): Promise<void> {
  const canais = canaisConfigurados();
  if (canais.length === 0) return;

  await verificarEntregasPendentes(canais);
  await verificarRespostasPendentes(canais);
}
