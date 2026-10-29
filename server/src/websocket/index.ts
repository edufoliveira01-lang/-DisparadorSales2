import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import { listActiveBatches } from "../services/batchProgressService";
import { getSession, getUserById } from "../services/authService";
import { effectivePermissions, hasPermission, type Permission } from "../services/accessService";

let io: Server | null = null;

export function initWebsocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: process.env.APP_URL || true, credentials: true },
  });
  io.use((socket, next) => {
    const cookie = socket.handshake.headers.cookie || "";
    const sessionId = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("session_id="))?.slice(11);
    const session = sessionId && getSession(sessionId);
    const user = session && getUserById(session.user_id);
    if (!user || !user.active) return next(new Error("Não autenticado."));
    socket.data.userId = user.id;
    for (const permission of effectivePermissions(user)) socket.join(`permission:${permission}`);
    socket.join(`user:${user.id}`);
    next();
  });
  io.on("connection", (socket) => {
    if (socket.rooms.has("permission:messages.send")) socket.emit("batch:state", listActiveBatches());
    socket.on("batch:request-state", () => {
      if (socket.rooms.has("permission:messages.send")) socket.emit("batch:state", listActiveBatches());
    });
  });
  return io;
}

function eventPermission(event: string): Permission | null {
  if (event.startsWith("djen:")) return "processes.view";
  if (event.startsWith("whatsapp:")) return "whatsapp.manage";
  if (event.startsWith("pendingReply:")) return "pending.view";
  if (event.startsWith("lembrete:")) return "calendar.view";
  if (event.startsWith("send:") || event.startsWith("batch:")) return "messages.send";
  return null;
}

export function emitEvent(event: string, payload: unknown): void {
  const permission = eventPermission(event);
  if (permission) io?.to(`permission:${permission}`).emit(event, payload);
  else io?.emit(event, payload);
}

export function disconnectUserSockets(userId: number): void {
  io?.in(`user:${userId}`).disconnectSockets(true);
}
