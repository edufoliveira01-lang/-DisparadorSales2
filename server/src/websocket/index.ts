import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { listActiveBatches } from "../services/batchProgressService";

let io: Server | null = null;

export function initWebsocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: "*" },
  });
  io.on("connection", (socket) => {
    socket.emit("batch:state", listActiveBatches());
    socket.on("batch:request-state", () => socket.emit("batch:state", listActiveBatches()));
  });
  return io;
}

export function emitEvent(event: string, payload: unknown): void {
  io?.emit(event, payload);
}
