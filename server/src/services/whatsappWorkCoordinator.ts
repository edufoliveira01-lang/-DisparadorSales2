/**
 * Compartilha trabalho já em execução dentro de uma conexão do WhatsApp.
 * Falhas não ficam memorizadas: o próximo evento pode tentar novamente.
 * A memória de eventos concluídos é curta e limitada, sem timers por mensagem.
 */
export class WhatsappWorkCoordinator {
  private scopes = new WeakMap<object, {
    running: Map<string, Promise<void>>;
    completed: Map<string, number>;
  }>();

  run(
    scope: object,
    key: string,
    work: () => Promise<void>,
    rememberMs = 0,
  ): Promise<void> {
    let state = this.scopes.get(scope);
    if (!state) {
      state = { running: new Map(), completed: new Map() };
      this.scopes.set(scope, state);
    }
    const now = Date.now();
    for (const [id, expires] of state.completed) {
      if (expires <= now) state.completed.delete(id);
    }
    const existing = state.running.get(key);
    if (existing) return existing;
    if ((state.completed.get(key) ?? 0) > now) return Promise.resolve();

    const current = state;
    // Adia a execução até registrar a promessa, inclusive para callbacks síncronos.
    const task = Promise.resolve().then(work).then(() => {
      if (rememberMs > 0) {
        current.completed.set(key, Date.now() + rememberMs);
        while (current.completed.size > 500) {
          const oldest = current.completed.keys().next().value;
          if (oldest === undefined) break;
          current.completed.delete(oldest);
        }
      }
    }).finally(() => {
      current.running.delete(key);
    });
    current.running.set(key, task);
    return task;
  }
}
