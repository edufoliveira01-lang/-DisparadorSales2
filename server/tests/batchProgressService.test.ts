import { afterEach, describe, expect, it, vi } from "vitest";
import { batchInProgress, finishBatch, listActiveBatches, startBatch, updateBatch } from "../src/services/batchProgressService";
import { emitEvent } from "../src/websocket";

vi.mock("../src/websocket", () => ({ emitEvent: vi.fn() }));

afterEach(() => {
  for (const lote of listActiveBatches()) finishBatch(lote.id);
  vi.clearAllMocks();
});

describe("progresso global de lotes", () => {
  it("guarda progresso recuperável ao navegar/reconectar e remove ao concluir", () => {
    const id = startBatch("mensagens", 4);
    updateBatch(id, { processados: 2, enviados: 1, falhas: 1 });
    expect(listActiveBatches()).toEqual([expect.objectContaining({ id, total: 4, processados: 2, enviados: 1, falhas: 1 })]);
    expect(emitEvent).toHaveBeenLastCalledWith("batch:state", listActiveBatches());
    finishBatch(id);
    expect(listActiveBatches()).toEqual([]);
    expect(emitEvent).toHaveBeenLastCalledWith("batch:state", []);
  });
  it("mantém lote de lembretes independente e bloqueia outro lote do mesmo tipo", () => {
    const mensagens = startBatch("mensagens", 2);
    startBatch("lembretes", 3, 1);
    expect(batchInProgress("mensagens")).toBe(true);
    expect(() => startBatch("mensagens", 1)).toThrow();
    finishBatch(mensagens);
    expect(listActiveBatches()).toEqual([expect.objectContaining({ tipo: "lembretes", ignorados: 1 })]);
  });
  it("sinaliza espera e retomada de reconexão sem perder as contagens", () => {
    const id = startBatch("mensagens", 3);
    updateBatch(id, { processados: 1, enviados: 1, aguardandoReconexao: true });
    expect(listActiveBatches()[0].aguardandoReconexao).toBe(true);
    updateBatch(id, { aguardandoReconexao: false });
    expect(listActiveBatches()[0]).toMatchObject({ processados: 1, enviados: 1, aguardandoReconexao: false });
    const retrato = listActiveBatches();
    retrato[0].enviados = 99;
    expect(listActiveBatches()[0].enviados).toBe(1);
  });
});
