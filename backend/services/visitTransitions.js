import { recordVisitEvent } from "./workflowEvents.js";
import { consultationDeadline } from "./consultationPolicy.js";
import Appointment from "../model/appointment.js";
import OpdToken from "../model/opdToken.js";
import HospitalStaff from "../model/hospitalStaff.js";
import Department from "../model/department.js";
import { accessError, idOf } from "./hospitalAccess.js";
import { queueTransaction } from "./queueBooking.js";
import { localServiceDate, requireQueueContext } from "./queueContext.js";
import { scheduleTransition } from "./schedulingLifecycle.js";
import { autoRefundDeadline } from "./consultationPolicy.js";

const transitions = {
  admit: { appointment: ["queued"] },
  check_in: { token: ["reserved"], toToken: "waiting" },
  vitals: { token: ["waiting", "vitals_done"], toToken: "vitals_done" },
  start: { token: ["waiting", "vitals_done"], appointment: ["queued"], toToken: "in_consultation", toAppointment: "active" },
  complete: { token: ["in_consultation"], appointment: ["active"], toToken: "completed", toAppointment: "completed" },
  no_show: { token: ["reserved", "waiting", "vitals_done"], appointment: ["queued"], toToken: "no_show", toAppointment: "cancelled" },
  refund_hold: { token: ["reserved", "waiting", "vitals_done", "no_show", "cancelled"], appointment: ["queued", "cancelled"], toToken: "refund_pending", toAppointment: "refund_pending" },
  refund_restore: { token: ["refund_pending"], appointment: ["refund_pending"], toAppointment: "queued" },
  cancel: { token: ["refund_pending", "reserved", "waiting", "vitals_done", "no_show", "cancelled"], appointment: ["refund_pending", "queued", "cancelled"], toToken: "cancelled", toAppointment: "cancelled" },
};

