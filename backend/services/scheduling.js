import { appointmentPosition } from "./appointmentPosition.js";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { CareSession, CareSlot, CareReservation, ScheduleOperation, DoctorAbsence } from "../model/scheduling.js";
import Doctor from "../model/doctor.js";
import Hospital from "../model/hospital.js";
import Staff from "../model/hospitalStaff.js";
import Department from "../model/department.js";
import User from "../model/user.js";
import Appointment from "../model/appointment.js";
import Token from "../model/opdToken.js";
import Sequence from "../model/opdSequence.js";
import { resolveConsultationFee } from "../config/fees.js";
import { amountToMinor, fromMinor } from "../util/money.js";
import { accessError, idOf, requireRecordId, resolveBookingIdentity } from "./hospitalAccess.js";
import { patientKey, localServiceDate } from "./queueContext.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { transferInSession, afterTransferCommit } from "./virtualLedger.js";
import { refundAppointment } from "./appointmentRefund.js";
import { transitionVisit, afterVisitCommit } from "./visitTransitions.js";
import { recordVisitEvent } from "./workflowEvents.js";
import { sessionPlan, instant, withinChangePolicy } from "./schedulingPolicy.js";
import { lockSchedule, doctorUnavailable, releaseReservation } from "./schedulingLifecycle.js";

const scheduleTransaction = async callback => {
  try { return await moneyTransaction(callback); } catch (error) { if (error.code === 11000) throw accessError(409, "A live booking already occupies this care session"); throw error; }
};
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object" ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const requestIdentity = (req, kind, input) => {
  const key = req.get?.("Idempotency-Key") || req.headers?.["idempotency-key"];
  if (typeof key !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) throw accessError(428, "A valid Idempotency-Key is required");
  return { actorKey: `patient:${req.auth?.id}`, kind, requestKey: key, fingerprint: crypto.createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex") };
};
const operationReplay = async (identity, session) => {
  const operation = await ScheduleOperation.findOne({ actorKey: identity.actorKey, kind: identity.kind, requestKey: identity.requestKey }).session(session);
  if (operation && operation.fingerprint !== identity.fingerprint) throw accessError(409, "Request key was used with different scheduling details");
  return operation;
};
const saveOperation = (identity, reservationId, session) => ScheduleOperation.create([{ ...identity, reservationId }], { session });
const scheduleContext = care => ({ practiceType: care.hospitalId ? "hospital" : "independent", ...(care.hospitalId ? { hospitalId: care.hospitalId } : {}),
  practiceKey: care.practiceKey, queueKey: care.queueKey, serviceDate: care.serviceDate, sessionId: care.sessionId, timezone: care.timezone, visitMode: care.hospitalId ? "in_person" : "online" });
