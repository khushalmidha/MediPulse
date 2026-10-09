import { io } from "socket.io-client";
import { BACKEND_URL } from "./utils";
const sockets = new Map();
export function getSocket(scope = "account") {
  const target = new URL(BACKEND_URL, window.location.origin);
  const prefix = target.pathname.replace(/\/$/, "");
  const relayed = Boolean(prefix);
  if (!sockets.has(scope)) sockets.set(scope, io(target.origin, {
    path: `${prefix}/socket.io`,
    withCredentials: true, auth: { scope }, autoConnect: false,
    transports: relayed ? ["polling"] : ["polling", "websocket"], upgrade: !relayed, reconnectionAttempts: 5, reconnectionDelay: 2000,
  }));
  return sockets.get(scope);
}
export function disconnectSocket() {
  for (const socket of sockets.values()) socket.disconnect();
  sockets.clear();
}