export const transitionVisit = async ({ tokenId, appointmentId, action, expectedRevision, tokenFields = {}, appointmentFields = {}, now = new Date(), session: providedSession }) => {
  const rule = transitions[action];
  if (!rule) throw accessError(400, "Unknown visit transition");
  if (expectedRevision !== undefined && (!Number.isInteger(expectedRevision) || expectedRevision < 0)) throw accessError(400, "Invalid visit revision");
  const apply = async (session) => {
    let token = tokenId ? await OpdToken.findById(tokenId).session(session) : await OpdToken.findOne({ appointmentId }).session(session);
    let appointment = appointmentId ? await Appointment.findById(appointmentId).session(session)
      : token?.appointmentId ? await Appointment.findById(token.appointmentId).session(session) : null;
    if ((!token && tokenId) || (!appointment && appointmentId) || (!token && !appointment)) throw accessError(404, "Visit not found");
    if (token) {
      const staff = await HospitalStaff.findOne({ _id: token.doctorId, hospitalId: token.hospitalId, role: "DOCTOR", departmentIds: token.departmentId }).session(session);
      const department = await Department.exists({ _id: token.departmentId, hospitalId: token.hospitalId }).session(session);
      if (!staff || !department) throw accessError(403, "Visit references do not belong to this hospital department");
      if (token.appointmentId && (!appointment || idOf(appointment.doctor) !== idOf(staff.doctorId || staff._id)
        || idOf(appointment.user) !== idOf(token.patientId) || idOf(appointment.familyMemberId) !== idOf(token.familyMemberId)
        || appointment.queueKey !== token.queueKey || idOf(appointment.opdTokenId) !== idOf(token))) {
        throw accessError(403, "Linked appointment does not match this visit");
      }
    }
    if (token) requireQueueContext(token);
    if (appointment) requireQueueContext(appointment);
    if (token && appointment) {
      const expected = { booking: "booking", reserved: "queued", waiting: "queued", vitals_done: "queued",
        in_consultation: "active", completed: "completed", no_show: "cancelled", cancelled: "cancelled", refund_pending: "refund_pending" }[token.status];
      if (appointment.status !== expected) throw accessError(409, "Linked visit states disagree; review is required");
    }
    const primary = tokenId ? token : appointment;
    if (expectedRevision !== undefined && (primary.revision || 0) !== expectedRevision) throw accessError(409, "Visit changed; refresh before retrying");
    if (token && rule.token && !rule.token.includes(token.status)) throw accessError(409, "Token is not eligible for this transition");
    if (appointment && rule.appointment && !rule.appointment.includes(appointment.status)) throw accessError(409, "Appointment is not eligible for this transition");
    if (action === "admit" && (!appointment?.scheduleReservationId || token)) throw accessError(409, "Only scheduled online visits support online check-in");
    await scheduleTransition(appointment, action, session, now);
    if (["start", "vitals"].includes(action) && token && !token.arrivedAt) throw accessError(409, "Staff check-in is required before care begins");
    if (action === "start") {
      if (primary.serviceDate !== localServiceDate(now, primary.timezone)) throw accessError(409, "This care session is not on the current service date");
      const head = token ? await OpdToken.findOne({ queueKey: token.queueKey, status: { $in: ["waiting", "vitals_done"] }, $or: [{ scheduledStart: { $exists: false } }, { scheduledStart: { $lte: now } }] }).sort({ tokenNumber: 1 }).session(session)
        : await Appointment.findOne({ queueKey: appointment.queueKey, status: "queued", admissionState: { $ne: "reserved" }, $or: [{ scheduledStart: { $exists: false } }, { scheduledStart: { $lte: now } }] }).sort({ checkedInAt: 1, createdAt: 1, _id: 1 }).session(session);
      if (!head || idOf(head) !== idOf(token || appointment)) throw accessError(409, "Please start visits in this session's queue order");
    }
    const tokenSet = { ...tokenFields }, appointmentSet = { ...appointmentFields };
    if (rule.toToken) tokenSet.status = rule.toToken;
    if (rule.toAppointment) appointmentSet.status = rule.toAppointment;
    if (action === "refund_hold") {
      if (appointment?.payment?.refundState === "processing") throw accessError(409, "Refund is processing or requires reconciliation");
      appointmentSet["payment.refundState"] = "processing";
      if (appointment?.status === "cancelled") appointmentSet.status = "cancelled";
      if (["no_show", "cancelled"].includes(token?.status)) tokenSet.status = token.status;
    }
    if (action === "cancel") {
      if (appointment?.status === "cancelled" && appointment.payment?.refundState !== "processing") throw accessError(409, "Terminal visit requires a claimed refund operation");
      appointmentSet["payment.refundState"] = "completed";
      if (["no_show", "cancelled"].includes(token?.status)) tokenSet.status = token.status;
    }
    if (action === "check_in") tokenSet.arrivedAt = now;
    if (["admit", "check_in"].includes(action) && appointment?.scheduleReservationId) {
      appointmentSet.admissionState = "arrived"; appointmentSet.checkedInAt = now;
      appointmentSet.refundDueAt = autoRefundDeadline({ ...appointment.toObject(), admissionState: "arrived" }, now);
    }
    if (action === "vitals") tokenSet.vitalsCompletedAt = now;
    if (action === "start") {
      tokenSet.consultationStartedAt = now;
      Object.assign(appointmentSet, { startedAt: now, consultationDeadline: consultationDeadline(appointment, now), refundDueAt: null, endedAt: null, endedBy: null, endedReason: null });
    }
    if (["complete", "no_show", "cancel"].includes(action)) {
      tokenSet.consultationEndedAt = action === "complete" ? now : token?.consultationEndedAt;
      appointmentSet.endedAt = now; appointmentSet.endedBy ||= "system";
      appointmentSet.endedReason ||= action === "complete" ? "doctor-ended" : "cancelled";
      if (action === "cancel" && appointment?.status === "cancelled") {
        appointmentSet.endedAt = appointment.endedAt; appointmentSet.endedBy = appointment.endedBy;
        appointmentSet.endedReason = appointment.endedReason;
      }
    }
    if (action === "refund_hold" && token) tokenSet.refundPreviousStatus = token.status;
    if (action === "refund_restore" && token) {
      if (!["reserved", "waiting", "vitals_done"].includes(token.refundPreviousStatus)) throw accessError(409, "Refund recovery needs review");
      tokenSet.status = token.refundPreviousStatus;
    }
    if (token && (rule.token || action === "refund_restore")) {
      token = await OpdToken.findOneAndUpdate({ _id: token._id, status: token.status, revision: token.revision || 0 },
        { $set: tokenSet, $inc: { revision: 1 } }, { new: true, session, runValidators: true });
      if (!token) throw accessError(409, "Token changed; refresh before retrying");
    }
    if (appointment && (rule.appointment || action === "check_in" && appointment.scheduleReservationId)) {
      appointment = await Appointment.findOneAndUpdate({ _id: appointment._id, status: appointment.status, revision: appointment.revision || 0 },
        { $set: appointmentSet, $inc: { revision: 1 } }, { new: true, session, runValidators: true });
      if (!appointment) throw accessError(409, "Appointment changed; refresh before retrying");
    }
    await recordVisitEvent({ token, appointment, action }, session);
    return { token, appointment };
  };
  return providedSession ? apply(providedSession) : queueTransaction(apply);
};

export const afterVisitCommit = async (...effects) => {
  for (const effect of effects) {
    try { await effect(); } catch { console.error("Visit committed; refresh/notification delivery needs retry"); }
  }
};
