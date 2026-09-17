import { emitEvent } from "../websocket";
import { startBatch, updateBatch, finishBatch } from "./batchProgressService";
import { db } from "../db";
import { createLog, type SendLog } from "./logsService";
import { getContact, listContacts, updateContact, type Contact } from "./contactsService";
import { matchContactByNameAndProcess, normalizeName } from "./matcherService";
import {
  getPericiaAgendada,
  marcarLembreteEnviado,
  updatePericiaAgendada,
  type PericiaAgendada,
} from "./periciasAgendadasService";
import type { Pericia } from "./parserService";
import {
  agruparEventosParaLembrete,
  detectarPendenciasProcesso,
  periodoDoEvento,
  type PendenciaProcessoLembrete,
  type PeriodoLembrete,
} from "./lembreteUtils";
import { getSetting } from "./settingsService";
import {
  LEMBRETE_AMANHA_MENSAGEM_PADRAO,
  LEMBRETE_FUTURO_MENSAGEM_PADRAO,
  LEMBRETE_HOJE_MENSAGEM_PADRAO,
  renderLembrete,
} from "./templateService";
import { whatsappManager } from "./whatsappService";
import { normalizePhone } from "../utils/phone";
import { normalizeProcesso } from "../utils/processo";

export interface ResultadoEnvioLembrete {
  status: "sucesso" | "ignorado";
  ids: number[];
  log?: SendLog;
}

export class ProcessoLembretePendenteError extends Error {
  constructor(public readonly pendencia: PendenciaProcessoLembrete) {
    super("Informe o número do processo para confirmar o contato e continuar o envio.");
  }
}

const enviosEmAndamento = new Set<number>();
let loteEmAndamento = false;

function mensagemConfiguradaPara(periodo: PeriodoLembrete): string {
  if (periodo === "hoje") {
    return getSetting("lembrete_hoje_mensagem") || LEMBRETE_HOJE_MENSAGEM_PADRAO;
  }
  if (periodo === "amanha") {
    return getSetting("lembrete_amanha_mensagem") || LEMBRETE_AMANHA_MENSAGEM_PADRAO;
  }
  return getSetting("lembrete_futuro_mensagem") || LEMBRETE_FUTURO_MENSAGEM_PADRAO;
}

function paraPericia(pericia: PericiaAgendada): Pericia {
  return {
    tipo: pericia.tipo,
    origem: (pericia.origem as Pericia["origem"]) || undefined,
    nome: pericia.nome,
    telefone: pericia.telefone,
    whatsapp: pericia.whatsapp || undefined,
    processo: pericia.processo || undefined,
    data: pericia.data,
    horario: pericia.horario || "",
    local: pericia.local || "",
    profissionalPerito: pericia.profissional_perito || undefined,
  };
}

function contatoSeguroDaAgenda(pericia: PericiaAgendada, contatos: Contact[]): Contact | null {
  return matchContactByNameAndProcess(pericia.nome, pericia.processo, contatos);
}

export function listarPendenciasProcessoLembrete(ids: number[]): PendenciaProcessoLembrete[] {
  const eventos = Array.from(new Set(ids))
    .map((id) => getPericiaAgendada(id))
    .filter((evento): evento is PericiaAgendada => Boolean(evento && evento.status === "ativa"));
  return detectarPendenciasProcesso(eventos, listContacts());
}

