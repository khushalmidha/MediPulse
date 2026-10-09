/* eslint-disable react/prop-types */
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { ArrowRight, CalendarDays, Clock3, ShieldCheck } from "lucide-react";
import { useAuth } from "../../context/AuthContext";
import { useCareResource, useOnlineStatus } from "../../hooks/useCareResource";
import { Banner, Button, Card, Dialog, EmptyState, Field, LoadingState } from "../ui";
import { BACKEND_URL } from "../../utils";
import { bookingRequestKey, clearBookingRequest } from "../../utils/bookingRequest";
import { careLabels, dateInZone, feeText, timeOfDay, visitTime } from "../../utils/appointments";

export default function BookingFlow({ doctor, hospital, departmentId, embedded = false }) {
  const { user, isAuth, role, loader } = useAuth(), online = useOnlineStatus(), navigate = useNavigate(), location = useLocation();
  const [params, setParams] = useSearchParams();
  const owner = isAuth && role === "user" ? user?._id : null;
  const scope = `slot:${owner || "guest"}:${hospital?._id || "independent"}:${doctor._id}:${departmentId || ""}`;
  const storage = "medipulse.slotDraft." + scope;
  const saved = useRef(null);
  if (saved.current === null) { try { saved.current = { ...(JSON.parse(sessionStorage.getItem(storage)) || {}), ...(params.get("reservation") ? { reservationId: params.get("reservation") } : {}) }; } catch { saved.current = {}; } }
  const [draft, setDraft] = useState(saved.current);
  const allowed = hospital ? ["hospital_in_person", "immediate"] : ["scheduled_online", "online_opd", "immediate"];
  const [type, setType] = useState(allowed.includes(params.get("type") || saved.current.type) ? params.get("type") || saved.current.type : allowed[0]);
  const [date, setDate] = useState(params.get("date") || saved.current.date || dateInZone(new Date(), hospital?.settings?.timezone || doctor.queueTimezone));
  const [slotId, setSlotId] = useState(params.get("slot") || saved.current.slotId || ""), [family, setFamily] = useState(saved.current.family || "");
  const [reason, setReason] = useState(""), [sessionId, setSessionId] = useState(hospital?.settings?.queueSessionIds?.[0] || "day");
  const [review, setReview] = useState(Boolean(saved.current.reservationId)), [receipt, setReceipt] = useState(null), [legacyResult, setLegacyResult] = useState(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [uncertain, setUncertain] = useState(Boolean(saved.current.pendingHold)), [clock, setClock] = useState(Date.now());
  const pending = useRef(false), alive = useRef(true), root = useRef(null);
  useEffect(() => { if (embedded && review) { root.current?.closest("dialog")?.scrollTo({ top: 0 }); root.current?.querySelector("[data-booking-review]")?.focus({ preventScroll: true }); } }, [embedded, review]);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const query = new URLSearchParams({ doctorId: doctor._id, from: date, to: date, ...(hospital ? { hospitalId: hospital._id, departmentId } : {}) });
  const availability = useCareResource("/api/scheduling/availability?" + query, "public");
  const families = useCareResource(owner ? "/api/patients/me/family" : null, owner);
  const held = useCareResource(owner && draft.reservationId ? "/api/scheduling/reservations/" + draft.reservationId : null, owner, 10000);
  const details = [401, 403, 404].includes(held.errorStatus) ? null : held.data || receipt;
  const holding = Boolean(draft.reservationId);
  const options = (availability.data?.sessions || []).filter(item => item.appointmentType === type);
  const selectedSession = options.find(item => item.slots?.some(slot => slot._id === slotId)), selectedSlot = selectedSession?.slots?.find(slot => slot._id === slotId);
  const familyValid = !family || (families.data?.items || []).some(item => item._id === family);
  const legacyAmount = Number(doctor.consultationFee ?? doctor.doctorProfile?.consultationFee);
  const legacyFee = Number.isFinite(legacyAmount) && legacyAmount >= 0 ? { amountMinor: Math.round(legacyAmount * 100), currency: "INR", demo: true } : null;
  const persist = next => { setDraft(next); if (owner) sessionStorage.setItem(storage, JSON.stringify(next)); };
  const clear = () => { setDraft({}); sessionStorage.removeItem(storage); setReceipt(null); setReview(false); setUncertain(false); clearBookingRequest(scope + ":hold"); };
  const edit = (values) => {
    const next = { type, date, slotId, family, ...values }; persist(next);
    const query = new URLSearchParams(params); query.set("type", next.type); query.set("date", next.date);
    if (next.slotId) query.set("slot", next.slotId); else query.delete("slot"); if (hospital) query.set("doctor", doctor._id);
    setParams(query, { replace: true });
  };
  useEffect(() => {
    if (held.data?.reservation?.state === "confirmed") { sessionStorage.removeItem(storage); navigate((hospital ? "/reservations/" : "/appointments/reservations/") + held.data.reservation._id, { replace: true }); }
  }, [held.data, hospital, navigate, storage]);
  const write = async (kind, path, body) => {
    const requestKey = await bookingRequestKey(scope + ":" + kind, body);
    const response = await axios.post(BACKEND_URL + path, body, { withCredentials: true, headers: { "Idempotency-Key": requestKey } });
    return { ...response.data, pending: response.status === 202 };
  };
  const run = async action => {
    if (pending.current || !owner || !online) return;
    pending.current = true; setBusy(true); setMessage("");
    try { await action(); }
    catch (error) { if (alive.current) { setMessage(error.response?.data?.message || error.message || "Unable to complete this request."); setUncertain(!error.response || error.response.status >= 500); if (error.response && error.response.status < 500 && !draft.reservationId) persist({ type, date, slotId, family }); if (error.response?.status === 409) availability.refresh(); held.refresh(); } }
    finally { pending.current = false; if (alive.current) setBusy(false); }
  };
  const holdSlot = () => run(async () => {
    const payload = draft.pendingHold && draft.holdBody ? draft.holdBody : { slotId, ...(family ? { familyMemberId: family } : {}) };
    persist({ type, date, slotId, family, pendingHold: true, holdBody: payload });
    const data = await write("hold", "/api/scheduling/holds", payload);
    if (!alive.current) return;
    persist({ type, date, slotId, family, reservationId: data.reservation._id }); setReceipt(data); setReview(true); setUncertain(false);
  });
  const confirm = () => run(async () => {
    const data = await write("confirm:" + details.reservation._id, "/api/scheduling/reservations/" + details.reservation._id + "/confirm", {});
    if (!alive.current) return;
    setReceipt(data); if (data.pending) { setMessage(data.message || "Confirmation is pending. Refresh this reservation or retry the original request."); setUncertain(true); held.refresh(); return; } if (data.reservation.state === "confirmed") { sessionStorage.removeItem(storage); navigate((hospital ? "/reservations/" : "/appointments/reservations/") + data.reservation._id); }
  });
  const release = () => run(async () => {
    await write("cancel:" + details.reservation._id, "/api/scheduling/reservations/" + details.reservation._id + "/cancel", {});
    if (alive.current) { clear(); availability.refresh(); }
  });
  const bookImmediate = () => run(async () => {
    const requestScope = hospital ? `opd:${owner}:${hospital._id}:${doctor._id}` : `appointment:${owner}:${doctor._id}`;
    const body = hospital ? { practiceType: "hospital", hospitalId: hospital._id, visitMode: "in_person", doctorId: doctor._id, sessionId, visitType: "new", chiefComplaint: reason, patientInfo: { name: family ? families.data?.items?.find(item => item._id === family)?.name : [user?.firstName, user?.lastName].filter(Boolean).join(" ") }, ...(family ? { familyMemberId: family } : {}) } : { ...(family ? { familyMemberId: family } : {}) };
    const fingerprint = hospital ? { doctorId: doctor._id, chiefComplaint: reason, sessionId, familyMemberId: family } : family ? { doctorId: doctor._id, familyMemberId: family } : { doctorId: doctor._id };
    const requestKey = await bookingRequestKey(requestScope, fingerprint);
    const response = await axios.post(BACKEND_URL + (hospital ? `/api/opd/${hospital._id}/${departmentId}/book` : `/appointment/book/${doctor._id}`), body, { withCredentials: true, headers: { "Idempotency-Key": requestKey } });
    if (!alive.current) return;
    if (response.status === 202) { setMessage(response.data.message || "Payment confirmation is pending. Retry this booking to check its status."); return; }
    clearBookingRequest(requestScope); if (hospital) setLegacyResult(response.data); else navigate("/triage/" + response.data.appointmentId);
  });
  const signIn = "/login?returnTo=" + encodeURIComponent(location.pathname + "?" + new URLSearchParams({ type, date, ...(slotId ? { slot: slotId } : {}), ...(hospital ? { doctor: doctor._id } : {}) }));
  const errorState = <>{!online && <Banner>You are offline. Reconnect to confirm or change a visit.</Banner>}{message && <Banner>{message}</Banner>}{uncertain && <Banner tone="info">The response was interrupted. Retry the same request or refresh your reservation to check its status.</Banner>}{held.error && <Banner action={<Button variant="secondary" onClick={held.refresh}>Refresh reservation</Button>}>{held.error}</Banner>}</>;
  if (legacyResult) return <Card><h2>Token Confirmed!</h2><p className="mp-visit-token">{legacyResult.displayToken || legacyResult.token?.displayToken}</p><p>Reserved — check in at reception to join the queue</p><Button onClick={() => navigate("/visits/" + legacyResult.token._id)}>Track this hospital visit <ArrowRight size={16} /></Button></Card>;
  if (details && (details.session.doctorId !== doctor._id || (details.session.hospitalId || "independent") !== (hospital?._id || "independent"))) return <Banner>This reservation belongs to another doctor or practice. Open it from your visits.</Banner>;
  const expired = details && ["expired", "cancelled"].includes(details.reservation.state);
  const reviewBody = details ? <div className="mp-stack">{errorState}{details.doctorUnavailable && <Banner>The doctor is unavailable. Release this hold or check for another session.</Banner>}<p className="mp-field-hint">Review the actual reservation before confirming. No credits are taken for the hold.</p><dl className="mp-details"><div><dt>Care</dt><dd>{careLabels[details.session.appointmentType]}</dd></div><div><dt>Patient</dt><dd>{family ? families.data?.items?.find(item => item._id === family)?.name || "Selected family member" : "Myself"}</dd></div><div><dt>Starts</dt><dd>{visitTime(details.reservation.startsAt, details.session.timezone)}</dd></div><div><dt>Ends</dt><dd>{visitTime(details.reservation.endsAt, details.session.timezone)}</dd></div><div><dt>Timezone</dt><dd>{details.session.timezone}</dd></div><div><dt>Consultation</dt><dd>{feeText(details.reservation.fee)} demo credits</dd></div><div><dt>Total</dt><dd>{feeText(details.reservation.fee)} demo credits</dd></div></dl><p className="mp-visit-note">{details.session.visitMode === "in_person" ? "Check in with hospital reception when you arrive." : "Use a device with a microphone. Check in online during your arrival window."} Cancel before the start minus {details.session.policy.cancelBeforeMinutes} minutes for a full demo-credit refund. Reschedule before the start minus {details.session.policy.rescheduleBeforeMinutes} minutes.</p><p role="status"><Clock3 size={16} aria-hidden="true" />{expired ? "This hold is no longer available." : "Hold remaining: " + Math.max(0, Math.ceil((Date.parse(details.reservation.expiresAt) - clock) / 1000)) + " seconds"}</p><div className="mp-actions">{expired ? <Button onClick={() => { clear(); availability.refresh(); }}>Choose another slot</Button> : <><Button disabled={busy || !online || details.doctorUnavailable || Date.parse(details.reservation.expiresAt) <= clock} onClick={confirm}>{busy ? "Checking confirmation..." : "Confirm reservation"}</Button><Button variant="secondary" disabled={busy || !online || uncertain} onClick={release}>Release hold</Button><Button variant="ghost" disabled={busy || !online} onClick={held.refresh}>Refresh reservation</Button></>}</div></div> : <div>{errorState}{!held.error && <LoadingState>Loading your held slot...</LoadingState>}</div>;
  return <div ref={root} className="mp-stack">{!review && errorState}<ol className="mp-booking-steps" aria-label="Booking steps"><li>1 · Care & patient</li><li>2 · Date & availability</li><li aria-current={review ? "step" : undefined}>3 · Review & confirm</li></ol>
    {holding ? <>{embedded ? <Card><h2 tabIndex={-1} data-booking-review>Review your reservation</h2>{reviewBody}</Card> : <><Banner tone="info" action={<Button onClick={() => setReview(true)}>Resume review</Button>}>Your held slot can be reviewed before it expires.</Banner><Dialog open={review} onClose={() => setReview(false)} title="Review your reservation">{reviewBody}</Dialog></>}</> : <>
      <fieldset className="mp-choice-group" disabled={busy || draft.pendingHold}><legend>Care type</legend>{allowed.map(value => <label key={value} className={"mp-choice " + (value === type ? "mp-choice--selected" : "")}><input type="radio" name="care-type" value={value} checked={type === value} onChange={() => { setType(value); setSlotId(""); edit({ type: value, slotId: "" }); }} />{value === "immediate" && hospital ? "Today’s hospital queue" : careLabels[value]}</label>)}</fieldset>
      {owner && <Field as="select" label="Patient" value={family} disabled={busy || families.loading || draft.pendingHold} onChange={event => { setFamily(event.target.value); edit({ family: event.target.value }); }}><option value="">Myself</option>{(families.data?.items || []).map(item => <option value={item._id} key={item._id}>{item.name} · {item.relation || "Family member"}</option>)}</Field>}{families.error && <Banner action={<Button variant="secondary" onClick={families.refresh}>Retry family list</Button>}>{families.error} You can still book for yourself.</Banner>}
      {type === "immediate" ? <Card><h2>{hospital ? "Today’s hospital OPD" : "Join the current online queue"}</h2><p>A current-day queue booking has no reserved consultation time.</p>{hospital && <><Field as="select" label="Care session" value={sessionId} onChange={event => setSessionId(event.target.value)}>{(hospital.settings?.queueSessionIds || ["day"]).map(id => <option key={id} value={id}>{id}</option>)}</Field><Field as="textarea" label="Reason for visit" value={reason} onChange={event => setReason(event.target.value)} /></>}<p className="mp-visit-note">Consultation charges use demo credits; no real money is collected. {hospital ? "Check in at reception to join the care queue." : "The doctor will call you when ready."}</p><div className="mp-fee-row"><span>Consultation total</span><strong>{feeText(legacyFee)} demo credits</strong></div>{owner && <Button onClick={bookImmediate} disabled={busy || !online || !legacyFee || !familyValid}>{busy ? "Processing..." : hospital ? "Confirm OPD Token" : `Confirm Booking for ₹${legacyAmount}`}</Button>}</Card> : <>
        <div className="mp-form-row"><Field label="Service date" type="date" min={dateInZone(new Date(), availability.data?.timezone || hospital?.settings?.timezone || doctor.queueTimezone)} value={date} disabled={busy || draft.pendingHold} onChange={event => { setDate(event.target.value); setSlotId(""); edit({ date: event.target.value, slotId: "" }); }} /><Button variant="secondary" disabled={busy || !online} onClick={availability.refresh}><CalendarDays size={17} />Refresh availability</Button></div>
        {availability.error && <Banner>{availability.error} Availability must be refreshed before reserving a slot.</Banner>}{availability.loading && !availability.data ? <LoadingState>Loading real availability...</LoadingState> : !options.length ? <EmptyState title="No configured availability on this date.">Choose another date or an existing current-day queue. Times appear only when the practice publishes them.</EmptyState> : <fieldset className="mp-choice-group" disabled={busy || Boolean(availability.error) || draft.pendingHold}><legend>{type === "online_opd" ? "Choose an OPD window" : "Choose an available slot"}</legend>{options.map(item => <div key={item._id} className="mp-session-choice"><p className="mp-field-hint">{item.timezone} · {feeText(item.fee)} demo credits{item.available === false ? " · Doctor unavailable" : ""}</p><div className="mp-slot-grid">{(item.slots || []).map(slot => <label key={slot._id} className={"mp-slot " + (slotId === slot._id ? "mp-slot--selected" : "") + (!slot.bookable ? " mp-slot--unavailable" : "")}><input type="radio" name="care-slot" checked={slotId === slot._id} disabled={!slot.bookable} onChange={() => { setSlotId(slot._id); edit({ slotId: slot._id }); }} /><strong>{timeOfDay(slot.startsAt, item.timezone)} – {timeOfDay(slot.endsAt, item.timezone)}</strong><small>{slot.bookable ? slot.remaining + " places available" : "Unavailable"}</small></label>)}</div></div>)}</fieldset>}
        {selectedSlot && <div className="mp-fee-row"><span>Actual consultation total</span><strong>{feeText(selectedSession.fee)} demo credits</strong></div>}{owner && <Button onClick={holdSlot} disabled={busy || !online || (!draft.pendingHold && (!familyValid || !selectedSlot?.bookable || Boolean(availability.error) || availability.loading))}>{busy ? "Holding your slot..." : draft.pendingHold ? "Retry previous hold" : "Hold slot and review"}<ArrowRight size={17} /></Button>}
      </>}{loader ? <LoadingState>Checking your patient session...</LoadingState> : !owner && <Banner tone="info" action={<Button to={signIn}>Patient sign in to continue</Button>}>You can explore availability as a guest. Sign in as a patient to reserve care.</Banner>}<p className="mp-field-hint"><ShieldCheck size={15} aria-hidden="true" />Fees use demo credits. Availability is confirmed by the server when you reserve.</p>
    </>}</div>;
}
