import { io } from "socket.io-client";
import { BACKEND_URL } from "./utils";

let socket = null;

/**
 * Returns a singleton Socket.IO client instance.
 * The connection is made with credentials (cookies) so the
 * server-side auth middleware can verify the JWT.
 * Uses websocket transport to avoid cross-origin cookie issues with polling.
 */
export function getSocket() {
  if (!socket) {
    socket = io(BACKEND_URL, {
      withCredentials: true,
      autoConnect: false,
      transports: ["websocket"],
      reconnectionAttempts: 5,
      reconnectionDelay: 2000,
    });
  }
  return socket;
}

/**
 * Disconnect and reset the singleton so a fresh connection
 * can be created (e.g. after logout).
 */
export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}