export function completarProcessoLembrete(ids: number[], contactId: number, processo: string): void {
  const processoLimpo = processo.trim();
  if (!normalizeProcesso(processoLimpo)) throw new Error("Informe um número de processo válido.");

  const contato = getContact(contactId);
  if (!contato) throw new Error("Contato da agenda não encontrado.");
  const contatos = listContacts();

  const idsUnicos = Array.from(new Set(ids));
  const eventos = idsUnicos
    .map((id) => getPericiaAgendada(id))
    .filter((evento): evento is PericiaAgendada => Boolean(evento && evento.status === "ativa"));
  if (eventos.length !== idsUnicos.length) throw new Error("Um dos compromissos não foi encontrado ou não está mais ativo.");
  if (eventos.some((evento) => normalizeName(evento.nome) !== normalizeName(contato.nome))) {
    throw new Error("O contato selecionado não corresponde ao cliente do compromisso.");
  }
  const pendenciaConfirmada = detectarPendenciasProcesso(eventos, contatos).some(
    (pendencia) =>
      pendencia.contato.id === contactId &&
      pendencia.ids.length === idsUnicos.length &&
      pendencia.ids.every((id) => idsUnicos.includes(id))
  );
  if (!pendenciaConfirmada) {
    throw new Error("Não foi possível confirmar com segurança o vínculo entre o contato e os compromissos.");
  }

  updateContact(contato.id, contato.nome, contato.telefone, contato.observacoes || undefined, processoLimpo);
  for (const evento of eventos) {
    updatePericiaAgendada(evento.id, {
      tipo: evento.tipo,
      nome: evento.nome,
      telefone: evento.telefone,
      processo: processoLimpo,
      data: evento.data,
      horario: evento.horario,
      local: evento.local,
      whatsapp: evento.whatsapp,
      profissional_perito: evento.profissional_perito,
    });
  }
}

function aplicarTelefoneDaAgenda(pericia: PericiaAgendada, contatos: Contact[]): PericiaAgendada {
  const contato = contatoSeguroDaAgenda(pericia, contatos);
  if (!contato) return pericia;
  const telefoneDigits = normalizePhone(contato.telefone);
  if (!telefoneDigits) return pericia;
  return { ...pericia, telefone: contato.telefone, telefone_digits: telefoneDigits };
}

async function enviarGrupoLembrete(
  eventos: PericiaAgendada[],
  forcar = false,
  contatosAgenda: Contact[] = listContacts()
): Promise<ResultadoEnvioLembrete> {
  const pendenciaProcesso = detectarPendenciasProcesso(eventos, contatosAgenda)[0];
  if (pendenciaProcesso) throw new ProcessoLembretePendenteError(pendenciaProcesso);

  const ativos = eventos
    .filter((evento) => evento.status === "ativa")
    .map((evento) => aplicarTelefoneDaAgenda(evento, contatosAgenda));
  if (ativos.length === 0) throw new Error("Este evento não está mais ativo.");

  const alvos = forcar ? ativos : ativos.filter((evento) => !evento.ultimo_lembrete_em);
  if (alvos.length === 0) return { status: "ignorado", ids: ativos.map((evento) => evento.id) };

  if (alvos.some((evento) => enviosEmAndamento.has(evento.id))) {
    throw new Error("Já existe um lembrete sendo enviado para este compromisso.");
  }
  for (const evento of alvos) enviosEmAndamento.add(evento.id);

  const principal = alvos[0];
  const periodo = periodoDoEvento(principal.data_hora_ms);
  if (!periodo) {
    for (const evento of alvos) enviosEmAndamento.delete(evento.id);
    throw new Error("Este evento já passou e não pode receber um lembrete.");
  }

  const pericias = alvos.map(paraPericia);
  const mensagem = renderLembrete(mensagemConfiguradaPara(periodo), principal.nome, pericias);
  const cardIdLog = `lembrete:${alvos.map((evento) => evento.id).join(",")}`;
  const contatoAgenda = contatoSeguroDaAgenda(principal, contatosAgenda);

  try {
    if (!whatsappManager.isReady()) throw new Error("WhatsApp não está conectado.");
    if (!principal.telefone_digits) throw new Error("Este compromisso não possui telefone válido.");
    const chatId = await whatsappManager.resolveChatId(principal.telefone_digits);
    if (!chatId) throw new Error("Este telefone não foi encontrado no WhatsApp.");

    const whatsappMessageId = await whatsappManager.sendMessage(chatId, mensagem);
    const log = db.transaction(() => {
      const criado = createLog({
        card_id: cardIdLog,
        card_nome: principal.nome,
        contact_id: contatoAgenda?.id ?? null,
        telefone: principal.telefone,
        pericias_json: JSON.stringify(pericias),
        mensagem_enviada: mensagem,
        status: "sucesso",
        erro: null,
        whatsapp_message_id: whatsappMessageId,
        tipo_envio: "lembrete",
      });
      marcarLembreteEnviado(alvos.map((evento) => evento.id), criado.id);
      return criado;
    })();
    return { status: "sucesso", ids: alvos.map((evento) => evento.id), log };
  } catch (err) {
    const erro = (err as Error).message || "Erro ao enviar lembrete.";
    createLog({
      card_id: cardIdLog,
      card_nome: principal.nome,
      contact_id: contatoAgenda?.id ?? null,
      telefone: principal.telefone,
      pericias_json: JSON.stringify(pericias),
      mensagem_enviada: mensagem,
      status: "falha",
      erro,
      tipo_envio: "lembrete",
    });
    throw new Error(erro);
  } finally {
    for (const evento of alvos) enviosEmAndamento.delete(evento.id);
    emitEvent("lembrete:sent", {});
  }
}

