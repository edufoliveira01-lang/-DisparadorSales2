import type { RemarcacaoSnapshot, SendLog } from "./types";

/** Usa o retrato salvo no envio; não depende do calendário atual nem do texto do template. */
export function remarcacoesDoLog(log: Pick<SendLog, "remarcacoes_json">): RemarcacaoSnapshot[] {
  if (!log.remarcacoes_json) return [];
  try {
    const changes = JSON.parse(log.remarcacoes_json);
    if (!Array.isArray(changes)) return [];
    return changes.filter((change): change is RemarcacaoSnapshot =>
      change && typeof change.tipo === "string" && typeof change.processo === "string" &&
      typeof change.agendamento_anterior_id === "number" &&
      [change.anterior, change.novo].every(event => event &&
        typeof event.data === "string" && typeof event.horario === "string" && typeof event.local === "string")
    );
  } catch { return []; }
}

export function comparacaoRemarcacao(change: RemarcacaoSnapshot): string {
  const dateTime = (event: RemarcacaoSnapshot["anterior"]) => `${event.data}${event.horario ? ` às ${event.horario}` : ""}`;
  return `${dateTime(change.anterior)} → ${dateTime(change.novo)}`;
}
