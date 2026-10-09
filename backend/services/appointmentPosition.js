import Appointment from "../model/appointment.js";
import Token from "../model/opdToken.js";
export const appointmentPosition = async (appointment, now = new Date()) => {
  if (appointment.status !== "queued" || appointment.admissionState === "reserved" || appointment.scheduledStart && new Date(appointment.scheduledStart) > now) return null;
  if (appointment.visitMode === "in_person") {
    const token = await Token.findOne({ appointmentId: appointment._id });
    return token?.arrivedAt ? Token.countDocuments({ queueKey: token.queueKey, status: { $in: ["waiting", "vitals_done", "in_consultation"] }, tokenNumber: { $lte: token.tokenNumber },
      $or: [{ scheduledStart: { $exists: false } }, { scheduledStart: null }, { scheduledStart: { $lte: now } }] }) : null;
  }
  if (appointment.scheduleReservationId) return Appointment.countDocuments({ queueKey: appointment.queueKey, status: "queued", admissionState: "arrived", scheduledStart: { $lte: now },
    $or: [{ checkedInAt: { $lt: appointment.checkedInAt } }, { checkedInAt: appointment.checkedInAt, _id: { $lte: appointment._id } }] });
  return Appointment.countDocuments({ queueKey: appointment.queueKey, status: "queued", admissionState: { $ne: "reserved" },
    $or: [{ createdAt: { $lt: appointment.createdAt } }, { createdAt: appointment.createdAt, _id: { $lte: appointment._id } }] });
};
