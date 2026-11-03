import type { Server as HttpServer } from "node:http";
import { limparCachesDjen } from "../services/djen/cache";
import { Server, type Socket } from "socket.io";
import { listActiveBatches } from "../services/batchProgressService";
import { getSession, getUserById } from "../services/authService";
import { effectivePermissions, type Permission } from "../services/accessService";

let io: Server | null = null;

function validateSocket(socket: Socket): boolean {
  const session = getSession(socket.data.sessionId, false);
  const user = session && getUserById(session.user_id);
  if (!user || !user.active) { socket.disconnect(true); return false; }
  const permissions = new Set(effectivePermissions(user).map((p) => `permission:${p}`));
  for (const room of socket.rooms) if (room.startsWith("permission:") && !permissions.has(room)) socket.leave(room);
  for (const room of permissions) socket.join(room);
  return true;
}

export function initWebsocket(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    cors: { origin: process.env.APP_URL || true, credentials: true },
  });
  io.use((socket, next) => {
    const cookie = socket.handshake.headers.cookie || "";
    const sessionId = cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("session_id="))?.slice(11);
    const session = sessionId && getSession(sessionId, false);
    const user = session && getUserById(session.user_id);
    if (!user || !user.active) return next(new Error("Não autenticado."));
    socket.data.userId = user.id;
    socket.data.sessionId = session.id;
    for (const permission of effectivePermissions(user)) socket.join(`permission:${permission}`);
    socket.join(`user:${user.id}`);
    socket.join(`session:${session.id}`);
    next();
  });
  io.on("connection", (socket) => {
    const timer = setInterval(() => validateSocket(socket), 30_000);
    timer.unref();
    socket.on("disconnect", () => clearInterval(timer));
    if (socket.rooms.has("permission:messages.send")) socket.emit("batch:state", listActiveBatches());
    socket.on("batch:request-state", () => {
      if (validateSocket(socket) && socket.rooms.has("permission:messages.send")) socket.emit("batch:state", listActiveBatches());
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
  if (event === "djen:changed") limparCachesDjen();
  // Também verifica antes de transmitir: não há janela de exposição entre os ciclos do timer.
  for (const socket of io?.sockets.sockets.values() ?? []) validateSocket(socket);
  const permission = eventPermission(event);
  if (permission) io?.to(`permission:${permission}`).emit(event, payload);
  else io?.emit(event, payload);
}

export function disconnectUserSockets(userId: number): void {
  io?.in(`user:${userId}`).disconnectSockets(true);
}

export function disconnectSessionSockets(sessionId: string): void {
  io?.in(`session:${sessionId}`).disconnectSockets(true);
}

