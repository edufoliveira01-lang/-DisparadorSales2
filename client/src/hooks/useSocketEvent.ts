import { useEffect } from "react";
import { socket } from "@/lib/socket";

export function useSocketEvent<T = unknown>(event: string, handler: (payload: T) => void): void {
  useEffect(() => {
    socket.on(event, handler);
    return () => {
      socket.off(event, handler);
    };
  }, [event, handler]);
}
