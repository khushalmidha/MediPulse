import mongoose from "mongoose";
import OpdToken from "../model/opdToken.js";
import Department from "../model/department.js";
import Hospital from "../model/hospital.js";
import HospitalStaff from "../model/hospitalStaff.js";
import { resolveConsultationFee } from "../config/fees.js";
import { getRedis } from "../services/redis.js";
import { readQueueRevision } from "../services/workflowEvents.js";
import { getIO } from "../socket.js";
import { accessError, assertVisitAccess, canAccessVisit, departmentMember, emitOpdEvent, idOf,
  loadVisit, requireRecordId, resolveBookingIdentity, visitForStaff } from "../services/hospitalAccess.js";
import { queueContext, localServiceDate, patientKey, liveTokenStatuses, invalidateVisitQueue } from "../services/queueContext.js";
import { bookingRequest, createQueueBooking } from "../services/queueBooking.js";
import { transitionVisit, afterVisitCommit } from "../services/visitTransitions.js";

const sameHospital = (req, hospitalId) => idOf(req.staff?.hospitalId) === String(hospitalId);
const queuePosition = (token) => token.status === "reserved" ? 0 : OpdToken.countDocuments({ queueKey: token.queueKey,
  status: { $in: ["waiting", "vitals_done", "in_consultation"] }, tokenNumber: { $lte: token.tokenNumber } });
const notify = async (event, token) => afterVisitCommit(
  () => invalidateVisitQueue(token, getRedis()), () => emitOpdEvent(getIO(), event, token));

