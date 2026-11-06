import { listLogsPendentesDeAlerta, type SendLog } from "./logsService";
import {
  listPendingRepliesPendentesDeAlerta,
  type PendingReply,
} from "./pendingRepliesService";
import { getSetting } from "./settingsService";
import { enviarMensagemTelegram } from "./telegramService";
import { enviarMensagemWhapi } from "./whapiService";
import { recordSystemLog } from "./systemLogsService";
import {
  markNotificationDelivered,
  type NotificationChannel,
} from "./notificationDeliveryService";

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
      ? "⚠️ 1 mensagem do DisparaZap ainda não tem confirmação de entrega:"
      : `⚠️ ${logs.length} mensagens do DisparaZap ainda não têm confirmação de entrega:`;
  return `${titulo}\n\nOrigem: verificação automática do sistema.\nResumo: ${logs.length} aguardando resposta sem dois tiques de entrega há mais de ${horasLimite}h.\n\nConfira os acompanhamentos em Aguardando resposta no DisparaZap.`;
}

function montarMensagemResposta(pendentes: PendingReply[], horasLimite: number): string {
  const titulo =
    pendentes.length === 1
      ? "🕑 1 cliente ainda não respondeu ao DisparaZap:"
      : `🕑 ${pendentes.length} clientes ainda não responderam ao DisparaZap:`;
  return `${titulo}\n\nOrigem: verificação automática do sistema.\nResumo: ${pendentes.length} com dois tiques de entrega e sem resposta há mais de ${horasLimite}h.\n\nConfira os acompanhamentos em Aguardando resposta no DisparaZap.`;
}

export interface CanalNotificacao {
  nome: NotificationChannel;
  enviar: (texto: string) => Promise<void>;
}

