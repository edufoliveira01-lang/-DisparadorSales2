import { useEffect, useRef } from "react";
import { socket } from "../lib/socket";
import { subscribeRealtimeRefresh } from "../lib/realtimeRefresh";

/** Agrupa eventos próximos e serializa as consultas para não aplicar respostas fora de ordem. */
export function useRealtimeRefresh(refresh: () => Promise<unknown>, events: readonly string[], intervalMs = 30000): void {
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => subscribeRealtimeRefresh(() => refreshRef.current(), events, socket, document, intervalMs), [events, intervalMs]);
}
