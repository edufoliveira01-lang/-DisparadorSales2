import { afterEach, describe, expect, it, vi } from "vitest";
import { activityLabel, beginRequestActivity, requestActivities } from "../../client/src/lib/requestActivity";

afterEach(() => { vi.useRealTimers(); });
describe("atividades globais de requisições", () => {
  it("ignora respostas rápidas e mantém a tarefa até a requisição terminar", async () => {
    vi.useFakeTimers();
    const fast = beginRequestActivity("rápida");
    await vi.advanceTimersByTimeAsync(100);
    fast();
    const slow = beginRequestActivity("busca");
    await vi.advanceTimersByTimeAsync(701);
    expect(requestActivities.getSnapshot()).toMatchObject([{ label: "busca", count: 1 }]);
    slow(); slow();
    expect(requestActivities.getSnapshot()).toEqual([]);
  });
  it("agrupa serviços simultâneos sem encerrar a outra requisição", async () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const unsubscribe = requestActivities.subscribe(changed);
    const first = beginRequestActivity("processos");
    const second = beginRequestActivity("processos");
    await vi.advanceTimersByTimeAsync(701);
    expect(requestActivities.getSnapshot()).toMatchObject([{ label: "processos", count: 2 }]);
    first();
    expect(requestActivities.getSnapshot()).toMatchObject([{ label: "processos", count: 1 }]);
    second(); unsubscribe();
    expect(requestActivities.getSnapshot()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(4);
  });
  it("identifica o serviço sem expor telefones, nomes ou parâmetros", () => {
    expect(activityLabel("/djen/publicacoes/123?cliente=Maria")).toBe("Carregando processos e DJEN");
    expect(activityLabel("/pericias-agendadas/8/lembrete", "POST")).toBe("Processando lembretes");
    expect(activityLabel("/contacts?telefone=11999999999")).toBe("Carregando contatos");
  });
});
