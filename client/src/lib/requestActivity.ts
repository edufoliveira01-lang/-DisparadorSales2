export interface RequestActivity { id: number; label: string; count: number }
let sequence = 0;
let snapshot: RequestActivity[] = [];
const pending = new Map<number, string>();
const listeners = new Set<() => void>();
function publish() {
  const groups = new Map<string, RequestActivity>();
  for (const [id, label] of pending) {
    const group = groups.get(label);
    if (group) group.count++;
    else groups.set(label, { id, label, count: 1 });
  }
  snapshot = [...groups.values()];
  listeners.forEach(listener => listener());
}
export const requestActivities = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot,
};

export function activityLabel(path: string, method = "GET"): string {
  if (path.startsWith("/whatsapp/")) return "Atualizando conexão do WhatsApp";
  if (path.startsWith("/djen/codex/")) return "Preparando análise pelo Codex";
  if (path.startsWith("/djen/calendarios")) return "Atualizando calendários dos tribunais";
  if (path.startsWith("/djen/buscar")) return "Iniciando busca no DJEN";
  if (path.startsWith("/djen/")) return method === "GET" ? "Carregando processos e DJEN" : "Atualizando processos e DJEN";
  if (path.startsWith("/google-calendar/")) return "Atualizando Google Agenda";
  if (/lembrete/.test(path)) return "Processando lembretes";
  if (path.startsWith("/send/") || /reenviar/.test(path)) return "Processando mensagens";
  if (path.startsWith("/trello/") || path.includes("sincronizar-trello")) return "Sincronizando com o Trello";
  if (path.startsWith("/pericias-agendadas")) return method === "GET" ? "Carregando agenda de perícias" : "Atualizando agenda de perícias";
  if (path.startsWith("/contacts")) return method === "GET" ? "Carregando contatos" : "Atualizando contatos";
  if (/^\/(logs|system-logs|pending-replies)/.test(path)) return "Carregando histórico e acompanhamentos";
  if (/^\/(settings|auth)/.test(path)) return "Atualizando configurações";
  if (path.startsWith("/cards")) return "Carregando clientes do Trello";
  if (/template/.test(path)) return "Carregando modelos de mensagem";
  return method === "GET" ? "Carregando informações" : "Salvando alterações";
}

/** Only slow requests appear; ownership is independent of the page that started them. */
export function beginRequestActivity(label: string, delayMs = 700): () => void {
  const id = ++sequence;
  let ended = false;
  const timer = setTimeout(() => {
    if (!ended) { pending.set(id, label); publish(); }
  }, delayMs);
  return () => {
    if (ended) return;
    ended = true;
    clearTimeout(timer);
    if (pending.delete(id)) publish();
  };
}
