/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import axios from "axios";
import { Banner, Button, Dialog } from "../ui";
import { useOnlineStatus } from "../../hooks/useCareResource";
import { BACKEND_URL } from "../../utils";
import { feeText } from "../../utils/appointments";

export default function LegacyVisitActions({ appointment, owner, onRefresh }) {
  const online = useOnlineStatus(), pending = useRef(false), alive = useRef(true);
  const storage = `medipulse.legacyCancel.${owner}:${appointment._id}`;
  const [intent, setIntent] = useState(() => { try { return JSON.parse(sessionStorage.getItem(storage)); } catch { return null; } });
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const refunded = Boolean(appointment.payment?.refundedAt);
  useEffect(() => { if (refunded) { sessionStorage.removeItem(storage); setIntent(null); setOpen(false); } }, [refunded, storage]);
  const eligible = ["queued", "refund_pending", "cancelled"].includes(appointment.status) && (appointment.payment?.paymentId || appointment.payment?.orderId) && !refunded;
  const refund = async () => {
    if (pending.current || !online || !eligible) return;
    pending.current = true; setBusy(true); setMessage("");
    const body = intent || { reason: "patient-requested-refund", ...(appointment.revision != null ? { revision: appointment.revision } : {}) };
    try {
      sessionStorage.setItem(storage, JSON.stringify(body)); setIntent(body);
      // P04 derives the single refund identity from the appointment on the server.
      const response = await axios.post(`${BACKEND_URL}/appointment/${appointment._id}/refund`, body, { withCredentials: true });
      if (!alive.current) return;
      if (response.status === 202 || response.data.compensationStatus !== "completed") { setMessage("Demo refund is pending. Refresh the visit or retry this request."); return; }
      sessionStorage.removeItem(storage); setIntent(null); setOpen(false); setMessage("Demo-credit refund completed.");
    } catch (error) {
      if (!alive.current) return;
      setMessage(error.response?.data?.message || "Response interrupted. Retry the original cancellation or refresh the visit.");
      if (error.response && error.response.status < 500) { sessionStorage.removeItem(storage); setIntent(null); }
    } finally { pending.current = false; if (alive.current) { setBusy(false); onRefresh(); } }
  };
  return <>{refunded && <p>Demo-credit refund completed.</p>}{message && <Banner tone={message === "Demo-credit refund completed." ? "info" : "error"}>{message}</Banner>}{eligible && <Button variant="danger" disabled={busy || !online} onClick={() => setOpen(true)}>{intent ? "Retry queue cancellation" : "Cancel queue visit"}</Button>}<Dialog open={open} title="Cancel this queue visit?" onClose={() => { if (!busy) setOpen(false); }}><div className="mp-stack"><p>Cancel this visit and return its {feeText({ amountMinor: Math.round(Number(appointment.payment?.amount) * 100), currency: "INR" })} demo-credit payment. Care already started cannot be cancelled.</p>{message && <Banner>{message}</Banner>}<Button variant="danger" disabled={busy || !online || !eligible} onClick={refund}>{busy ? "Checking cancellation..." : "Confirm queue cancellation"}</Button></div></Dialog></>;
}
