import type { PericiaAgendada } from "./periciasAgendadasService";

export type PeriodoLembrete = "hoje" | "amanha" | "futuro";

export interface GrupoLembrete {
  chave: string;
  eventos: PericiaAgendada[];
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
