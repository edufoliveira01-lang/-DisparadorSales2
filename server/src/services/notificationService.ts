import { listLogsPendentesDeAlerta, marcarAlertaEnviado, type SendLog } from "./logsService";
import {
  listPendingRepliesPendentesDeAlerta,
  marcarAlertaRespostaEnviado,
  type PendingReply,
} from "./pendingRepliesService";
import { getSetting } from "./settingsService";
import { enviarMensagemTelegram } from "./telegramService";
import { enviarMensagemWhapi } from "./whapiService";
import { recordSystemLog } from "./systemLogsService";

const HORAS_PADRAO = 48;
type OrigemVerificacao = "inicializacao" | "periodica";

interface ResultadoCanal {
  canal: string;
  sucesso: boolean;
  erro: string | null;
}

function lerHorasLimite(chave: string): number {
  const configuradas = Number(getSetting(chave));
  return Number.isFinite(configuradas) && configuradas > 0 ? configuradas : HORAS_PADRAO;
}

function montarMensagemEntrega(logs: SendLog[], horasLimite: number): string {
  const titulo =
    logs.length === 1
      ? "⚠️ 1 mensagem do DisparaZap pode não ter chegado ao cliente:"
      : `⚠️ ${logs.length} mensagens do DisparaZap podem não ter chegado aos clientes:`;
  const falhas = logs.filter((log) => log.status === "falha").length;
  const semConfirmacao = logs.length - falhas;
  const resumo = [
    falhas ? `${falhas} com falha de envio` : null,
    semConfirmacao ? `${semConfirmacao} sem confirmação há mais de ${horasLimite}h` : null,
  ].filter(Boolean).join("; ");
  return `${titulo}\n\nOrigem: verificação automática do sistema.\nResumo: ${resumo}.\n\nConfira clientes, horários e resultado por canal na área Logs do DisparaZap.`;
}

function montarMensagemResposta(pendentes: PendingReply[], horasLimite: number): string {
  const titulo =
    pendentes.length === 1
      ? "🕑 1 cliente ainda não respondeu ao DisparaZap:"
      : `🕑 ${pendentes.length} clientes ainda não responderam ao DisparaZap:`;
  return `${titulo}\n\nOrigem: verificação automática do sistema.\nResumo: ${pendentes.length} sem resposta há mais de ${horasLimite}h.\n\nConfira clientes, horários e resultado por canal na área Logs do DisparaZap.`;
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
 * demais. Devolve o resultado individual para a auditoria mostrar exatamente o que aconteceu. */
async function enviarParaTodosOsCanais(canais: CanalNotificacao[], texto: string): Promise<ResultadoCanal[]> {
  const resultados: ResultadoCanal[] = [];
  for (const canal of canais) {
    try {
      await canal.enviar(texto);
      resultados.push({ canal: canal.nome, sucesso: true, erro: null });
    } catch (err) {
      console.error(`[Notificações] Erro ao enviar alerta pelo canal ${canal.nome}:`, err);
      resultados.push({ canal: canal.nome, sucesso: false, erro: (err as Error).message });
    }
  }
  return resultados;
}

/**
 * Avisa sobre envios com problema de entrega (falha imediata, ou "enviado" sem confirmar entrega
 * além do prazo configurado) ainda não notificados.
 */
async function verificarEntregasPendentes(canais: CanalNotificacao[], origemVerificacao: OrigemVerificacao): Promise<void> {
  const horasLimite = lerHorasLimite("telegram_alerta_horas");
  const logs = listLogsPendentesDeAlerta(horasLimite);
  if (logs.length === 0) return;

  const resultados = await enviarParaTodosOsCanais(canais, montarMensagemEntrega(logs, horasLimite));
  const algumSucesso = resultados.some((resultado) => resultado.sucesso);
  recordSystemLog({
    nivel: algumSucesso ? "aviso" : "erro",
    categoria: "notificacao",
    evento: "alerta_entrega",
    titulo: `${logs.length} ${logs.length === 1 ? "envio requer" : "envios requerem"} atenção`,
    mensagem: algumSucesso
      ? "O sistema detectou envios sem confirmação e encaminhou o alerta aos canais configurados."
      : "O sistema detectou envios sem confirmação, mas nenhum canal confirmou o recebimento do alerta.",
    origem: "automatico",
    detalhes: {
      tipo_verificacao: origemVerificacao,
      horas_limite: horasLimite,
      detectado_em: new Date().toISOString(),
      canais: resultados,
      envios: logs.map((log) => ({
        id: log.id,
        cliente: log.card_nome,
        telefone: log.telefone,
        enviado_em: log.created_at,
        tipo_envio: log.tipo_envio,
        status: log.status,
        ack: log.ack,
        erro: log.erro,
      })),
    },
  });
  if (algumSucesso) {
    marcarAlertaEnviado(logs.map((log) => log.id));
    console.log(`[Notificações] Alerta enviado sobre ${logs.length} envio(s) com problema de entrega.`);
  }
}

/**
 * Avisa sobre pendentes de resposta parados em "aguardando" além do prazo configurado (separado
 * do prazo de entrega — cliente pode ter recebido e simplesmente não respondido ainda).
 */
async function verificarRespostasPendentes(canais: CanalNotificacao[], origemVerificacao: OrigemVerificacao): Promise<void> {
  const horasLimite = lerHorasLimite("telegram_alerta_horas_resposta");
  const pendentes = listPendingRepliesPendentesDeAlerta(horasLimite);
  if (pendentes.length === 0) return;

  const resultados = await enviarParaTodosOsCanais(canais, montarMensagemResposta(pendentes, horasLimite));
  const algumSucesso = resultados.some((resultado) => resultado.sucesso);
  recordSystemLog({
    nivel: algumSucesso ? "aviso" : "erro",
    categoria: "notificacao",
    evento: "alerta_resposta",
    titulo: `${pendentes.length} ${pendentes.length === 1 ? "resposta está" : "respostas estão"} pendente`,
    mensagem: algumSucesso
      ? "O sistema detectou clientes sem resposta e encaminhou o alerta aos canais configurados."
      : "O sistema detectou clientes sem resposta, mas nenhum canal confirmou o recebimento do alerta.",
    origem: "automatico",
    detalhes: {
      tipo_verificacao: origemVerificacao,
      horas_limite: horasLimite,
      detectado_em: new Date().toISOString(),
      canais: resultados,
      pendentes: pendentes.map((pendente) => ({
        id: pendente.id,
        cliente: pendente.card_nome,
        telefone: pendente.telefone,
        enviado_em: pendente.created_at,
        status: pendente.status,
      })),
    },
  });
  if (algumSucesso) {
    marcarAlertaRespostaEnviado(pendentes.map((p) => p.id));
    console.log(`[Notificações] Alerta enviado sobre ${pendentes.length} pendente(s) sem resposta.`);
  }
}

/**
 * Verificação periódica combinada: dispara os dois alertas (entrega e resposta) acima em todos os
 * canais configurados. Roda de forma silenciosa se nenhum canal estiver configurado — a
 * funcionalidade é totalmente opcional.
 */
export async function verificarNotificacoesPendentes(origemVerificacao: OrigemVerificacao = "periodica"): Promise<void> {
  const canais = canaisConfigurados();
  if (canais.length === 0) return;

  await verificarEntregasPendentes(canais, origemVerificacao);
  await verificarRespostasPendentes(canais, origemVerificacao);
}
