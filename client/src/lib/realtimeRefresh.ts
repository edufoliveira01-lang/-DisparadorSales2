interface EventSource {
  on: (event: string, handler: () => void) => unknown;
  off: (event: string, handler: () => void) => unknown;
}

export function subscribeRealtimeRefresh(
  refresh: () => Promise<unknown>,
  events: readonly string[],
  source: EventSource,
  visibility: Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">,
  intervalMs: number
): () => void {
  let disposed = false;
  let running = false;
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const run = async () => {
    timer = undefined;
    if (disposed) return;
    if (running) { dirty = true; return; }
    running = true;
    try { await refresh(); } catch { /* O próximo evento/reconexão tenta novamente. */ }
    finally {
      running = false;
      if (dirty && !disposed) { dirty = false; schedule(); }
    }
  };
  const schedule = () => {
    if (!disposed && timer === undefined) timer = setTimeout(run, 150);
  };
  const visible = () => { if (visibility.visibilityState === "visible") schedule(); };
  for (const event of events) source.on(event, schedule);
  source.on("connect", schedule);
  visibility.addEventListener("visibilitychange", visible);
  const interval = setInterval(visible, intervalMs);
  return () => {
    disposed = true;
    clearTimeout(timer);
    clearInterval(interval);
    for (const event of events) source.off(event, schedule);
    source.off("connect", schedule);
    visibility.removeEventListener("visibilitychange", visible);
  };
}
