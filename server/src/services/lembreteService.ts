import { emitEvent } from "../websocket";
import { getPericiaAgendada } from "./periciasAgendadasService";
import { getSetting } from "./settingsService";
import { LEMBRETE_AMANHA_MENSAGEM_PADRAO, LEMBRETE_HOJE_MENSAGEM_PADRAO } from "./templateService";
import { renderCobranca } from "./templateRenderer";
import { whatsappManager } from "./whatsappService";

export type PeriodoLembrete = "hoje" | "amanha";

function diaLocalYMD(dataHoraMs: number): string {
  return new Date(dataHoraMs).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

/**
 * Classifica o evento em "hoje" (mensagem de hoje) ou "amanha" (mensagem para qualquer
 * compromisso futuro — o painel "Próximas Perícias" mostra o próximo dia com perícia, que pode
 * ser depois de amanhã se os dias mais próximos estiverem vazios). A partir da própria data do
 * evento, não do que o frontend mandar — evita mandar o lembrete errado se o horário virar meia-
 * noite entre o usuário abrir a tela e clicar em enviar. Datas passadas voltam null (não faz
 * sentido "lembrar" de algo que já aconteceu).
 */
export function periodoDoEvento(dataHoraMs: number): PeriodoLembrete | null {
  const diaEvento = diaLocalYMD(dataHoraMs);
  const hoje = diaLocalYMD(Date.now());
  if (diaEvento === hoje) return "hoje";
  if (diaEvento > hoje) return "amanha";
  return null;
}

function mensagemConfiguradaPara(periodo: PeriodoLembrete): string {
  return periodo === "hoje"
    ? getSetting("lembrete_hoje_mensagem") || LEMBRETE_HOJE_MENSAGEM_PADRAO
    : getSetting("lembrete_amanha_mensagem") || LEMBRETE_AMANHA_MENSAGEM_PADRAO;
}

/** Envia o lembrete de um evento específico. Lança um Error com mensagem amigável em caso de falha. */
export async function enviarLembretePorId(id: number): Promise<void> {
  const pericia = getPericiaAgendada(id);
  if (!pericia) throw new Error("Evento não encontrado.");
  if (pericia.status !== "ativa") throw new Error("Este evento não está mais ativo.");
  if (!whatsappManager.isReady()) throw new Error("WhatsApp não está conectado.");

  const periodo = periodoDoEvento(pericia.data_hora_ms);
  if (!periodo) throw new Error("Este evento já passou — não é possível enviar um lembrete para ele.");

  const chatId = await whatsappManager.resolveChatId(pericia.telefone_digits);
  if (!chatId) throw new Error("Este telefone não foi encontrado no WhatsApp.");

  const texto = renderCobranca(mensagemConfiguradaPara(periodo), pericia.nome, {
    tipo: pericia.tipo,
    data: pericia.data,
    horario: pericia.horario || "",
    local: pericia.local || "",
    telefone: pericia.telefone,
    processo: pericia.processo || "",
    nome: pericia.nome,
  });
  await whatsappManager.sendMessage(chatId, texto);
}

function randomDelayMs(minSec: number, maxSec: number): number {
  const min = Math.min(minSec, maxSec);
  const max = Math.max(minSec, maxSec);
  return (min + Math.random() * (max - min)) * 1000;
}

/**
 * Envia em lote, com o mesmo intervalo aleatório entre mensagens usado no disparo normal (evita
 * risco de bloqueio da conta). Roda em segundo plano — a rota responde antes de terminar e o
 * progresso chega por WebSocket. Se o WhatsApp cair no meio, para e reporta quantos já foram
 * enviados; ao contrário do disparo principal, não espera reconexão automática — o usuário
 * reconecta e clica em "Enviar todos" de novo para o restante (mais simples, e essa ação é
 * disparada manualmente pelo usuário, então ele já está com a tela aberta para retomar).
 */
export async function enviarLembretesEmMassa(ids: number[], intervalMinSec: number, intervalMaxSec: number): Promise<void> {
  emitEvent("lembrete:batch-started", { total: ids.length });

  for (let i = 0; i < ids.length; i++) {
    if (!whatsappManager.isReady()) {
      emitEvent("lembrete:batch-paused", {
        reason: "O WhatsApp desconectou durante o envio. Reconecte e clique em 'Enviar todos' novamente para o restante.",
        enviados: i,
        total: ids.length,
      });
      return;
    }

    try {
      await enviarLembretePorId(ids[i]);
      emitEvent("lembrete:update", { id: ids[i], status: "sucesso" });
    } catch (err) {
      emitEvent("lembrete:update", { id: ids[i], status: "falha", erro: (err as Error).message });
    }

    if (i < ids.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, randomDelayMs(intervalMinSec, intervalMaxSec)));
    }
  }

  emitEvent("lembrete:batch-completed", { total: ids.length });
}
