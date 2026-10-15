import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";
import { getSocket } from "../socket";
import { createSnapshotGuard } from "../utils/queueSnapshot";

const accountEvents = ["connect", "visit:changed", "appointment:queue-updated", "appointment:ended", "appointment:brief-ready"];
const staffEvents = ["connect", "opd:queue-changed", "opd:checked-in", "opd:token-issued", "opd:vitals-ready", "opd:brief-ready", "opd:consultation-started", "opd:consultation-completed", "opd:no-show"];
export default function useClinicalQueue(path, actor, hospital = false) {
  const scope = actor + ":" + path, guard = useRef(createSnapshotGuard());
  const [state, setState] = useState({ scope: null, data: null, loading: true, refreshing: false, error: "", errorStatus: null, refreshedAt: null });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
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
        loading: !background || previous.scope !== scope || !previous.data || Boolean(previous.error), refreshing: true }));
      try {
        const response = await axios.get(BACKEND_URL + path, { withCredentials: true, signal: controller.signal, timeout: 15000 });
        if (!disposed && current === sequence) {
          if (guard.current.accept(ticket, response.data)) setState({ scope, data: response.data, loading: pendingReload, refreshing: pendingReload, error: "", errorStatus: null, refreshedAt: new Date() });
          else setState(previous => ({ ...previous, loading: pendingReload, refreshing: pendingReload, error: "A previous queue revision was returned. The newer records are retained; refresh before taking action.", errorStatus: 409 }));
        }
      } catch (error) {
        if (!disposed && !controller.signal.aborted && current === sequence) setState(previous => ({ ...previous, scope, loading: pendingReload, refreshing: pendingReload, data: [401, 403, 404].includes(error.response?.status) ? null : previous.data, errorStatus: error.response?.status || null, error: error.response?.data?.message || (["ECONNABORTED", "ETIMEDOUT"].includes(error.code) ? "Queue refresh timed out. Please try again." : "Unable to refresh the queue. Check your connection and retry.") }));
      } finally {
        inFlight = false;
        if (pendingReload && !disposed) { pendingReload = false; void load(); }
      }
    };
    const reload = () => { void load(); }, poll = () => { void load(true); };
    const visible = () => { if (document.visibilityState === "visible") reload(); };
    reload(); const timer = setInterval(poll, hospital ? 12000 : 4000), socket = getSocket(hospital ? "staff" : "account"), events = hospital ? staffEvents : accountEvents;
    if (!socket.connected) socket.connect(); for (const event of events) socket.on(event, reload);
    window.addEventListener("online", reload); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; controller.abort(); clearInterval(timer); for (const event of events) socket.off(event, reload); window.removeEventListener("online", reload); document.removeEventListener("visibilitychange", visible); };
  }, [path, scope, hospital, attempt]);
  return { ...(state.scope === scope ? state : { data: null, loading: true, refreshing: false, error: "", errorStatus: null, refreshedAt: null }), refresh };
}