export async function enviarLembretePorId(id: number, forcar = false): Promise<ResultadoEnvioLembrete> {
  const pericia = getPericiaAgendada(id);
  if (!pericia) throw new Error("Evento não encontrado.");
  return enviarGrupoLembrete([pericia], forcar);
}

function randomDelayMs(minSec: number, maxSec: number): number {
  const min = Math.min(minSec, maxSec);
  const max = Math.max(minSec, maxSec);
  return (min + Math.random() * (max - min)) * 1000;
}

export function loteLembretesEmAndamento(): boolean {
  return loteEmAndamento;
}

export async function enviarLembretesEmMassa(ids: number[], intervalMinSec: number, intervalMaxSec: number): Promise<void> {
  if (loteEmAndamento) throw new Error("Já existe um lote de lembretes em andamento.");
  loteEmAndamento = true;
  let loteId: string | null = null;

  try {
    const eventos = Array.from(new Set(ids))
      .map((id) => getPericiaAgendada(id))
      .filter((evento): evento is PericiaAgendada => Boolean(evento && evento.status === "ativa"));
    const ignorados = eventos.filter((evento) => Boolean(evento.ultimo_lembrete_em)).length;
    const pendentes = eventos.filter((evento) => !evento.ultimo_lembrete_em);
    const contatosAgenda = listContacts();
    const pendentesComTelefoneDaAgenda = pendentes.map((evento) => aplicarTelefoneDaAgenda(evento, contatosAgenda));
    const grupos = agruparEventosParaLembrete(pendentesComTelefoneDaAgenda);
    let enviados = 0;
    let falhas = 0;

    loteId = startBatch("lembretes", grupos.length, ignorados);
    emitEvent("lembrete:batch-started", { total: grupos.length, ignorados });

    for (let i = 0; i < grupos.length; i++) {
      if (!whatsappManager.isReady()) {
        emitEvent("lembrete:batch-paused", {
          reason: "O WhatsApp desconectou durante o envio. Reconecte e retome o lote; os lembretes já enviados serão ignorados.",
          enviados,
          falhas,
          ignorados,
          restantes: grupos.length - i,
          total: grupos.length,
        });
        return;
      }

      const grupo = grupos[i];
      try {
        const resultado = await enviarGrupoLembrete(grupo.eventos, false, contatosAgenda);
        if (resultado.status === "sucesso") enviados += 1;
        emitEvent("lembrete:update", {
          ids: resultado.ids,
          nome: grupo.eventos[0].nome,
          status: resultado.status,
          enviados,
          falhas,
          total: grupos.length,
        });
      } catch (err) {
        falhas += 1;
        emitEvent("lembrete:update", {
          ids: grupo.eventos.map((evento) => evento.id),
          nome: grupo.eventos[0].nome,
          status: "falha",
          erro: (err as Error).message,
          enviados,
          falhas,
          total: grupos.length,
        });
      }

      updateBatch(loteId, { processados: i + 1, enviados, falhas });
      if (i < grupos.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, randomDelayMs(intervalMinSec, intervalMaxSec)));
      }
    }

    emitEvent("lembrete:batch-completed", { total: grupos.length, enviados, falhas, ignorados });
  } catch (err) {
    emitEvent("lembrete:batch-paused", { reason: (err as Error).message });
    throw err;
  } finally {
    if (loteId) finishBatch(loteId);
    loteEmAndamento = false;
  }
}
