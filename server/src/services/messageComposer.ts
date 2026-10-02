import Handlebars from "handlebars";
import { sortPericiasByDate, type Pericia } from "./parserService";
import { detectarRemarcacao, getPericiaAgendada } from "./periciasAgendadasService";
import { defaultRescheduleTemplate } from "./messageTemplateService";
import { getSetting } from "./settingsService";
import { getTemplate, renderMessages, renderAudiencia, AUDIENCIA_PRESENCIAL_MENSAGEM_PADRAO, AUDIENCIA_ONLINE_MENSAGEM_PADRAO, AUDIENCIA_HIBRIDA_MENSAGEM_PADRAO } from "./templateService";

export type ModoEnvio = "template" | "audiencia_presencial" | "audiencia_online" | "audiencia_hibrida";
export interface MessageInput { cardId: string; nomeCliente: string; telefone?: string; pericias: Pericia[]; modo?: ModoEnvio }

function validateMessages(messages: string[]): string[] {
  if (!messages.length) throw new Error("Nenhum compromisso válido para gerar mensagem.");
  if (messages.some(message => !message.trim())) throw new Error("A mensagem ficou vazia. Revise o template antes de enviar.");
  return messages;
}

export function composeMessages(item: MessageInput, templateId: number | null): string[] {
  const modo = item.modo || "template";
  if (!["template", "audiencia_presencial", "audiencia_online", "audiencia_hibrida"].includes(modo)) throw new Error("Modo de envio inválido.");
  const sorted = sortPericiasByDate((item.pericias || []).map(p => ({ ...p, nome: p.nome || item.nomeCliente, telefone: p.telefone || item.telefone || "" })));
  const pericias = modo === "template" ? sorted : sorted.slice(0, 1);
  const template = modo === "template" && templateId ? getTemplate(templateId) : undefined;
  if (modo === "template" && !template) throw new Error("Selecione um template de mensagem válido.");
  const normal = (events: Pericia[]): string[] => {
    if (modo === "template") return renderMessages(template!, item.nomeCliente, events);
    const defaults = { audiencia_presencial: AUDIENCIA_PRESENCIAL_MENSAGEM_PADRAO, audiencia_online: AUDIENCIA_ONLINE_MENSAGEM_PADRAO, audiencia_hibrida: AUDIENCIA_HIBRIDA_MENSAGEM_PADRAO };
    return events.length ? [renderAudiencia(getSetting(`${modo}_mensagem`) || defaults[modo], item.nomeCliente, events[0])] : [];
  };
  const changes = pericias.map(p => detectarRemarcacao(item.cardId, p));
  if (!changes.some(Boolean)) return validateMessages(normal(pericias));
  // Quando apenas um dos compromissos muda, o outro continua usando seu texto normal.
  return validateMessages(pericias.flatMap((p, index) => {
    const change = changes[index];
    if (!change) return normal([p]);
    const anterior = getPericiaAgendada(change.agendamento_anterior_id);
    const scope = p.origem === "audiencia" || modo !== "template" || /audi[eê]ncia/i.test(p.tipo) ? "audiencia" : p.origem === "social" || /social/i.test(p.tipo) ? "social" : "medica";
    const messageTemplate = defaultRescheduleTemplate(scope);
    if (!messageTemplate) throw new Error("Configure um template padrão de remarcação.");
    return [Handlebars.compile(messageTemplate.mensagem, { noEscape: true })({
      NOME: item.nomeCliente, TIPO_PERICIA: p.tipo, DATA: p.data, HORARIO: p.horario, LOCAL: p.local,
      TELEFONE: p.telefone || "", WHATSAPP: p.whatsapp || "", PROCESSO: p.processo || "", PROFISSIONAL_PERITO: p.profissionalPerito || "",
      DATA_ANTERIOR: change.data_anterior, HORARIO_ANTERIOR: change.horario_anterior || "", LOCAL_ANTERIOR: anterior?.local || "",
      NOVA_DATA: p.data, NOVO_HORARIO: p.horario, NOVO_LOCAL: p.local,
    })];
  }));
}
