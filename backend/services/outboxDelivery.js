import { deliverBrokerEvent } from "./events.js";
import User from "../model/user.js";
import Doctor from "../model/doctor.js";
import HospitalStaff from "../model/hospitalStaff.js";
import Appointment from "../model/appointment.js";
import OpdToken from "../model/opdToken.js";
import BookingChallenge from "../model/bookingChallenge.js";
import AuthChallenge from "../model/authChallenge.js";
import { sendAppointmentOtpMail, sendPasswordResetOtpMail, sendAppointmentBookedMail, sendAppointmentRefundMail, sendMail } from "../util/mailer.js";
import { processReviewRequest } from "./reviewRequestWorker.js";
import { openSecret } from "./outbox.js";
import { emitOpdEvent } from "./hospitalAccess.js";
const name = record => [record?.firstName, record?.lastName].filter(Boolean).join(" ") || record?.name || "there";
export const deliverOutboxJob = async (job, io) => {
  const payload = job.payload;
  if (job.kind === "booking.otp" || job.kind === "reset.otp") {
    const secret = openSecret(job.secret), Model = job.kind === "booking.otp" ? BookingChallenge : AuthChallenge;
    const challenge = await Model.findById(payload.challengeId).select("+otpHash").lean();
    if (!challenge || challenge.consumedAt || challenge.expiresAt <= new Date() || challenge.otpHash !== secret.otpHash) return { skipped: true };
    const { otpHash, ...mail } = secret;
    await (job.kind === "booking.otp" ? sendAppointmentOtpMail(mail) : sendPasswordResetOtpMail(mail));
    return;
  }
  if (job.kind === "visit.event") return deliverBrokerEvent(`visit.${payload.action}`, payload, job._id);
  if (job.kind === "review.mail") return processReviewRequest(payload);
  if (job.kind === "visit.notification") {
    if (!io) throw new Error("Realtime server unavailable");
    // Events are invalidation hints. Each client reads an authorized current snapshot.
    if (payload.userId) io.to(`user:${payload.userId}`).emit("visit:changed", payload);
    io.to(`doctor:${payload.doctorId}`).emit("visit:changed", { queueKey: payload.queueKey, queueRevision: payload.queueRevision });
    if (payload.tokenId) {
      const token = await OpdToken.findById(payload.tokenId).lean();
      if (token) await emitOpdEvent(io, "opd:queue-changed", token);
    }
    return;
  }
  if (job.kind === "visit.mail") {
    const patient = await User.findById(payload.userId).select("firstName lastName email").lean();
    if (!patient?.email) return { skipped: true };
    const doctor = await Doctor.findById(payload.doctorId).select("firstName lastName").lean()
      || await HospitalStaff.findById(payload.doctorId).select("name").lean();
    const mail = { to: patient.email, patientName: name(patient), doctorName: name(doctor), appointmentId: payload.appointmentId || payload.tokenId };
    const appointment = payload.appointmentId ? await Appointment.findById(payload.appointmentId).lean() : null;
    if (payload.action === "start") {
      const token = payload.tokenId ? await OpdToken.findById(payload.tokenId).select("status").lean() : null;
      if (appointment ? appointment.status !== "active" : token?.status !== "in_consultation") return { skipped: true };
      return sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: patient.email,
        subject: "Your MediPulse doctor is ready", text: `Your visit ${mail.appointmentId} is ready for consultation. Sign in to MediPulse for the latest visit status and destination. If you are at the hospital, ask reception for the consultation room.` });
    }
    if (payload.action === "booked") {
      if (appointment && !["queued", "active"].includes(appointment.status)) return { skipped: true };
      return sendAppointmentBookedMail(mail);
    }
    if (appointment?.payment?.refundedAt) return sendAppointmentRefundMail({ ...mail, amount: appointment.payment.amount });
    return sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to: patient.email,
      subject: "Your MediPulse visit status changed", text: `Your visit ${mail.appointmentId} was cancelled or marked as missed. Sign in to MediPulse for the latest status.` });
  }
  throw new Error("Unknown durable delivery kind");
};
