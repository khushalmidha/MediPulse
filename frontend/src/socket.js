import { io } from "socket.io-client";
import { BACKEND_URL } from "./utils";
import Cookies from "js-cookie";

let socket = null;

/**
 * Returns a singleton Socket.IO client instance.
 * Passes the JWT token via the auth option so it works
 * cross-origin (cookies are blocked by browsers on cross-origin WebSocket).
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
  // Always refresh the auth token from the latest cookie so reconnects and
  // late connections use the current session token instead of a stale one.
  const token = Cookies.get("staffToken") || Cookies.get("token") || "";
  socket.auth = { token };
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