function mensagemErro(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function registrarCanalIndisponivel(canal: NotificationChannel, err: unknown): void {
  const erro = mensagemErro(err);
  console.error(`[Notificações] Não foi possível carregar a configuração do canal ${canal}:`, err);
  recordSystemLog({
    nivel: "erro",
    categoria: "notificacao",
    evento: "falha_configuracao_canal",
    titulo: `${canal} indisponível para notificações`,
    mensagem: erro,
    origem: "automatico",
    detalhes: { canal, erro },
  });
}

/** Monta a lista de canais de notificação configurados (Telegram e/ou Whapi) — cada um é opcional
 * e independente, então o usuário pode ligar um, o outro, ou os dois ao mesmo tempo. */
export function canaisConfigurados(): CanalNotificacao[] {
  const canais: CanalNotificacao[] = [];

  try {
    const telegramToken = getSetting("telegram_bot_token");
    const telegramChatId = getSetting("telegram_chat_id");
    if (telegramToken && telegramChatId) {
      canais.push({ nome: "Telegram", enviar: (texto) => enviarMensagemTelegram(telegramToken, telegramChatId, texto) });
    }
  } catch (err) {
    registrarCanalIndisponivel("Telegram", err);
  }

  try {
    const whapiToken = getSetting("whapi_token");
    const whapiApiUrl = getSetting("whapi_api_url");
    const whapiNumero = getSetting("whapi_numero_notificacao");
    if (whapiToken && whapiApiUrl && whapiNumero) {
      canais.push({ nome: "Whapi", enviar: (texto) => enviarMensagemWhapi(whapiApiUrl, whapiToken, whapiNumero, texto) });
    }
  } catch (err) {
    registrarCanalIndisponivel("Whapi", err);
  }

  return canais;
}

export async function enviarPeloCanal(canal: CanalNotificacao, texto: string): Promise<ResultadoCanal> {
  try {
    await canal.enviar(texto);
    return { canal: canal.nome, sucesso: true, erro: null };
  } catch (err) {
    const erro = mensagemErro(err);
    console.error(`[Notificações] Erro ao enviar alerta pelo canal ${canal.nome}:`, err);
    return { canal: canal.nome, sucesso: false, erro };
  }
}

/**
 * Avisa somente sobre acompanhamentos ativos cujo envio ainda não tem dois tiques.
 */
async function verificarEntregasPendentes(canais: CanalNotificacao[], origemVerificacao: OrigemVerificacao): Promise<void> {
  const horasLimite = lerHorasLimite("telegram_alerta_horas");
  await Promise.all(canais.map(async (canal) => {
    const logs = listLogsPendentesDeAlerta(horasLimite, canal.nome);
    if (logs.length === 0) return;

    const resultado = await enviarPeloCanal(canal, montarMensagemEntrega(logs, horasLimite));
    recordSystemLog({
      nivel: resultado.sucesso ? "aviso" : "erro",
      categoria: "notificacao",
      evento: "alerta_entrega",
      titulo: `${logs.length} ${logs.length === 1 ? "envio aguarda" : "envios aguardam"} confirmação de entrega (${canal.nome})`,
      mensagem: resultado.sucesso
        ? `O sistema detectou acompanhamento sem confirmação de entrega e encaminhou o alerta pelo canal ${canal.nome}.`
        : `O sistema detectou acompanhamento sem confirmação de entrega, mas o canal ${canal.nome} não confirmou o recebimento do alerta.`,
      origem: "automatico",
      detalhes: {
        tipo_verificacao: origemVerificacao,
        regra_alerta: "nao_entregue",
        horas_limite: horasLimite,
        detectado_em: new Date().toISOString(),
        canais: [resultado],
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
    if (resultado.sucesso) {
      markNotificationDelivered("entrega", canal.nome, logs.map((log) => log.id));
      console.log(`[Notificações] Alerta enviado pela ${canal.nome} sobre ${logs.length} envio(s) com problema de entrega.`);
    }
  }));
}

/**
 * Avisa sobre pendentes de resposta parados em "aguardando" além do prazo configurado (separado
 * do prazo de entrega — cliente pode ter recebido e simplesmente não respondido ainda).
 */
async function verificarRespostasPendentes(canais: CanalNotificacao[], origemVerificacao: OrigemVerificacao): Promise<void> {
  const horasLimite = lerHorasLimite("telegram_alerta_horas_resposta");
  await Promise.all(canais.map(async (canal) => {
    const pendentes = listPendingRepliesPendentesDeAlerta(horasLimite, canal.nome);
    if (pendentes.length === 0) return;

    const resultado = await enviarPeloCanal(canal, montarMensagemResposta(pendentes, horasLimite));
    recordSystemLog({
      nivel: resultado.sucesso ? "aviso" : "erro",
      categoria: "notificacao",
      evento: "alerta_resposta",
      titulo: `${pendentes.length} ${pendentes.length === 1 ? "resposta está" : "respostas estão"} pendente (${canal.nome})`,
      mensagem: resultado.sucesso
        ? `O sistema detectou clientes sem resposta e encaminhou o alerta pelo canal ${canal.nome}.`
        : `O sistema detectou clientes sem resposta, mas o canal ${canal.nome} não confirmou o recebimento do alerta.`,
      origem: "automatico",
      detalhes: {
        tipo_verificacao: origemVerificacao,
        regra_alerta: "nao_respondida",
        horas_limite: horasLimite,
        detectado_em: new Date().toISOString(),
        canais: [resultado],
        pendentes: pendentes.map((pendente) => ({
          id: pendente.id,
          cliente: pendente.card_nome,
          telefone: pendente.telefone,
          enviado_em: pendente.created_at,
          status: pendente.status,
          ack: pendente.ack,
        })),
      },
    });
    if (resultado.sucesso) {
      markNotificationDelivered("resposta", canal.nome, pendentes.map((p) => p.id));
      console.log(`[Notificações] Alerta enviado pela ${canal.nome} sobre ${pendentes.length} pendente(s) sem resposta.`);
    }
  }));
}

/**
 * Verificação dos acompanhamentos ativos, com um alerta por tipo e por canal configurado.
 * Uma execução anterior precisa terminar antes da próxima começar.
 */
let verificacaoEmAndamento = false;
export async function verificarNotificacoesPendentes(origemVerificacao: OrigemVerificacao = "periodica"): Promise<void> {
  if (verificacaoEmAndamento) return;
  verificacaoEmAndamento = true;
  try {
    const canais = canaisConfigurados();
    if (canais.length === 0) return;
    await Promise.all([
      verificarEntregasPendentes(canais, origemVerificacao),
      verificarRespostasPendentes(canais, origemVerificacao),
    ]);
  } finally {
    verificacaoEmAndamento = false;
  }
}

