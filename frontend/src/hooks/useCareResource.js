import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";
import { createSnapshotGuard } from "../utils/queueSnapshot";
import { getSocket } from "../socket";

export function useOnlineStatus() {
  const [online, setOnline] = useState(navigator.onLine);
  useEffect(() => { const update = () => setOnline(navigator.onLine); window.addEventListener("online", update); window.addEventListener("offline", update); return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); }; }, []);
  return online;
}
export function useCareResource(path, owner = "public", poll = 0) {
  const scope = path && owner ? owner + ":" + path : null;
  const [state, setState] = useState({ scope: null, data: null, loading: true, error: "", refreshedAt: null });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  const guard = useRef(createSnapshotGuard());
  useEffect(() => {
    if (!scope) return undefined;
    let disposed = false, sequence = 0; const controller = new AbortController();
    const load = async () => {
      const current = ++sequence, ticket = guard.current.begin(scope);
      setState(previous => ({ ...previous, scope, data: previous.scope === scope ? previous.data : null, loading: true, error: "" }));
      try {
        const response = await axios.get(BACKEND_URL + path, { withCredentials: owner !== "public", signal: controller.signal });
        if (!disposed && current === sequence) {
          if (!response.data.queueKey || guard.current.accept(ticket, response.data)) setState({ scope, data: response.data, loading: false, error: "", errorStatus: null, refreshedAt: new Date() });
          else setState(previous => ({ ...previous, loading: false }));
        }
      } catch (error) { if (!disposed && !controller.signal.aborted && current === sequence) setState(previous => ({ ...previous, scope, data: [401, 403, 404].includes(error.response?.status) ? null : previous.data, loading: false, errorStatus: error.response?.status || null, error: error.response?.data?.message || "Unable to refresh. Please try again." })); }
    };
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    void load(); const timer = poll ? setInterval(load, poll) : null;
    window.addEventListener("online", load); document.addEventListener("visibilitychange", visible);
    const socket = poll && owner !== "public" ? getSocket() : null;
    if (socket) { if (!socket.connected) socket.connect(); for (const event of ["connect", "visit:changed", "appointment:user-status", "appointment:ended"]) socket.on(event, load); }
    return () => { disposed = true; controller.abort(); if (timer) clearInterval(timer); window.removeEventListener("online", load); document.removeEventListener("visibilitychange", visible); if (socket) for (const event of ["connect", "visit:changed", "appointment:user-status", "appointment:ended"]) socket.off(event, load); };
  }, [scope, path, owner, poll, attempt]);
  return { ...(state.scope === scope && scope ? state : { data: null, loading: Boolean(scope), error: "", refreshedAt: null }), refresh };
}
