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
  const [state, setState] = useState({ scope: null, data: null, loading: true, refreshing: false, error: "", errorStatus: null, refreshedAt: null });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  const guard = useRef(createSnapshotGuard());
  useEffect(() => {
    if (!scope) return undefined;
    let disposed = false, inFlight = false, pendingReload = false, sequence = 0; const controller = new AbortController();
    const load = async (background = false) => {
      if (disposed) return;
      if (inFlight) {
        if (!background) { pendingReload = true; setState(previous => ({ ...previous, loading: true })); }
        return;
      }
      inFlight = true;
      const current = ++sequence, ticket = guard.current.begin(scope);
      setState(previous => ({ ...previous, scope, data: previous.scope === scope ? previous.data : null,
        loading: !background || previous.scope !== scope || !previous.data || Boolean(previous.error), refreshing: true,
        error: previous.scope === scope ? previous.error : "", errorStatus: previous.scope === scope ? previous.errorStatus : null }));
      try {
        const response = await axios.get(BACKEND_URL + path, { withCredentials: owner !== "public", signal: controller.signal, timeout: 15000 });
        if (!disposed && current === sequence) {
          const snapshot = { queueKey: response.data.queueKey, queueRevision: response.data.queueRevision ?? response.data.revision };
          if (!snapshot.queueKey || guard.current.accept(ticket, snapshot)) setState({ scope, data: response.data, loading: pendingReload, refreshing: pendingReload, error: "", errorStatus: null, refreshedAt: new Date() });
          else setState(previous => ({ ...previous, loading: pendingReload, refreshing: pendingReload, error: "A previous visit revision was returned. Current records are retained; refresh before taking action.", errorStatus: 409 }));
        }
      } catch (error) { if (!disposed && !controller.signal.aborted && current === sequence) setState(previous => ({ ...previous, scope, data: [401, 403, 404].includes(error.response?.status) ? null : previous.data, loading: pendingReload, refreshing: pendingReload, errorStatus: error.response?.status || null, error: error.response?.data?.message || (["ECONNABORTED", "ETIMEDOUT"].includes(error.code) ? "The visit update timed out. Please retry." : "Unable to refresh. Please try again.") })); }
      finally { inFlight = false; if (pendingReload && !disposed) { pendingReload = false; void load(); } }
    };
    const reload = () => { void load(); }, pollInBackground = () => { void load(true); };
    const visible = () => { if (document.visibilityState === "visible") reload(); };
    reload(); const timer = poll ? setInterval(pollInBackground, poll) : null;
    window.addEventListener("online", reload); document.addEventListener("visibilitychange", visible);
    const socket = poll && owner !== "public" ? getSocket() : null;
    const events = ["connect", "visit:changed", "appointment:started", "appointment:user-status", "appointment:ended"];
    if (socket) { if (!socket.connected) socket.connect(); for (const event of events) socket.on(event, reload); }
    return () => { disposed = true; controller.abort(); if (timer) clearInterval(timer); window.removeEventListener("online", reload); document.removeEventListener("visibilitychange", visible); if (socket) for (const event of events) socket.off(event, reload); };
  }, [scope, path, owner, poll, attempt]);
  return { ...(state.scope === scope && scope ? state : { data: null, loading: Boolean(scope), refreshing: false, error: "", errorStatus: null, refreshedAt: null }), refresh };
}
