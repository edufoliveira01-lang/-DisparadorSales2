import { listLogsPendentesDeAlerta, marcarAlertaEnviado, type SendLog } from "./logsService";
import { getSetting } from "./settingsService";
import { enviarMensagemTelegram } from "./telegramService";

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

function motivoDoAlerta(log: SendLog, horasLimite: number): string {
  if (log.status === "falha") {
    return `Falha no envio${log.erro ? `: ${log.erro}` : "."}`;
  }
  return `Enviado, mas sem confirmação de entrega há mais de ${horasLimite}h.`;
}

function montarMensagem(logs: SendLog[], horasLimite: number): string {
  const linhas = logs.map(
    (log) => `• ${log.card_nome || "Cliente sem nome"} (${formatarTelefone(log.telefone)})\n  ${motivoDoAlerta(log, horasLimite)}`
  );
  const titulo =
    logs.length === 1
      ? "⚠️ 1 mensagem do DisparaZap pode não ter chegado ao cliente:"
      : `⚠️ ${logs.length} mensagens do DisparaZap podem não ter chegado aos clientes:`;
  return `${titulo}\n\n${linhas.join("\n\n")}\n\nConfira em Histórico no DisparaZap.`;
}

/**
 * Verificação periódica: avisa no Telegram sobre envios com problema de entrega (falha
 * imediata, ou "enviado" sem confirmar entrega além do prazo configurado) ainda não
 * notificados. Roda de forma silenciosa se o Telegram não estiver configurado — a
 * funcionalidade é totalmente opcional.
 */
export async function verificarEntregasPendentes(): Promise<void> {
  const token = getSetting("telegram_bot_token");
  const chatId = getSetting("telegram_chat_id");
  if (!token || !chatId) return;

  const horasConfiguradas = Number(getSetting("telegram_alerta_horas"));
  const horasLimite = Number.isFinite(horasConfiguradas) && horasConfiguradas > 0 ? horasConfiguradas : HORAS_PADRAO;

  const logs = listLogsPendentesDeAlerta(horasLimite);
  if (logs.length === 0) return;

  try {
    await enviarMensagemTelegram(token, chatId, montarMensagem(logs, horasLimite));
    marcarAlertaEnviado(logs.map((log) => log.id));
    console.log(`[Notificações] Alerta enviado ao Telegram sobre ${logs.length} envio(s) com problema de entrega.`);
  } catch (err) {
    console.error("[Notificações] Erro ao enviar alerta ao Telegram:", err);
  }
}
