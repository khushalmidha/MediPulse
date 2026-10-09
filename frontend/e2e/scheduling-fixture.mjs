// Stateful synthetic P09 contracts for the actual P10 React routes.
const oid = number => number.toString(16).padStart(24, "0"), family = oid(32), hospitalId = oid(4), departmentId = oid(6);
const day = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + 2 * 86400000));
const plusDay = date => new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
export function fixtureSessions(state, doctorId) {
  if (!state.schedule) return [];
  state.scheduleDate ||= day();
  return [state.scheduleDate, plusDay(state.scheduleDate)].flatMap((date, index) => ["scheduled_online", "online_opd", "hospital_in_person"].map((type, typeIndex) => {
    const id = oid(100 + index * 10 + typeIndex), hospital = type === "hospital_in_person", start = new Date(date + (type === "online_opd" ? "T12:00:00+05:30" : hospital ? "T14:00:00+05:30" : "T09:00:00+05:30")), end = new Date(start.getTime() + 3600000);
    const practiceKey = hospital ? "hospital:" + hospitalId : "independent:" + doctorId;
    return { _id: id, doctorId, ...(hospital ? { hospitalId, departmentId } : {}), practiceType: hospital ? "hospital" : "independent", practiceKey, queueKey: practiceKey + ":" + doctorId + ":" + date + ":s_" + id,
      visitMode: hospital ? "in_person" : "online", serviceDate: date, sessionId: "s_" + id, timezone: "Asia/Kolkata", appointmentType: type, startsAt: start.toISOString(), endsAt: end.toISOString(), available: !state.doctorAbsent,
      fee: { amountMinor: 50000, amount: 500, currency: "INR", demo: true }, policy: { holdMinutes: 5, cancelBeforeMinutes: 60, rescheduleBeforeMinutes: 60, checkInLeadMinutes: 15, checkInGraceMinutes: 30 },
      slots: (type === "online_opd" ? [0] : [0, 30]).map((minutes, slotIndex) => ({ _id: oid(200 + index * 20 + typeIndex * 3 + slotIndex), startsAt: new Date(start.getTime() + minutes * 60000).toISOString(), endsAt: type === "online_opd" ? end.toISOString() : new Date(start.getTime() + (minutes + 15) * 60000).toISOString(), capacity: type === "online_opd" ? 3 : 1, remaining: 1, bookable: !state.slotFull && !state.doctorAbsent })) };
  }));
}
const view = (record, state) => {
  const result = structuredClone(record);
  if (state.holdExpired && result.reservation.state === "held") result.reservation.state = "expired";
  if (state.reservationActive && result.appointment) { result.appointment.status = "active"; result.appointment.admissionState = "arrived"; if (result.token) result.token.status = "in_consultation"; }
  result.doctorUnavailable = Boolean(state.doctorAbsent);
  result.cancellation = { allowed: ["held", "confirmed"].includes(result.reservation.state) && result.appointment?.status !== "active", fullDemoRefund: true };
  result.rescheduling = { allowed: result.reservation.state === "confirmed" && result.appointment?.admissionState === "reserved", sameDoctorPracticeAndFee: true };
  result.nextStep = state.doctorAbsent ? "Reschedule or cancel: doctor unavailable" : result.reservation.state === "held" ? "Confirm before the hold expires" : result.reservation.state === "confirmed" ? result.session.visitMode === "in_person" ? "Check in with hospital reception during the arrival window" : "Check in online during the arrival window" : "Follow the current visit status";
  result.generatedAt = new Date().toISOString(); return result;
};
export async function handleScheduling({ req, state, reply, doctor }) {
  const url = new URL(req.url, "http://127.0.0.1:19080"), path = url.pathname;
  const respond = (body, status = 200) => { reply(body, status); return true; };
  if (path === "/__fixture/patch" && req.method === "POST") { let body = ""; for await (const chunk of req) body += chunk; Object.assign(state, JSON.parse(body)); return respond({ updated: true }); }
  if (path === "/doctor") return respond({ items: [doctor], total: 1, totalPages: 1, page: 1 });
  if (path === "/api/patients/me/family" && (state.guest || state.nurse)) return respond({ message: "Patient account required" }, 401);
  if (path === "/api/patients/me/family") return respond({ items: [{ _id: family, name: "Fixture Child", relation: "child" }] });
  if (!path.startsWith("/api/scheduling/")) return false;
  state.scheduleVisits ||= []; state.scheduleHoldKeys ||= []; state.scheduleConfirmKeys ||= []; state.scheduleActions ||= [];
  const sessions = fixtureSessions(state, doctor._id);
  if (path.endsWith("/availability")) {
    if (state.failAvailability) return respond({ message: "Synthetic availability outage" }, 503);
    const hospital = url.searchParams.get("hospitalId"), date = url.searchParams.get("from");
    const selected = sessions.filter(item => Boolean(item.hospitalId) === Boolean(hospital) && (!date || item.serviceDate === date)).map(item => ({ ...item, slots: item.slots.map(slot => {
      const occupied = state.scheduleVisits.filter(record => record.reservation.slotId === slot._id && ["held", "confirmed"].includes(record.reservation.state)).length;
      return { ...slot, remaining: Math.max(0, slot.capacity - occupied), bookable: slot.bookable && occupied < slot.capacity };
    }) }));
    return respond({ timezone: "Asia/Kolkata", from: date, to: date, generatedAt: new Date().toISOString(), sessions: selected });
  }
  if (state.guest || state.nurse) return respond({ message: "Patient session required" }, 401);
  if (req.method === "GET" && path.endsWith("/reservations")) return respond({ visits: state.scheduleVisits.map(record => view(record, state)) });
  const match = path.match(/\/reservations\/([a-f\d]{24})(?:\/([a-z-]+))?$/);
  const record = match && state.scheduleVisits.find(item => item.reservation._id === match[1]);
  if (match && !record) return respond({ message: "Reservation not found" }, 404);
  if (match && state.denyTracking) return respond({ message: "Synthetic visit access revoked" }, 403);
  if (match && req.method === "GET") return state.failTracking ? respond({ message: "Synthetic tracking outage" }, 503) : respond(view(record, state));
  if (req.method !== "POST") return respond({ message: "Fixture route unavailable" }, 404);
  if (req.headers["x-csrf-token"] !== "fixture-account-csrf") return respond({ message: "Invalid fixture CSRF" }, 403);
  const key = req.headers["idempotency-key"]; if (!key) return respond({ message: "Request key required" }, 428);
  let raw = ""; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw || "{}");
  if (path.endsWith("/holds")) {
    state.scheduleHoldKeys.push(key);
    const prior = state.scheduleVisits.find(item => item.holdKey === key); if (prior) return respond(view(prior, state));
    const care = sessions.find(item => item.slots.some(slot => slot._id === body.slotId)), slot = care?.slots.find(item => item._id === body.slotId);
    if (!slot) return respond({ message: "Slot not found" }, 404);
    if (!slot.bookable || state.doctorAbsent || state.scheduleVisits.filter(item => item.reservation.slotId === slot._id && ["held", "confirmed"].includes(item.reservation.state)).length >= slot.capacity) return respond({ message: "Slot is full; refresh availability" }, 409);
    if (body.familyMemberId && body.familyMemberId !== family) return respond({ message: "Family ownership required" }, 403);
    const data = { holdKey: key, reservation: { _id: oid(300 + state.scheduleVisits.length), state: "held", revision: 0, familyMemberId: body.familyMemberId || null, slotId: slot._id,
      expiresAt: new Date(Date.now() + 300000).toISOString(), startsAt: slot.startsAt, endsAt: slot.endsAt, fee: care.fee }, session: care, appointment: null, token: null, queuePosition: null, estimatedWaitMinutes: null, location: care.hospitalId ? { hospitalId, departmentId, room: null } : null };
    state.scheduleVisits.push(data); return respond(view(data, state), 201);
  }
  const action = match?.[2]; if (!action) return respond({ message: "Action required" }, 400);
  if (action === "confirm") {
    state.scheduleConfirmKeys.push(key);
    if (state.failConfirmation) return respond({ message: "Synthetic insufficient demo balance" }, 402);
    if (state.pendingConfirmation) return respond({ ...view(record, state), message: "Synthetic confirmation pending" }, 202);
    if (record.reservation.state !== "confirmed") {
      if (state.holdExpired) return respond({ message: "Hold expired" }, 409);
      record.reservation.state = "confirmed"; record.reservation.revision++; record.reservation.appointmentId = oid(400 + state.scheduleVisits.indexOf(record));
      record.appointment = { _id: record.reservation.appointmentId, status: "queued", admissionState: "reserved", revision: 1, payment: { paid: true, refundState: null } };
      if (record.session.hospitalId) { record.reservation.tokenId = oid(500 + state.scheduleVisits.indexOf(record)); record.token = { _id: record.reservation.tokenId, displayToken: "S001", status: "reserved", revision: 1 }; }
      state.schedulePayments = (state.schedulePayments || 0) + 1;
    }
  } else {
    const prior = state.scheduleActions.find(item => item.key === key && item.action === action);
    if (prior) return respond(view(record, state));
    if (action === "cancel") { record.reservation.state = "cancelled"; record.reservation.revision++; if (record.appointment) { record.appointment.status = "cancelled"; record.appointment.payment.refundState = "completed"; } }
    else if (action === "reschedule") {
      const care = sessions.find(item => item.slots.some(slot => slot._id === body.slotId)), slot = care?.slots.find(item => item._id === body.slotId);
      if (body.revision !== record.reservation.revision || !slot?.bookable || state.staleReschedule) return respond({ message: "Target slot changed; refresh availability" }, 409);
      record.reservation.slotId = slot._id; record.reservation.startsAt = slot.startsAt; record.reservation.endsAt = slot.endsAt; record.reservation.revision++; record.session = care;
    } else if (action === "check-in") { if (record.session.visitMode === "in_person") return respond({ message: "Staff arrival required" }, 403); record.appointment.admissionState = "arrived"; record.appointment.checkedInAt = new Date().toISOString(); record.queuePosition = 1; }
    else return respond({ message: "Unknown action" }, 400);
    state.scheduleActions.push({ key, action, body, reservationId: record.reservation._id });
  }
  return respond(view(record, state));
}