export const schedulingDoctor = async (input, session) => {
  const doctorId = requireRecordId(input.doctorId, "doctor");
  if (input.hospitalId) {
    const hospitalId = requireRecordId(input.hospitalId, "hospital"), departmentId = requireRecordId(input.departmentId, "department");
    const hospital = await Hospital.findOne({ _id: hospitalId, status: "active" }).session(session);
    const department = await Department.findOne({ _id: departmentId, hospitalId, status: "active" }).session(session);
    const doctor = await Staff.findOne({ _id: doctorId, hospitalId, departmentIds: departmentId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" }).session(session);
    if (!hospital || !department || !doctor) throw accessError(404, "Active hospital doctor and department are required");
    if (!doctor.doctorId || !(await Doctor.exists({ _id: doctor.doctorId }).session(session))) throw accessError(409, "Hospital doctor must have a linked doctor account");
    return { doctorId, canonicalDoctorId: doctor.doctorId, hospitalId, departmentId, practiceKey: `hospital:${hospitalId}`,
      timezone: hospital.settings?.timezone || "Asia/Kolkata", feeMinor: amountToMinor(resolveConsultationFee({ consultationFee: doctor.doctorProfile?.consultationFee ?? department.opd?.consultationFee }), { zero: true }) };
  }
  const doctor = await Doctor.findById(doctorId).session(session);
  if (!doctor) throw accessError(404, "Independent doctor not found");
  return { doctorId, canonicalDoctorId: doctor._id, practiceKey: `independent:${doctorId}`, timezone: doctor.queueTimezone || "Asia/Kolkata",
    feeMinor: Math.round(resolveConsultationFee(doctor) * 100) };
};
const manage = (req, care) => {
  if (care.hospitalId) {
    const staff = req.staff;
    if (!staff || idOf(staff.hospitalId) !== idOf(care.hospitalId) || !((staff.role === "DOCTOR" && idOf(staff.id) === idOf(care.doctorId)) || staff.role === "HOSPITAL_ADMIN" || staff.adminAccess)) throw accessError(403, "Hospital schedule administration is not authorized");
  } else if (req.auth?.role !== "doctor" || idOf(req.auth.id) !== idOf(care.doctorId)) throw accessError(403, "Only the independent doctor can manage this schedule");
};
const eligible = async (care, session) => {
  const current = await schedulingDoctor(care, session);
  if (idOf(current.canonicalDoctorId) !== idOf(care.canonicalDoctorId) || current.timezone !== care.timezone) throw accessError(409, "Practice configuration changed; schedule review is required");
  if (await doctorUnavailable(care, session)) throw accessError(409, "Doctor is unavailable for this session");
};
const ownedReservation = async (req, id, session) => {
  if (req.auth?.role !== "user") throw accessError(403, "Patient account required");
  const reservation = await CareReservation.findOne({ _id: requireRecordId(id, "reservation"), user: req.auth.id }).session(session);
  if (!reservation) throw accessError(404, "Reservation not found");
  const query = { _id: req.auth.id, ...(reservation.familyMemberId ? { "familyMembers._id": reservation.familyMemberId } : {}) };
  if (!(await User.exists(query).session(session))) throw accessError(403, "Patient or family member no longer belongs to this account");
  return reservation;
};
const bookingOpen = (care, slot, now) => (care.appointmentType === "online_opd" ? slot.endsAt : slot.startsAt) > now;
const expiresFor = (care, slot, now) => new Date(Math.min(now.getTime() + care.policy.holdMinutes * 60000, (care.appointmentType === "online_opd" ? slot.endsAt : slot.startsAt).getTime()));
const expireInSession = async (care, now, session) => {
  const rows = await CareReservation.find({ session: care._id, state: "held", expiresAt: { $lte: now } }).session(session);
  for (const row of rows) await releaseReservation(row, "expired", session);
  return rows.length;
};
export const expireScheduleHolds = async (now = new Date(), limit = 100) => {
  const rows = await CareReservation.find({ state: "held", expiresAt: { $lte: now } }).select("session").limit(limit).lean();
  let expired = 0;
  for (const id of [...new Set(rows.map(row => idOf(row.session)))]) expired += await scheduleTransaction(async session => {
    const care = await CareSession.findById(id).session(session);
    if (!care) throw accessError(409, "Hold session requires review");
    await lockSchedule("doctor:" + care.canonicalDoctorId, session);
    return expireInSession(care, now, session);
  });
  return expired;
};
export const createCareSession = async (req, now = new Date()) => scheduleTransaction(async session => {
  const context = await schedulingDoctor(req.body, session); manage(req, context);
  const type = req.body.appointmentType;
  if (!(context.hospitalId ? type === "hospital_in_person" : ["scheduled_online", "online_opd"].includes(type))) throw accessError(400, "Appointment type does not match this practice");
  if (req.body.timezone && req.body.timezone !== context.timezone) throw accessError(409, "Use the practice timezone");
  const plan = sessionPlan({ ...req.body, timezone: context.timezone }, now);
  await lockSchedule("doctor:" + context.canonicalDoctorId, session);
  if (await CareSession.exists({ canonicalDoctorId: context.canonicalDoctorId, startsAt: { $lt: plan.endsAt }, endsAt: { $gt: plan.startsAt } }).session(session)) throw accessError(409, "Doctor already has an overlapping session in another care context");
  if (await DoctorAbsence.exists({ canonicalDoctorId: context.canonicalDoctorId, active: true, startsAt: { $lt: plan.endsAt }, endsAt: { $gt: plan.startsAt } }).session(session)) throw accessError(409, "Doctor is absent during this session");
  const _id = new mongoose.Types.ObjectId(), sessionId = `s_${_id}`;
  const [care] = await CareSession.create([{ ...context, ...plan, _id, sessionId, appointmentType: type, queueKey: `${context.practiceKey}:${context.doctorId}:${plan.serviceDate}:${sessionId}` }], { session });
  await CareSlot.create(plan.slots.map(slot => ({ ...slot, session: _id })), { session, ordered: true });
  return sessionView(care);
});
export const setCareSessionState = async (req) => scheduleTransaction(async session => {
  const care = await CareSession.findById(requireRecordId(req.params.sessionId, "session")).session(session);
  if (!care) throw accessError(404, "Session not found"); manage(req, care);
  if (!["open", "paused"].includes(req.body.state)) throw accessError(400, "Invalid session state");
  await lockSchedule("doctor:" + care.canonicalDoctorId, session);
  care.state = req.body.state; await care.save({ session });
  const affected = await CareReservation.find({ session: care._id, state: "confirmed" }).select("_id appointmentId").session(session).lean();
  return { ...sessionView(care), affectedReservations: affected };
});
export const setDoctorAbsence = async (req) => scheduleTransaction(async session => {
  if (req.auth?.role !== "doctor") throw accessError(403, "Doctor account required for leave across practices");
  const doctorId = requireRecordId(req.auth.id, "doctor");
  if (!(await Doctor.exists({ _id: doctorId }).session(session))) throw accessError(404, "Doctor not found");
  await lockSchedule("doctor:" + doctorId, session);
  if (req.params.absenceId) {
    const row = await DoctorAbsence.findOneAndUpdate({ _id: requireRecordId(req.params.absenceId, "absence"), canonicalDoctorId: doctorId }, { $set: { active: false } }, { session, new: true });
    if (!row) throw accessError(404, "Absence not found"); return row;
  }
  const startsAt = instant(req.body.startsAt), endsAt = instant(req.body.endsAt);
  if (startsAt >= endsAt || endsAt - startsAt > 366 * 86400000) throw accessError(400, "Invalid absence range");
  const [row] = await DoctorAbsence.create([{ canonicalDoctorId: doctorId, startsAt, endsAt }], { session });
  return row;
});
export const sessionView = care => ({ _id: care._id, doctorId: care.doctorId, hospitalId: care.hospitalId, departmentId: care.departmentId,
  ...scheduleContext(care), appointmentType: care.appointmentType, startsAt: care.startsAt, endsAt: care.endsAt, state: care.state,
  fee: { amountMinor: care.feeMinor, amount: fromMinor(care.feeMinor), currency: care.currency || "INR", demo: true }, policy: care.policy });
export const getAvailability = async (input, now = new Date()) => {
  const context = await schedulingDoctor(input);
  const from = input.from || localServiceDate(now, context.timezone), to = input.to || from;
  const valid = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
  if (!valid(from) || !valid(to) || from > to || Date.parse(to) - Date.parse(from) > 31 * 86400000) throw accessError(400, "Availability requires a valid date range of at most 31 days");
  await expireScheduleHolds(now);
  const rows = await CareSession.find({ practiceKey: context.practiceKey, doctorId: context.doctorId, ...(context.departmentId ? { departmentId: context.departmentId } : {}), serviceDate: { $gte: from, $lte: to } }).sort({ startsAt: 1 }).limit(200).lean();
  const sessions = [];
  for (const care of rows) {
    const unavailable = await doctorUnavailable(care);
    const slots = await CareSlot.find({ session: care._id }).sort({ startsAt: 1 }).lean();
    sessions.push({ ...sessionView(care), available: !unavailable, slots: slots.map(slot => ({ _id: slot._id, startsAt: slot.startsAt, endsAt: slot.endsAt, capacity: slot.capacity,
      remaining: unavailable || !bookingOpen(care, slot, now) ? 0 : Math.max(0, slot.capacity - slot.occupied), bookable: !unavailable && bookingOpen(care, slot, now) && slot.occupied < slot.capacity })) });
  }
  return { ...context, feeMinor: undefined, canonicalDoctorId: undefined, from, to, generatedAt: now, sessions };
};
export const holdCareSlot = async (req, now = new Date()) => {
  const { patientId, familyMemberId } = await resolveBookingIdentity(req, req.body.patientId, req.body.familyMemberId);
  const input = { slotId: requireRecordId(req.body.slotId, "slot"), patientId, familyMemberId: familyMemberId || null };
  const identity = requestIdentity(req, "hold", input);
  await expireScheduleHolds(now);
  const result = await scheduleTransaction(async session => {
    const replay = await operationReplay(identity, session);
    if (replay) { await ownedReservation(req, replay.reservationId, session); return { id: replay.reservationId, replay: true }; }
    const slot = await CareSlot.findById(input.slotId).session(session);
    const care = slot && await CareSession.findById(slot.session).session(session);
    if (!care) throw accessError(404, "Slot not found");
    await lockSchedule("doctor:" + care.canonicalDoctorId, session);
    const person = patientKey(patientId, familyMemberId); await lockSchedule("person:" + person, session);
    await eligible(care, session); await expireInSession(care, now, session);
    if (!bookingOpen(care, slot, now)) throw accessError(409, "Session booking has closed");
    if (!(await User.exists({ _id: patientId, ...(familyMemberId ? { "familyMembers._id": familyMemberId } : {}) }).session(session))) throw accessError(403, "Patient identity is not available");
    if (await CareReservation.exists({ personKey: person, state: { $in: ["held", "confirmed"] }, $or: [{ session: care._id }, { startsAt: { $lt: slot.endsAt }, endsAt: { $gt: slot.startsAt } }] }).session(session)) throw accessError(409, "Patient already has a reservation in this session or an overlapping visit");
    const occupied = await CareSlot.findOneAndUpdate({ _id: slot._id, occupied: { $lt: slot.capacity } }, { $inc: { occupied: 1 } }, { session, new: true });
    if (!occupied) throw accessError(409, "Slot is full; refresh availability");
    const [reservation] = await CareReservation.create([{ session: care._id, slot: slot._id, canonicalDoctorId: care.canonicalDoctorId, user: patientId, familyMemberId,
      personKey: person, state: "held", expiresAt: expiresFor(care, slot, now), startsAt: slot.startsAt, endsAt: slot.endsAt, feeMinor: care.feeMinor, currency: care.currency }], { session });
    await saveOperation(identity, reservation._id, session); return { id: reservation._id, replay: false };
  });
  return { ...await getReservation(req, result.id, now), replay: result.replay };
};
const allocateToken = async (care, session) => {
  const sequence = await Sequence.findOneAndUpdate({ queueKey: care.queueKey }, { $inc: { seq: 1 }, $setOnInsert: { hospitalId: care.hospitalId, doctorId: care.doctorId, date: care.serviceDate, sessionId: care.sessionId } }, { session, upsert: true, new: true });
  return sequence.seq;
};
export const confirmCareReservation = async (req, now = new Date()) => {
  const id = requireRecordId(req.params.reservationId, "reservation"), identity = requestIdentity(req, "confirm", { reservationId: id });
  await expireScheduleHolds(now);
  const result = await scheduleTransaction(async session => {
    const reservation = await ownedReservation(req, id, session), replay = await operationReplay(identity, session);
    if (replay) return { replay: true };
    if (reservation.state === "confirmed") { await saveOperation(identity, id, session); return { replay: true }; }
    if (reservation.state !== "held" || reservation.expiresAt <= now) throw accessError(409, "Hold expired or is no longer available");
    const care = await CareSession.findById(reservation.session).session(session);
    if (!care) throw accessError(409, "Reservation session requires review");
    await lockSchedule("doctor:" + care.canonicalDoctorId, session); await lockSchedule("person:" + reservation.personKey, session); await eligible(care, session);
    if (!bookingOpen(care, reservation, now)) throw accessError(409, "Session booking has closed");
    if (await Appointment.exists({ queueKey: care.queueKey, personKey: reservation.personKey, status: { $in: ["booking", "queued", "active", "refund_pending"] } }).session(session)) throw accessError(409, "This patient already has a booking in the session");
    let payment, financial;
    if (reservation.feeMinor > 0) {
      financial = await transferInSession({ senderId: reservation.user, senderRole: "user", receiverId: care.canonicalDoctorId, receiverRole: "doctor", amount: fromMinor(reservation.feeMinor),
        referenceId: `SCHEDULE-${reservation._id}`, description: "Demo scheduled consultation", metadata: { reservationId: id, demo: true } }, session);
      const txn = financial.transaction;
      payment = { provider: "wallet", orderId: txn.transactionId, paymentId: txn.transactionId, amount: fromMinor(txn.amountMinor), amountMinor: txn.amountMinor, currency: "INR", paidAt: txn.createdAt || now };
    }
    const appointmentId = new mongoose.Types.ObjectId(), tokenId = care.hospitalId ? new mongoose.Types.ObjectId() : undefined;
    const [appointment] = await Appointment.create([{ _id: appointmentId, doctor: care.canonicalDoctorId, user: reservation.user, familyMemberId: reservation.familyMemberId,
      ...scheduleContext(care), personKey: reservation.personKey, status: "queued", revision: 1, roomId: crypto.randomUUID(), opdTokenId: tokenId,
      appointmentType: care.appointmentType, scheduleReservationId: reservation._id, scheduleSessionId: care._id, scheduledStart: reservation.startsAt, scheduledEnd: reservation.endsAt,
      admissionState: "reserved", feeSnapshot: { amountMinor: reservation.feeMinor, currency: reservation.currency, demo: true }, ...(payment ? { payment } : {}) }], { session });
    let token;
    if (care.hospitalId) {
      const number = await allocateToken(care, session), user = await User.findById(reservation.user).session(session);
      const member = reservation.familyMemberId ? user.familyMembers.id(reservation.familyMemberId) : user;
      const hospital = await Hospital.findById(care.hospitalId).session(session);
      [token] = await Token.create([{ _id: tokenId, ...scheduleContext(care), doctorId: care.doctorId, departmentId: care.departmentId, patientId: reservation.user, familyMemberId: reservation.familyMemberId,
        patientInfo: { name: member.name || [member.firstName, member.lastName].filter(Boolean).join(" "), phone: member.phone || member.phoneNumber }, personKey: reservation.personKey,
        tokenNumber: number, displayToken: `${hospital.settings?.tokenPrefix || "T"}${String(number).padStart(3, "0")}`, date: new Date(care.serviceDate + "T00:00:00Z"),
        appointmentId, scheduleReservationId: reservation._id, scheduleSessionId: care._id, scheduledStart: reservation.startsAt, scheduledEnd: reservation.endsAt,
        status: "reserved", revision: 1, paymentStatus: reservation.feeMinor ? "paid" : "waived", paymentAmount: fromMinor(reservation.feeMinor), paymentMode: "wallet" }], { session });
    }
    Object.assign(reservation, { state: "confirmed", appointmentId, tokenId, revision: reservation.revision + 1 }); await reservation.save({ session });
    await saveOperation(identity, id, session); await recordVisitEvent({ token, appointment, action: "booked" }, session);
    return { replay: false, financial };
  });
  if (result.financial && !result.financial.replay) await afterVisitCommit(() => afterTransferCommit(result.financial.transaction));
  return { ...await getReservation(req, id, now), replay: result.replay };
};
export const getReservation = async (req, id = req.params.reservationId, now = new Date()) => {
  const reservation = await ownedReservation(req, id), care = await CareSession.findById(reservation.session).lean();
  if (!care) throw accessError(409, "Reservation session requires review");
  const appointment = reservation.appointmentId ? await Appointment.findById(reservation.appointmentId).lean() : null;
  const unavailable = await doctorUnavailable(care);
  const token = reservation.tokenId ? await Token.findById(reservation.tokenId).select("displayToken status arrivedAt revision").lean() : null;
  const expired = reservation.state === "held" && reservation.expiresAt <= now;
  return { reservation: { _id: reservation._id, state: expired ? "expired" : reservation.state, revision: reservation.revision, familyMemberId: reservation.familyMemberId || null,
    slotId: reservation.slot, expiresAt: reservation.expiresAt, startsAt: reservation.startsAt, endsAt: reservation.endsAt, appointmentId: reservation.appointmentId, tokenId: reservation.tokenId,
    fee: { amountMinor: reservation.feeMinor, amount: fromMinor(reservation.feeMinor), currency: reservation.currency, demo: true } },
    session: sessionView(care), doctorUnavailable: unavailable, appointment: appointment ? { _id: appointment._id, status: appointment.status, admissionState: appointment.admissionState,
      checkedInAt: appointment.checkedInAt, revision: appointment.revision, payment: { paid: Boolean(appointment.payment?.paidAt) || !reservation.feeMinor, refundState: appointment.payment?.refundState || null } } : null,
    token, generatedAt: now, nextStep: unavailable ? "Reschedule or cancel: doctor unavailable" : expired ? "Choose another available slot" : reservation.state === "held" ? "Confirm before the hold expires" : reservation.state === "confirmed" && appointment?.admissionState === "reserved" ? (care.hospitalId ? "Check in with hospital reception during the arrival window" : "Check in online during the arrival window") : "Follow the current visit status",
    cancellation: { allowed: reservation.state === "held" || reservation.state === "confirmed" && appointment?.status === "queued" && (unavailable || withinChangePolicy(reservation, care, "cancel", now)), fullDemoRefund: true },
    rescheduling: { allowed: reservation.state === "confirmed" && appointment?.admissionState === "reserved" && (unavailable || withinChangePolicy(reservation, care, "reschedule", now)), sameDoctorPracticeAndFee: true },
    queuePosition: appointment?.status === "active" ? 0 : appointment ? await appointmentPosition(appointment, now) : null, estimatedWaitMinutes: null, location: care.hospitalId ? { hospitalId: care.hospitalId, departmentId: care.departmentId, room: null } : null };
};
export const listReservations = async req => {
  if (req.auth?.role !== "user") throw accessError(403, "Patient account required");
  const requested = Number(req.query.limit ?? 20);
  if (!Number.isInteger(requested) || requested < 1 || requested > 50) throw accessError(400, "Limit must be an integer between 1 and 50");
  const limit = requested;
  const rows = await CareReservation.find({ user: req.auth.id }).sort({ createdAt: -1 }).limit(limit).select("_id").lean();
  const visits = []; for (const row of rows) { try { visits.push(await getReservation(req, row._id)); } catch (error) { if (error.status !== 403) throw error; } }
  return { visits };
};
export const cancelCareReservation = async (req, now = new Date()) => {
  const id = requireRecordId(req.params.reservationId, "reservation"), identity = requestIdentity(req, "cancel", { reservationId: id });
  const result = await scheduleTransaction(async session => {
    const reservation = await ownedReservation(req, id, session), replay = await operationReplay(identity, session);
    if (replay || reservation.state === "cancelled") return { replay: true };
    const care = await CareSession.findById(reservation.session).session(session);
    if (!care) throw accessError(409, "Reservation session requires review");
    await lockSchedule("doctor:" + care.canonicalDoctorId, session);
    let financial;
    if (reservation.state === "held") await releaseReservation(reservation, "cancelled", session);
    else if (reservation.state === "confirmed") {
      const appointment = await Appointment.findById(reservation.appointmentId).session(session);
      if (appointment.status !== "queued") throw accessError(409, "Visit cannot be cancelled after care begins");
      if (!withinChangePolicy(reservation, care, "cancel", now) && !(await doctorUnavailable(care, session))) throw accessError(409, "The cancellation deadline has passed");
      if (appointment.payment?.paymentId) financial = (await refundAppointment({ appointmentId: appointment._id, session, now })).financial;
      else await transitionVisit({ appointmentId: appointment._id, action: "cancel", session, now });
    } else throw accessError(409, "Reservation cannot be cancelled");
    await saveOperation(identity, id, session); return { replay: false, financial };
  });
  if (result.financial?.refundTxn && !result.financial.replay) await afterVisitCommit(() => afterTransferCommit(result.financial.refundTxn));
  return { ...await getReservation(req, id, now), replay: result.replay };
};
export const rescheduleCareReservation = async (req, now = new Date()) => {
  const id = requireRecordId(req.params.reservationId, "reservation"), slotId = requireRecordId(req.body.slotId, "slot"), revision = req.body.revision;
  if (!Number.isInteger(revision) || revision < 0) throw accessError(400, "Reservation revision is required");
  const identity = requestIdentity(req, "reschedule", { reservationId: id, slotId, revision }); await expireScheduleHolds(now);
  const result = await scheduleTransaction(async session => {
    const reservation = await ownedReservation(req, id, session), replay = await operationReplay(identity, session); if (replay) return { replay: true };
    if (reservation.state !== "confirmed" || reservation.revision !== revision) throw accessError(409, "Reservation changed; refresh before rescheduling");
    const prior = await CareSession.findById(reservation.session).session(session), slot = await CareSlot.findById(slotId).session(session), care = slot && await CareSession.findById(slot.session).session(session);
    if (!care) throw accessError(404, "Target slot not found");
    if (care.practiceKey !== prior.practiceKey || idOf(care.doctorId) !== idOf(prior.doctorId) || idOf(care.departmentId) !== idOf(prior.departmentId) || care.appointmentType !== prior.appointmentType || care.feeMinor !== reservation.feeMinor) throw accessError(409, "Reschedule requires the same doctor, practice, visit type and fee");
    await lockSchedule("doctor:" + care.canonicalDoctorId, session); await lockSchedule("person:" + reservation.personKey, session); await eligible(care, session);
    const appointment = await Appointment.findById(reservation.appointmentId).session(session);
    if (appointment.status !== "queued" || appointment.admissionState !== "reserved") throw accessError(409, "Arrived or active visits cannot be rescheduled");
    if (!withinChangePolicy(reservation, prior, "reschedule", now) && !(await doctorUnavailable(prior, session))) throw accessError(409, "The rescheduling deadline has passed");
    if (!bookingOpen(care, slot, now) || idOf(slot._id) === idOf(reservation.slot)) throw accessError(409, "Choose another future slot");
    if (await CareReservation.exists({ _id: { $ne: id }, personKey: reservation.personKey, state: { $in: ["held", "confirmed"] }, $or: [{ session: care._id }, { startsAt: { $lt: slot.endsAt }, endsAt: { $gt: slot.startsAt } }] }).session(session)) throw accessError(409, "Patient already has a reservation in this session or an overlapping visit");
    await expireInSession(care, now, session);
    if (!(await CareSlot.findOneAndUpdate({ _id: slotId, occupied: { $lt: slot.capacity } }, { $inc: { occupied: 1 } }, { session, new: true }))) throw accessError(409, "Target slot is full");
    if (!(await CareSlot.findOneAndUpdate({ _id: reservation.slot, occupied: { $gt: 0 } }, { $inc: { occupied: -1 } }, { session, new: true }))) throw accessError(409, "Source capacity requires review");
    Object.assign(appointment, { ...scheduleContext(care), scheduleSessionId: care._id, scheduledStart: slot.startsAt, scheduledEnd: slot.endsAt, revision: appointment.revision + 1 }); await appointment.save({ session });
    let token;
    if (reservation.tokenId) {
      token = await Token.findById(reservation.tokenId).session(session);
      if (token.status !== "reserved" || token.arrivedAt) throw accessError(409, "Hospital arrival already recorded");
      const number = care.queueKey === token.queueKey ? token.tokenNumber : await allocateToken(care, session);
      const prefix = (await Hospital.findById(care.hospitalId).session(session)).settings?.tokenPrefix || "T";
      Object.assign(token, { ...scheduleContext(care), tokenNumber: number, displayToken: prefix + String(number).padStart(3, "0"), date: new Date(care.serviceDate + "T00:00:00Z"),
        scheduleSessionId: care._id, scheduledStart: slot.startsAt, scheduledEnd: slot.endsAt, revision: token.revision + 1 }); await token.save({ session });
    }
    Object.assign(reservation, { slot: slotId, session: care._id, startsAt: slot.startsAt, endsAt: slot.endsAt, revision: reservation.revision + 1 }); await reservation.save({ session });
    await saveOperation(identity, id, session); await recordVisitEvent({ token, appointment, action: "rescheduled" }, session);
    // Also invalidate the old queue after a session move.
    if (prior.queueKey !== care.queueKey) await recordVisitEvent({ appointment: { ...appointment.toObject(), queueKey: prior.queueKey }, action: "rescheduled_from" }, session);
    return { replay: false };
  });
  return { ...await getReservation(req, id, now), replay: result.replay };
};
export const admitCareReservation = async (req, now = new Date()) => {
  const id = requireRecordId(req.params.reservationId, "reservation"), identity = requestIdentity(req, "admit", { reservationId: id });
  const result = await scheduleTransaction(async session => {
    const reservation = await ownedReservation(req, id, session), replay = await operationReplay(identity, session); if (replay) return { replay: true };
    const care = await CareSession.findById(reservation.session).session(session);
    if (care.hospitalId) throw accessError(403, "Hospital reception must confirm physical arrival");
    if (reservation.state !== "confirmed") throw accessError(409, "Confirmed reservation required");
    const appointment = await Appointment.findById(reservation.appointmentId).session(session);
    if (appointment.admissionState === "arrived") { await saveOperation(identity, id, session); return { replay: true }; }
    await transitionVisit({ appointmentId: appointment._id, action: "admit", session, now }); await saveOperation(identity, id, session);
    return { replay: false };
  });
  return { ...await getReservation(req, id, now), replay: result.replay };
};
export const scheduledQueueContext = async ({ hospital, doctorId, sessionId, serviceDate }) => {
  if (!/^s_[a-f\d]{24}$/.test(sessionId || "")) return null;
  const care = await CareSession.findOne({ hospitalId: hospital._id, doctorId, sessionId, ...(serviceDate ? { serviceDate } : {}) }).lean();
  if (!care) throw accessError(404, "Scheduled hospital session not found");
  return scheduleContext(care);
};
export const startScheduleExpiryWorker = () => {
  let busy = false;
  const timer = setInterval(async () => { if (busy) return; busy = true; try { await expireScheduleHolds(); } catch { console.error("Schedule hold expiry needs retry"); } finally { busy = false; } }, 30000);
  timer.unref(); return () => clearInterval(timer);
};