const issueToken = async (req, res) => {
  const { hospitalId, departmentId } = req.params;
  if (req.staff && !sameHospital(req, hospitalId)) throw accessError(403, "Forbidden hospital access");
  const { doctorId, patientInfo = {}, visitType = "new", chiefComplaint = "" } = req.body;
  requireRecordId(hospitalId, "hospital"); requireRecordId(departmentId, "department"); requireRecordId(doctorId, "doctor");
  const { patientId, familyMemberId } = await resolveBookingIdentity(req, req.body.patientId, req.body.familyMemberId);
  if (req.staff && (!["RECEPTIONIST", "HOSPITAL_ADMIN", "NURSE"].includes(req.staff.role)
    || !canAccessVisit(req.staff, { hospitalId, departmentId, doctorId }))) throw accessError(403, "You cannot book for this department");
  const department = await Department.findOne({ _id: departmentId, hospitalId, status: "active" });
  const doctor = await HospitalStaff.findOne({ _id: doctorId, hospitalId, departmentIds: departmentId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" });
  if (!department) throw accessError(404, "Department not found");
  if (!doctor) throw accessError(404, "Doctor not found in this hospital");
  const hospital = await Hospital.findOne({ _id: hospitalId, status: "active" });
  if (!hospital) throw accessError(404, "Active hospital not found");
  if (!["new", "follow_up", "emergency"].includes(visitType)) throw accessError(400, "Invalid visit type");
  const context = queueContext({ hospital, doctorId, sessionId: req.body.sessionId, serviceDate: req.body.serviceDate });
  const person = patientId ? patientKey(patientId, familyMemberId) : `walkin:${req.staff?.id}:${req.get?.("Idempotency-Key") || req.body.requestId || "missing"}`;
  const request = bookingRequest(req, "opd", context, person, { hospitalId, departmentId, doctorId, patientId, familyMemberId,
    patientInfo, visitType, chiefComplaint, sessionId: context.sessionId, serviceDate: req.body.serviceDate || null });
  const patientBooking = !req.staff;
  const fee = resolveConsultationFee({ consultationFee: doctor.doctorProfile?.consultationFee ?? department.opd?.consultationFee });
  if (patientBooking && fee > 0 && !doctor.doctorId) throw accessError(409, "This hospital doctor is still syncing");
  const result = await createQueueBooking({ request, context, personKey: person, fee: patientBooking ? fee : 0,
    payerId: patientBooking ? patientId : undefined, receiverId: doctor.doctorId,
    tokenData: { hospitalId, departmentId, doctorId, patientId, familyMemberId, patientInfo: { ...patientInfo, isWalkIn: !patientId },
      visitType, chiefComplaint, visitMode: "in_person", tokenPrefix: hospital.settings?.tokenPrefix || "T",
      arrivedAt: req.staff ? new Date() : undefined, paymentAmount: fee, paymentMode: patientBooking ? "wallet" : undefined,
      estimatedWaitMinutes: undefined },
    appointmentData: patientId && doctor.doctorId ? { doctor: doctor.doctorId, user: patientId, familyMemberId, visitMode: "in_person",
      roomId: `appointment-${new mongoose.Types.ObjectId()}`, patientBrief: chiefComplaint ? { chiefComplaint, urgencyLevel: "ROUTINE", agentSummary: chiefComplaint } : undefined } : undefined,
  });
  if (result.operation.state !== "completed") return res.status(202).json({ message: result.operation.state === "review_required" ? "Booking requires reviewed recovery; do not make another payment" : "Booking is processing; retry with the same request key", operationId: result.operation._id, status: "processing" });
  const token = result.token;
  if (!result.replay) await notify("opd:token-issued", token);
  if (result.appointment) await afterVisitCommit(async () => {
    const io = getIO();
    io?.to(`doctor:${idOf(result.appointment.doctor)}`).emit("appointment:brief-ready", { appointmentId: result.appointment._id, source: "hospital-opd" });
    io?.to(`user:${idOf(token.patientId)}`).emit("appointment:user-status", { doctorId: idOf(result.appointment.doctor), appointmentId: result.appointment._id,
      status: result.appointment.status, queueKey: token.queueKey, visitMode: "in_person" });
  });
  return res.status(result.replay ? 200 : 201).json({ token: req.staff ? visitForStaff(token, req.staff) : token,
    appointmentId: result.appointment?._id, displayToken: token.displayToken, queuePosition: await queuePosition(token),
    estimatedWaitMinutes: token.estimatedWaitMinutes ?? null, replay: result.replay,
    payment: result.operation.paymentId ? { transactionId: result.operation.paymentId, amount: result.operation.fee, mode: "wallet" } : null });
};

const getDoctorQueue = async (req, res) => {
  const { hospitalId, doctorId } = req.params;
  if (!sameHospital(req, hospitalId)) throw accessError(403, "Forbidden hospital access");
  requireRecordId(doctorId, "doctor");
  const doctor = await HospitalStaff.findOne({ _id: doctorId, hospitalId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" });
  if (!doctor) throw accessError(404, "Doctor not found");
  const allowed = req.staff.role === "DOCTOR" ? req.staff.id === String(doctorId) : ["HOSPITAL_ADMIN", "RECEPTIONIST"].includes(req.staff.role)
    || (["NURSE", "DEPARTMENT_HEAD"].includes(req.staff.role) && doctor.departmentIds.some((id) => departmentMember(req.staff, id)));
  if (!allowed) throw accessError(403, "You cannot access this doctor queue");
  const hospital = await Hospital.findById(hospitalId);
  const context = queueContext({ hospital, doctorId, sessionId: req.query.sessionId, serviceDate: req.query.serviceDate, historical: true });
  // Query authoritative rows: a cache failure or missed event must not change the queue.
  const snapshotRevision = await readQueueRevision(context.queueKey);
  const rows = await OpdToken.find({ queueKey: context.queueKey }).sort({ tokenNumber: 1 }).populate("departmentId", "name").lean();
  const departments = await Department.find({ hospitalId, _id: { $in: doctor.departmentIds } }).select("_id").lean();
  const tokens = rows.filter((token) => canAccessVisit(req.staff, token) && departments.some((d) => idOf(d) === idOf(token.departmentId)))
    .map((token) => visitForStaff(token, req.staff));
  if (await readQueueRevision(context.queueKey) !== snapshotRevision) throw accessError(409, "Queue changed; refresh status");
  return res.json({ ...context, queueRevision: snapshotRevision, sessionIds: hospital.settings?.queueSessionIds || ["day"], currentlyServing: tokens.find((token) => token.status === "in_consultation") || null,
    waiting: tokens.filter((token) => ["waiting", "vitals_done"].includes(token.status)),
    reservations: tokens.filter((token) => token.status === "reserved"), completed: tokens.filter((token) => token.status === "completed").length,
    noShows: tokens.filter((token) => token.status === "no_show").length, estimatedEndTime: null });
};

const mutateToken = async (req, res, action) => {
  const token = await loadVisit(req.staff, req.params.tokenId);
  if (["start", "complete"].includes(action) && idOf(token.doctorId) !== req.staff.id) throw accessError(403, "Only the assigned doctor can manage this consultation");
  if (action === "vitals") {
    assertVisitAccess(req.staff, token, { clinical: true });
    if (req.staff.role !== "NURSE") throw accessError(403, "Assigned nursing staff are required to record vitals");
  }
  if (["no_show", "check_in"].includes(action) && !["NURSE", "RECEPTIONIST", "HOSPITAL_ADMIN"].includes(req.staff.role)) throw accessError(403, "Nurse, receptionist or admin access is required");
  const fields = {};
  if (action === "vitals") {
    fields.vitals = { ...Object.fromEntries(["bp", "temperature", "pulse", "oxygenSat", "weight", "height"].filter((key) => req.body[key] !== undefined).map((key) => [key, req.body[key]])), recordedAt: new Date(), recordedBy: req.staff.id };
    if (req.body.chiefComplaint !== undefined) fields.chiefComplaint = String(req.body.chiefComplaint);
  }
  if (action === "complete") {
    fields.consultationNotes = String(req.body.notes || "").trim(); fields.diagnosis = String(req.body.diagnosis || "").trim();
    if (req.body.followUpDate) { const date = new Date(req.body.followUpDate); if (Number.isNaN(date.getTime())) throw accessError(400, "Invalid follow-up date"); fields.followUpDate = date; }
  }
  const changed = await transitionVisit({ tokenId: token._id, action, expectedRevision: req.body.revision, tokenFields: fields,
    appointmentFields: action === "complete" ? { endedBy: "doctor" } : {} });
  const events = { start: "opd:consultation-started", complete: "opd:consultation-completed", vitals: "opd:vitals-ready", no_show: "opd:no-show", check_in: "opd:checked-in" };
  await notify(events[action], changed.token);
  if (changed.appointment && ["start", "complete", "no_show"].includes(action)) await afterVisitCommit(async () => {
    const io = getIO(); const appointment = changed.appointment;
    io?.to(`user:${idOf(appointment.user)}`).emit(action === "start" ? "appointment:started" : "appointment:ended", {
      appointmentId: appointment._id, doctorId: idOf(appointment.doctor), status: appointment.status, visitMode: appointment.visitMode,
      startedAt: appointment.startedAt, endedAt: appointment.endedAt, endsAt: null });
  });
  if (action === "start" && token.patientId) await afterVisitCommit(async () => getIO()?.to(`user:${idOf(token.patientId)}`).emit("opd:patient-called", {
    tokenId: token._id, displayToken: token.displayToken, hospitalId: idOf(token.hospitalId), departmentId: idOf(token.departmentId), status: "in_consultation", visitMode: "in_person" }));
  return res.json({ message: { start: "Consultation started", complete: "Consultation completed", vitals: "Vitals recorded", no_show: "Token marked as no-show", check_in: "Patient checked in" }[action],
    token: visitForStaff(changed.token, req.staff) });
};
const recordVitals = (req, res) => mutateToken(req, res, "vitals");
const startConsultation = (req, res) => mutateToken(req, res, "start");
const completeConsultation = (req, res) => mutateToken(req, res, "complete");
const markNoShow = (req, res) => mutateToken(req, res, "no_show");
const checkIn = (req, res) => mutateToken(req, res, "check_in");
const getMyActiveToken = async (req, res) => {
  if (req.auth?.role !== "user") throw accessError(403, "Patient account required");
  const hospital = await Hospital.findById(req.params.hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  const tokens = await OpdToken.find({ hospitalId: hospital._id, patientId: req.auth.id, status: { $in: liveTokenStatuses }, serviceDate: req.query.serviceDate || localServiceDate(new Date(), hospital.settings?.timezone),
    ...(req.query.doctorId ? { doctorId: requireRecordId(req.query.doctorId, "doctor") } : {}),
    ...(req.query.familyMemberId ? { familyMemberId: requireRecordId(req.query.familyMemberId, "family member") } : {}) }).sort({ createdAt: -1 }).lean();
  return res.json({ token: tokens[0] || null, tokens });
};
export { issueToken, getDoctorQueue, recordVitals, startConsultation, completeConsultation, markNoShow, getMyActiveToken, checkIn };
