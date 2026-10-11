import { useCallback, useEffect, useRef, useState } from "react";
import axios from "axios";
import { BACKEND_URL } from "../utils";
import { getSocket } from "../socket";
import { createSnapshotGuard } from "../utils/queueSnapshot";

const accountEvents = ["connect", "visit:changed", "appointment:queue-updated", "appointment:ended", "appointment:brief-ready"];
const staffEvents = ["connect", "opd:queue-changed", "opd:checked-in", "opd:token-issued", "opd:vitals-ready", "opd:brief-ready", "opd:consultation-started", "opd:consultation-completed", "opd:no-show"];
export default function useClinicalQueue(path, actor, hospital = false) {
  const scope = actor + ":" + path, guard = useRef(createSnapshotGuard());
  const [state, setState] = useState({ scope: null, data: null, loading: true, error: "", errorStatus: null, refreshedAt: null });
  const [attempt, setAttempt] = useState(0);
  const refresh = useCallback(() => setAttempt(value => value + 1), []);
  useEffect(() => {
    let disposed = false, sequence = 0; const controller = new AbortController();
    const load = async () => {
      const current = ++sequence, ticket = guard.current.begin(scope);
      setState(previous => ({ ...previous, scope, data: previous.scope === scope ? previous.data : null, loading: true }));
      try {
        const response = await axios.get(BACKEND_URL + path, { withCredentials: true, signal: controller.signal });
        if (!disposed && current === sequence) {
          if (guard.current.accept(ticket, response.data)) setState({ scope, data: response.data, loading: false, error: "", errorStatus: null, refreshedAt: new Date() });
          else setState(previous => ({ ...previous, loading: false, error: "A previous queue revision was returned. The newer records are retained; refresh before taking action.", errorStatus: 409 }));
        }
      } catch (error) {
        if (!disposed && !controller.signal.aborted && current === sequence) setState(previous => ({ ...previous, scope, loading: false, data: [401, 403, 404].includes(error.response?.status) ? null : previous.data, errorStatus: error.response?.status || null, error: error.response?.data?.message || "Unable to refresh the queue. Check your connection and retry." }));
      }
    };
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    void load(); const timer = setInterval(load, hospital ? 12000 : 4000), socket = getSocket(hospital ? "staff" : "account"), events = hospital ? staffEvents : accountEvents;
    if (!socket.connected) socket.connect(); for (const event of events) socket.on(event, load);
    window.addEventListener("online", load); document.addEventListener("visibilitychange", visible);
    return () => { disposed = true; controller.abort(); clearInterval(timer); for (const event of events) socket.off(event, load); window.removeEventListener("online", load); document.removeEventListener("visibilitychange", visible); };
  }, [path, scope, hospital, attempt]);
  return { ...(state.scope === scope ? state : { data: null, loading: true, error: "", errorStatus: null, refreshedAt: null }), refresh };
}
