import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";

let io: Server | null = null;

export function initWebsocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: "*" },
  });
  return io;
}

export function emitEvent(event: string, payload: unknown): void {
  io?.emit(event, payload);
}
