import { CareSession, CareReservation, CareSlot, ScheduleLock, DoctorAbsence } from "../model/scheduling.js";
import { accessError, idOf } from "./hospitalAccess.js";
import { admissionWindow, withinChangePolicy } from "./schedulingPolicy.js";
import Staff from "../model/hospitalStaff.js";
import Hospital from "../model/hospital.js";
import Department from "../model/department.js";
import Doctor from "../model/doctor.js";

export const lockSchedule = async (key, session) => ScheduleLock.findOneAndUpdate({ _id: key }, { $inc: { revision: 1 } }, { upsert: true, new: true, session });
export const doctorUnavailable = async (care, session) => {
  if (care.state !== "open" || !(await Doctor.exists({ _id: care.canonicalDoctorId }).session(session))) return true;
  if (care.hospitalId && (!(await Hospital.exists({ _id: care.hospitalId, status: "active" }).session(session))
    || !(await Department.exists({ _id: care.departmentId, hospitalId: care.hospitalId, status: "active" }).session(session))
    || !(await Staff.exists({ _id: care.doctorId, doctorId: care.canonicalDoctorId, hospitalId: care.hospitalId, departmentIds: care.departmentId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" }).session(session)))) return true;
  return Boolean(await DoctorAbsence.exists({ canonicalDoctorId: care.canonicalDoctorId, active: true, startsAt: { $lt: care.endsAt }, endsAt: { $gt: care.startsAt } }).session(session));
};
export const releaseReservation = async (reservation, state, session) => {
  if (!["held", "confirmed"].includes(reservation.state)) return;
  const changed = await CareReservation.findOneAndUpdate({ _id: reservation._id, state: reservation.state, revision: reservation.revision }, { $set: { state }, $inc: { revision: 1 } }, { session, new: true });
  if (!changed) throw accessError(409, "Reservation changed; refresh before retrying");
  const slot = await CareSlot.findOneAndUpdate({ _id: reservation.slot, occupied: { $gt: 0 } }, { $inc: { occupied: -1 } }, { session, new: true });
  if (!slot) throw accessError(409, "Slot accounting requires review");
  return changed;
};
export const scheduleTransition = async (appointment, action, session, now) => {
  if (!appointment?.scheduleReservationId) return;
  const reservation = await CareReservation.findById(appointment.scheduleReservationId).session(session);
  const care = reservation && await CareSession.findById(reservation.session).session(session);
  if (!care || idOf(reservation.appointmentId) !== idOf(appointment)) throw accessError(409, "Scheduling references require review");
  await lockSchedule("doctor:" + care.canonicalDoctorId, session);
  if (["admit", "check_in", "start"].includes(action)) {
    if (reservation.state !== "confirmed" || await doctorUnavailable(care, session)) throw accessError(409, "Doctor is unavailable; reschedule or cancel this reservation");
    if (["admit", "check_in"].includes(action) && !admissionWindow(reservation, care, now)) throw accessError(409, "Check-in is outside the reserved arrival window");
    if (action === "start" && (appointment.admissionState !== "arrived" || now < reservation.startsAt || now > new Date(care.endsAt.getTime() + care.policy.checkInGraceMinutes * 60000))) throw accessError(409, "Reservation is not ready for consultation");
  }
  if (action === "refund_hold" && !withinChangePolicy(reservation, care, "cancel", now) && !(appointment.refundDueAt && appointment.refundDueAt <= now) && !(await doctorUnavailable(care, session))) throw accessError(409, "The cancellation deadline has passed");
  if (["cancel", "no_show", "complete"].includes(action)) {
    if (action === "cancel" && appointment.payment?.refundState !== "processing" && reservation.state === "confirmed" && !withinChangePolicy(reservation, care, "cancel", now) && !(appointment.refundDueAt && appointment.refundDueAt <= now) && !(await doctorUnavailable(care, session))) throw accessError(409, "The cancellation deadline has passed");
    await releaseReservation(reservation, action === "complete" ? "completed" : "cancelled", session);
  }
};
