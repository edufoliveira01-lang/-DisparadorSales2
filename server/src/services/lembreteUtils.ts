import type { PericiaAgendada } from "./periciasAgendadasService";
import type { Contact } from "./contactsService";
import { matchContactByNameAndProcess, normalizeName } from "./matcherService";
import { normalizeProcesso } from "../utils/processo";

export type PeriodoLembrete = "hoje" | "amanha" | "futuro";

export interface GrupoLembrete {
  chave: string;
  eventos: PericiaAgendada[];
}

export interface PendenciaProcessoLembrete {
  ids: number[];
  nome: string;
  processo: string;
  contato: Pick<Contact, "id" | "nome" | "telefone">;
}

function contatoCandidatoParaCompletarProcesso(pericia: PericiaAgendada, contatos: Contact[]): Contact | null {
  const mesmoNome = contatos.filter((contato) => normalizeName(contato.nome) === normalizeName(pericia.nome));
  const processoEvento = normalizeProcesso(pericia.processo);

  // Com processo no evento, só é seguro sugerir um contato homônimo que ainda esteja sem
  // processo. Um processo divergente continua sendo tratado como erro, sem oferecer atalho.
  const candidatos = processoEvento
    ? mesmoNome.filter((contato) => !normalizeProcesso(contato.processo))
    : mesmoNome;
  return candidatos.length === 1 ? candidatos[0] : null;
}

export function detectarPendenciasProcesso(
  eventos: PericiaAgendada[],
  contatos: Contact[]
): PendenciaProcessoLembrete[] {
  const pendencias = new Map<string, PendenciaProcessoLembrete>();

  for (const evento of eventos) {
    if (evento.status !== "ativa" || evento.telefone_digits || matchContactByNameAndProcess(evento.nome, evento.processo, contatos)) {
      continue;
    }
    const contato = contatoCandidatoParaCompletarProcesso(evento, contatos);
    if (!contato) continue;

    const processo = (evento.processo || "").trim();
    const chave = `${contato.id}|${normalizeProcesso(processo)}`;
    const existente = pendencias.get(chave);
    if (existente) {
      existente.ids.push(evento.id);
      continue;
    }
    pendencias.set(chave, {
      ids: [evento.id],
      nome: evento.nome,
      processo,
      contato: { id: contato.id, nome: contato.nome, telefone: contato.telefone },
    });
  }

  return Array.from(pendencias.values());
}

function diaLocalYMD(dataHoraMs: number): string {
  return new Date(dataHoraMs).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function adicionarDiasYMD(ymd: string, dias: number): string {
  const [ano, mes, dia] = ymd.split("-").map(Number);
  const data = new Date(Date.UTC(ano, mes - 1, dia + dias, 12));
  return data.toISOString().slice(0, 10);
}

export function periodoDoEvento(dataHoraMs: number): PeriodoLembrete | null {
  const diaEvento = diaLocalYMD(dataHoraMs);
  const hoje = diaLocalYMD(Date.now());
  if (diaEvento === hoje) return "hoje";
  if (diaEvento === adicionarDiasYMD(hoje, 1)) return "amanha";
  if (diaEvento > hoje) return "futuro";
  return null;
}

export function agruparEventosParaLembrete(eventos: PericiaAgendada[]): GrupoLembrete[] {
  const grupos = new Map<string, PericiaAgendada[]>();
  for (const evento of eventos) {
    const telefone = evento.telefone_digits || `sem-telefone:${evento.id}`;
    const nome = evento.nome.trim().toLocaleLowerCase("pt-BR");
    const processo = (evento.processo || "").replace(/\D/g, "") || `sem-processo:${evento.id}`;
    const chave = `${diaLocalYMD(evento.data_hora_ms)}|${telefone}|${nome}|${processo}`;
    const grupo = grupos.get(chave) ?? [];
    grupo.push(evento);
    grupos.set(chave, grupo);
  }
  return Array.from(grupos, ([chave, itens]) => ({
    chave,
    eventos: itens.sort((a, b) => a.data_hora_ms - b.data_hora_ms),
  }));
}
