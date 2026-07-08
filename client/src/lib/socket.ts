import { io, type Socket } from "socket.io-client";

// Em produção, precisamos apontar para o IP:Porta do servidor se não houver proxy reverso (Nginx)
const SOCKET_URL = window.location.origin;

export const socket: Socket = io(SOCKET_URL, {
  path: "/socket.io",
  autoConnect: true,
});
