import { useCallback, useEffect, useRef, useState } from "react";
import { useOnlineStatus } from "./useCareResource";

export default function useFormTask() {
  const online = useOnlineStatus(), alive = useRef(true), pending = useRef(false), controller = useRef(null);
  const [busy, setBusy] = useState(false), [feedback, setFeedback] = useState(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; controller.current?.abort(); }; }, []);
  const run = useCallback(async (action, success) => {
    if (pending.current) return;
    if (!navigator.onLine) { setFeedback({ message: "You are offline. Reconnect and try again.", tone: "error" }); return; }
    pending.current = true; controller.current = new AbortController(); setBusy(true); setFeedback(null);
    try {
      const result = await action(controller.current.signal);
      if (alive.current) success?.(result);
    } catch (error) {
      if (alive.current && !controller.current.signal.aborted) setFeedback({ message: error.response?.data?.message || "The response was interrupted. Check the current status before trying again.", tone: "error" });
    } finally { pending.current = false; if (alive.current) setBusy(false); }
  }, []);
  return { run, busy, online, feedback, setFeedback };
}
