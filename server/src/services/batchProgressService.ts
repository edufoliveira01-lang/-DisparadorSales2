import { randomUUID } from "node:crypto";
import { emitEvent } from "../websocket";

export interface BatchProgress {
  id: string;
  tipo: "mensagens" | "lembretes";
  total: number;
  processados: number;
  enviados: number;
  falhas: number;
  ignorados: number;
  aguardandoReconexao: boolean;
}

// A execução permanece no servidor. Este estado é apenas um retrato dos lotes ativos,
// recuperável por qualquer tela e após uma reconexão do navegador.
const ativos = new Map<string, BatchProgress>();

export function listActiveBatches(): BatchProgress[] {
  return Array.from(ativos.values(), (lote) => ({ ...lote }));
}

export function batchInProgress(tipo: BatchProgress["tipo"]): boolean {
  return listActiveBatches().some((lote) => lote.tipo === tipo);
}

export function startBatch(tipo: BatchProgress["tipo"], total: number, ignorados = 0): string {
  if (batchInProgress(tipo)) throw new Error("Já existe um lote deste tipo em andamento.");
  const id = randomUUID();
  ativos.set(id, { id, tipo, total, processados: 0, enviados: 0, falhas: 0, ignorados, aguardandoReconexao: false });
  emitEvent("batch:state", listActiveBatches());
  return id;
}

export function updateBatch(id: string, atualizacao: Partial<Omit<BatchProgress, "id" | "tipo">>): void {
  const lote = ativos.get(id);
  if (!lote) return;
  ativos.set(id, { ...lote, ...atualizacao });
  emitEvent("batch:state", listActiveBatches());
}

export function finishBatch(id: string): void {
  if (ativos.delete(id)) emitEvent("batch:state", listActiveBatches());
}
