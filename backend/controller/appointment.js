import { appointmentPosition } from "../services/appointmentPosition.js";
import Hospital from "../model/hospital.js";
import { mailConfigured } from "../services/outbox.js";
import { queueBookingOtp, verifyBookingOtp, readBookingProof, proofId } from "../services/bookingAuthorization.js";
import { readQueueRevision, withQueueRevision } from "../services/workflowEvents.js";
import mongoose from "mongoose";
import crypto from "crypto";
import Appointment from "../model/appointment.js";
import Doctor from "../model/doctor.js";
import OpdToken from "../model/opdToken.js";
import { emitOpdEvent, resolveBookingIdentity } from "../services/hospitalAccess.js";
import User from "../model/user.js";
import HospitalStaff from "../model/hospitalStaff.js";


// Accepts a raw id, an ObjectId, or a populated document and always returns a plain id string.
const normalizeId = (value) => {
  if (!value) return "";
  if (typeof value === "object" && value._id) return value._id.toString();
  return value.toString();
};

const getLinkedDoctorIds = async (doctorId) => {
  const rootId = normalizeId(doctorId);
  if (!rootId || !mongoose.Types.ObjectId.isValid(rootId)) return [];

  const ids = [rootId];
  const [platformDoc, staffDoc] = await Promise.all([
    Doctor.findById(rootId),
    HospitalStaff.findOne({ _id: rootId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" })
  ]);

  
  if (platformDoc) {
    const linkedStaff = await HospitalStaff.find({ doctorId: platformDoc._id, role: "DOCTOR", isActive: true, inviteStatus: "accepted" }, "_id");
    linkedStaff.forEach(s => ids.push(s._id.toString()));
  }
  
  if (staffDoc && staffDoc.doctorId) {
    ids.push(staffDoc.doctorId.toString());
    const linkedStaff = await HospitalStaff.find({ doctorId: staffDoc.doctorId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" }, "_id");
    linkedStaff.forEach(s => ids.push(s._id.toString()));
  }
  
  return [...new Set(ids)];
};

const splitName = (value) => {
  const normalized = String(value || "").trim();
  if (!normalized) return { firstName: "", lastName: "" };
  const [firstName, ...rest] = normalized.split(/\s+/);
  return { firstName, lastName: rest.join(" ") };
};

const populateDoctorForAppointments = async (appointments) => {
  if (!appointments || appointments.length === 0) return appointments;
  
  const doctorIds = [...new Set(appointments.map(a => 
    a.doctor?._id || a.doctor?.toString() || a.doctor
  ).filter(Boolean))];

  const [platformDoctors, hospitalDoctors] = await Promise.all([
    Doctor.find({ _id: { $in: doctorIds } }, "firstName lastName email profilePhoto").lean(),
    HospitalStaff.find({ _id: { $in: doctorIds }, role: "DOCTOR" }, "name email profilePhoto").lean(),
  ]);

  const doctorMap = {};
  platformDoctors.forEach(d => { doctorMap[d._id.toString()] = d; });
  hospitalDoctors.forEach(d => {
    const { firstName, lastName } = splitName(d.name);
    doctorMap[d._id.toString()] = { _id: d._id, firstName, lastName, email: d.email, profilePhoto: d.profilePhoto };
  });

  return appointments.map(a => {
    const docId = a.doctor?._id || a.doctor?.toString() || a.doctor;
    if (docId && doctorMap[docId.toString()]) {
      a.doctor = doctorMap[docId.toString()];
    } else if (a.doctor?._id) {
      a.doctor = null;
    }
    return a;
  });
};
import { getIO } from "../socket.js";
import { generateGeminiText, generateSoapNote as generateSoapNoteGemini } from "./gemini.js";
import { generateSoapNote } from "../services/copilotTools.js";
import {
  sendAppointmentBookedMail,
  sendAppointmentRefundMail,
} from "../util/mailer.js";
import {
  autoRefundSetKey,
  getRedis,
  queueCacheKey,
} from "../services/redis.js";
import { publishEvent } from "../services/events.js";
import { refundAppointment } from "../services/appointmentRefund.js";
import { resolveConsultationFee } from "../config/fees.js";
import { queueContext, patientKey, invalidateVisitQueue, explicitPractice } from "../services/queueContext.js";
import { bookingRequest, createQueueBooking, findBookingReplay } from "../services/queueBooking.js";
import { transitionVisit, afterVisitCommit } from "../services/visitTransitions.js";
import { accessError } from "../services/hospitalAccess.js";


const OTP_EXPIRY_MS = 10 * 60 * 1000;
const BOOKING_TOKEN_EXPIRY_MS = 10 * 60 * 1000;
// FIXED: Booking used to debit this flat amount (default INR 5) while every UI advertised the
// doctor's consultation fee (INR 500), so patients were shown one price and charged another.
// The fee charged now comes from the doctor's own `consultationFee`; this constant is only a
// last-resort fallback when an old appointment has no stored payment amount to refund.
const WALLET_APPOINTMENT_FEE_INR = Number(process.env.APPOINTMENT_BOOKING_FEE_INR || 500);
// The booking UI does not implement the OTP step yet, so enforcement is opt-in to avoid
// breaking every booking. Set REQUIRE_BOOKING_OTP=true once the frontend sends bookingToken.
// Either way, a token that IS supplied is always fully validated below (no more bypass).
const REQUIRE_BOOKING_OTP = process.env.REQUIRE_BOOKING_OTP === "true";





const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

const buildPersonName = (account, fallback) =>
  [account?.firstName, account?.lastName].filter(Boolean).join(" ") || fallback;

const ensureBookableAppointment = async (doctorId, userId, familyMemberId, sessionId) => {
  if (!mongoose.Types.ObjectId.isValid(doctorId)) return { status: 400, message: "Invalid doctor id" };
  const doctor = await Doctor.findById(doctorId);
  if (!doctor) return { status: 404, message: "Independent doctor not found; use hospital OPD for hospital doctors" };
  const context = queueContext({ doctorId, doctor, sessionId });
  const existing = await Appointment.findOne({ queueKey: context.queueKey, personKey: patientKey(userId, familyMemberId), status: { $in: ["booking", "queued", "active", "refund_pending"] } });
  if (existing) return { status: 409, message: "This patient already has a live booking in this session", appointmentId: existing._id, appointmentStatus: existing.status };
  return { doctor };
};

const mapQueueAppointment = (appointment) => ({
  _id: appointment._id,
  status: appointment.status,
  ...explicitPractice(appointment), practiceKey: appointment.practiceKey, queueKey: appointment.queueKey, serviceDate: appointment.serviceDate, sessionId: appointment.sessionId, visitMode: appointment.visitMode, revision: appointment.revision,
  appointmentType: appointment.appointmentType || (appointment.visitMode === "in_person" ? "hospital_in_person" : "online_opd"), scheduleReservationId: appointment.scheduleReservationId, scheduledStart: appointment.scheduledStart, scheduledEnd: appointment.scheduledEnd, admissionState: appointment.admissionState, checkedInAt: appointment.checkedInAt, feeSnapshot: appointment.feeSnapshot,
  createdAt: appointment.createdAt,
  startedAt: appointment.startedAt,
  endedAt: appointment.endedAt,
  roomId: appointment.roomId,
  patientBrief: appointment.patientBrief || null,
  user: appointment.user
    ? {
        _id: appointment.user._id,
        firstName: appointment.user.firstName,
        lastName: appointment.user.lastName,
        email: appointment.user.email,

      }
    : null,
});

const mapHistoryAppointment = (appointment) => ({
  _id: appointment._id,
  doctor: appointment.doctor,
  user: appointment.user,
  status: appointment.status,
  ...explicitPractice(appointment), practiceKey: appointment.practiceKey, queueKey: appointment.queueKey, serviceDate: appointment.serviceDate, sessionId: appointment.sessionId, visitMode: appointment.visitMode, revision: appointment.revision,
  appointmentType: appointment.appointmentType || (appointment.visitMode === "in_person" ? "hospital_in_person" : "online_opd"), scheduleReservationId: appointment.scheduleReservationId, scheduledStart: appointment.scheduledStart, scheduledEnd: appointment.scheduledEnd, admissionState: appointment.admissionState, checkedInAt: appointment.checkedInAt, feeSnapshot: appointment.feeSnapshot,
  createdAt: appointment.createdAt,
  startedAt: appointment.startedAt,
  endedAt: appointment.endedAt,
  endedBy: appointment.endedBy,
  endedReason: appointment.endedReason,
  doctorNotes: appointment.doctorNotes || "",
  receiptText: appointment.receiptText || "",
  receiptGeneratedAt: appointment.receiptGeneratedAt || null,
  patientBrief: appointment.patientBrief || null,
  payment: appointment.payment || null,
  endsAt: appointment.startedAt
    ? (appointment.visitMode === "in_person" ? null : appointment.consultationDeadline || null)
    : null,
});

const mapActiveAppointment = (appointment) => {
  if (!appointment) return null;
  return {
    _id: appointment._id,
    status: appointment.status,
  ...explicitPractice(appointment), practiceKey: appointment.practiceKey, queueKey: appointment.queueKey, serviceDate: appointment.serviceDate, sessionId: appointment.sessionId, visitMode: appointment.visitMode, revision: appointment.revision,
  appointmentType: appointment.appointmentType || (appointment.visitMode === "in_person" ? "hospital_in_person" : "online_opd"), scheduleReservationId: appointment.scheduleReservationId, scheduledStart: appointment.scheduledStart, scheduledEnd: appointment.scheduledEnd, admissionState: appointment.admissionState, checkedInAt: appointment.checkedInAt, feeSnapshot: appointment.feeSnapshot,
    createdAt: appointment.createdAt,
    startedAt: appointment.startedAt,
    endedAt: appointment.endedAt,
    roomId: appointment.roomId,
    doctorNotes: appointment.doctorNotes || "",
    receiptText: appointment.receiptText || "",
    receiptGeneratedAt: appointment.receiptGeneratedAt || null,
    patientBrief: appointment.patientBrief || null,
    payment: appointment.payment || null,
    endsAt: appointment.startedAt
      ? (appointment.visitMode === "in_person" ? null : appointment.consultationDeadline || null)
      : null,
    user: appointment.user
      ? {
          _id: appointment.user._id,
          firstName: appointment.user.firstName,
          lastName: appointment.user.lastName,
          email: appointment.user.email,

        }
      : null,
  };
};

const buildDoctorQueuePayloadRaw = async (doctorId, selectedQueueKey) => {
  const rootId = normalizeId(doctorId);
  const allIds = await getLinkedDoctorIds(rootId);
  const memberships = await HospitalStaff.find({ doctorId: rootId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" }).select("hospitalId").lean();
  const hospitals = await Hospital.find({ _id: { $in: memberships.map(staff => staff.hospitalId) }, status: "active" }).select("name slug").lean();
  const practiceKeys = [`independent:${rootId}`, ...hospitals.map(hospital => `hospital:${normalizeId(hospital)}`)];
  const rows = await Appointment.find({ doctor: { $in: allIds }, practiceKey: { $in: practiceKeys }, status: { $in: ["queued", "active"] } })
    .sort({ createdAt: 1, _id: 1 }).populate("user", "firstName lastName email").lean();
  const tokens = await OpdToken.find({ appointmentId: { $in: rows.map((row) => row._id) } }).select("appointmentId arrivedAt tokenNumber status").lean();
  const tokenFor = (row) => tokens.find((token) => normalizeId(token.appointmentId) === normalizeId(row));
  const queues = [...new Map(rows.map((row) => [row.queueKey, { queueKey: row.queueKey, practiceKey: row.practiceKey,
    ...explicitPractice(row), hospitalName: hospitals.find(hospital => row.practiceKey === `hospital:${normalizeId(hospital)}`)?.name, serviceDate: row.serviceDate, sessionId: row.sessionId, visitMode: row.visitMode }])).values()];
  const ready = (row) => row.admissionState !== "reserved" && (!row.scheduledStart || new Date(row.scheduledStart) <= new Date()) && (row.visitMode !== "in_person" || Boolean(tokenFor(row)?.arrivedAt));
  const doctor = await Doctor.findById(rootId);
  const independent = queueContext({ doctorId: rootId, doctor });
  if (!queues.some(queue => queue.queueKey === independent.queueKey)) queues.unshift(independent);
  if (selectedQueueKey && !queues.some(queue => queue.queueKey === selectedQueueKey)) throw accessError(403, "Queue is not available in this doctor's care contexts");
  const selected = selectedQueueKey || independent.queueKey;
  const selectedRows = rows.filter((row) => row.queueKey === selected);
  const queued = selectedRows.filter((row) => row.status === "queued" && ready(row)).sort((left, right) =>
    left.visitMode === "in_person" ? (tokenFor(left)?.tokenNumber || 0) - (tokenFor(right)?.tokenNumber || 0)
      : new Date(left.checkedInAt || left.createdAt) - new Date(right.checkedInAt || right.createdAt) || normalizeId(left).localeCompare(normalizeId(right)));
  const active = selectedRows.find((row) => row.status === "active");
  if (active) await populateDoctorForAppointments([active]);
  return { doctorId: rootId, queueKey: selected, queues, pendingCount: queued.length, queue: queued.map(mapQueueAppointment),
    reservations: selectedRows.filter((row) => row.status === "queued" && !ready(row)).map(mapQueueAppointment), activeAppointment: mapActiveAppointment(active) };
};

const buildDoctorQueuePayload = async (doctorId, selectedQueueKey) => {
  const initial = await buildDoctorQueuePayloadRaw(doctorId, selectedQueueKey);
  return withQueueRevision(initial.queueKey, () => buildDoctorQueuePayloadRaw(doctorId, initial.queueKey));
};

const emitQueueUpdates = async (doctorId, selectedQueueKey) => {
  const rootId = normalizeId(doctorId);
  const allIds = await getLinkedDoctorIds(rootId);

  // FIXED: Only the requested doctor's cache was cleared, so a hospital-staff doctor and the
  // linked platform doctor kept serving stale queues to each other for up to 20 seconds.
  const cacheKeys = (allIds.length ? allIds : [rootId]).map(queueCacheKey);
  await getRedis().del(...cacheKeys);

  const io = getIO();
  if (!io) return;

  const payload = await buildDoctorQueuePayload(rootId, selectedQueueKey);
  allIds.forEach(id => {
    io.to(`doctor:${id}`).emit("appointment:queue-updated", payload);
  });

  payload.queue.forEach((appointment, index) => {
    if (!appointment.user?._id) return;
    io.to(`user:${appointment.user._id}`).emit("appointment:user-status", {
      doctorId: rootId,

      pendingCount: payload.pendingCount,
      appointmentId: appointment._id,
      status: "queued",
      queuePosition: index + 1,
    });
  });

  if (payload.activeAppointment?.user?._id) {
    io.to(`user:${payload.activeAppointment.user._id}`).emit(
      "appointment:user-status",
      {
        doctorId: rootId,
        pendingCount: payload.pendingCount,
        appointmentId: payload.activeAppointment._id,

        status: "active",
        queuePosition: 0,
        startedAt: payload.activeAppointment.startedAt,
        endsAt: payload.activeAppointment.endsAt,
      },
    );
  }
};

const finishAppointment = async (appointmentId, endedBy, endedReason, roughNotes = null, expectedRevision) => {
  const appointment = await Appointment.findById(appointmentId).populate("user").populate("doctor", "firstName lastName email experience clinic");
  if (!appointment || appointment.status !== "active") {
    return null;
  }

  // Commit the shared clinical transition before optional AI/receipt generation.
  const changed = await transitionVisit({ appointmentId, action: "complete", expectedRevision, appointmentFields: { endedBy, endedReason } });
  if (roughNotes) await Appointment.updateOne({ _id: appointmentId, status: "completed" }, { $set: { doctorNotes: String(roughNotes) } });
  Object.assign(appointment, { status: changed.appointment.status, endedAt: changed.appointment.endedAt, endedBy, endedReason });
  await afterVisitCommit(async () => {
  // Auto-generate SOAP note
  try {
    let soapNote;
    if (roughNotes) {
      const generatedNote = await generateSoapNoteGemini(roughNotes);
      // Ensure we parse it to object if generatedNote is a markdown/string representation, or just store the raw markdown. 
      // The instruction says "return only the structured SOAP note in Markdown format without any extra explanation or text".
      // So we can store it as { markdown: generatedNote } or just as the root string if schema allows.
      soapNote = {
        markdown: generatedNote,
        generatedAt: new Date(),
        generatedBy: "ai-copilot",
      };
    } else {
      const redis = getRedis();
      const transcriptKey = `copilot:transcript:${appointmentId}`;
      const suggestionsKey = `copilot:suggestions:${appointmentId}`;
      
      const [transcript, storedSuggestionsRaw] = await Promise.all([
        redis.get(transcriptKey),
        redis.get(suggestionsKey),
      ]);
      
      const storedSuggestions = storedSuggestionsRaw ? JSON.parse(storedSuggestionsRaw) : [];
      
      const generated = await generateSoapNote({
        transcript: transcript || "",
        doctorNotes: appointment.doctorNotes || "",
        
        agentInsights: storedSuggestions.map((suggestion) => suggestion.message),
      });

      soapNote = {
        ...generated,
        generatedAt: new Date(),
        generatedBy: "ai-copilot",
      };
      
      await redis.del(transcriptKey, suggestionsKey);
    }
    appointment.soapNote = soapNote;

    try {
      if (!appointment.receiptText) {
        const receiptText = await generateReceiptText(appointment, roughNotes || "");
        appointment.receiptText = receiptText;
        appointment.receiptGeneratedAt = new Date();
      }
    } catch (receiptError) {
      console.error("Draft receipt generation needs retry");
    }
  } catch (error) {
    console.error("Draft SOAP generation needs retry");
  }

  const draftFields = {};
  if (appointment.soapNote) draftFields.soapNote = appointment.soapNote;
  if (appointment.receiptText) { draftFields.receiptText = appointment.receiptText; draftFields.receiptGeneratedAt = appointment.receiptGeneratedAt; }
  if (Object.keys(draftFields).length) await Appointment.updateOne({ _id: appointmentId, status: "completed", revision: changed.appointment.revision }, { $set: draftFields });
  });

  if (changed.token) await afterVisitCommit(() => clearLinkedOpdCache(changed.token), () => emitOpdEvent(getIO(), "opd:consultation-completed", changed.token));
  await afterVisitCommit(() => emitQueueUpdates(normalizeId(appointment.doctor), appointment.queueKey));

  const io = getIO();
  if (io) {
    const endedPayload = {
      appointmentId: appointment._id,
      endedAt: appointment.endedAt,
      endedBy,
      endedReason,
    };
    io.to(`appointment:${appointmentId}`).emit("appointment:ended", endedPayload);
    const allDocIds = await getLinkedDoctorIds(appointment.doctor);
    allDocIds.forEach(id => {
      io.to(`doctor:${id}`).emit("appointment:ended", endedPayload);
    });
    io.to(`user:${(appointment.user._id || appointment.user).toString()}`).emit("appointment:ended", endedPayload);
  }

  await afterVisitCommit(() => publishEvent("appointment.completed", {
    appointmentId: appointment._id.toString(),
    doctorId: normalizeId(appointment.doctor),
    userId: (appointment.user._id || appointment.user).toString(),
    endedBy,
    endedReason,
  }));

  return appointment;
};

const buildReceiptPrompt = (appointment, notes) => {
  const doctorName = [appointment.doctor?.firstName, appointment.doctor?.lastName]
    .filter(Boolean)
    .join(" ");
  const patientName = [appointment.user?.firstName, appointment.user?.lastName]
    .filter(Boolean)
    .join(" ");

  return `Create a concise medical receipt for a completed telehealth appointment.
Return plain text only with these sections:
Receipt Title
Patient Name
Doctor Name
Appointment Date
Visit Summary
Doctor Notes
Advice
Follow Up

Rules:
- Keep it professional, short, and easy to download as a text receipt.
- Do not invent symptoms, medicines, or diagnoses.
- Use the doctor notes below as the only clinical details.
- If a section has no information, write "Not provided".

Patient Name: ${patientName || "Not provided"}
Doctor Name: ${doctorName || "Not provided"}
Appointment Date: ${appointment.startedAt ? appointment.startedAt.toISOString() : appointment.createdAt.toISOString()}
Doctor Notes: ${notes || appointment.doctorNotes || "Not provided"}`;
};

// FIXED: When Gemini returned 429 (free-tier quota exhausted) this rejection was unhandled and
// took the whole Node process down. Receipts are non-critical, so fall back to a plain-text
// receipt built from data we already have instead of failing the request.
const buildFallbackReceiptText = (appointment, notes) => {
  const doctorName = [appointment.doctor?.firstName, appointment.doctor?.lastName]
    .filter(Boolean)
    .join(" ");
  const patientName = [appointment.user?.firstName, appointment.user?.lastName]
    .filter(Boolean)
    .join(" ");
  const appointmentDate = appointment.startedAt || appointment.createdAt || new Date();

  return `MediPulse Consultation Receipt
Patient Name: ${patientName || "Not provided"}
Doctor Name: ${doctorName || "Not provided"}
Appointment Date: ${new Date(appointmentDate).toLocaleString()}
Visit Summary: ${appointment.patientBrief?.agentSummary || "Not provided"}
Doctor Notes: ${notes || appointment.doctorNotes || "Not provided"}
Advice: Please follow the doctor notes above.
Follow Up: Not provided`;
};

const generateReceiptText = async (appointment, notes) => {
  const prompt = buildReceiptPrompt(appointment, notes);
  try {
    const text = await generateGeminiText(prompt, "general");
    if (text?.trim()) return text;
  } catch (error) {
    console.error("Receipt AI generation failed, using fallback receipt:", error.message);
  }
  return buildFallbackReceiptText(appointment, notes);
};

const queuePositionForAppointment = async appointment => (await appointmentPosition(appointment)) ?? 0;

const clearLinkedOpdCache = (token) => invalidateVisitQueue(token, getRedis());

const sendAppointmentOtp = async (req, res) => {
  const { doctorId } = req.params;
  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only users can book appointments" });
  }

  const bookable = await ensureBookableAppointment(doctorId, req.auth.id, req.body.familyMemberId, req.body.sessionId);
  if (bookable.status) {
    return res.status(bookable.status).json(bookable);
  }

  const user = await User.findById(req.auth.id);
  const otp = generateOtp();

  try {
    await resolveBookingIdentity(req, undefined, req.body.familyMemberId);
    if (!mailConfigured()) throw new Error("Mail unavailable");
    await queueBookingOtp({ userId: req.auth.id, doctorId, familyMemberId: req.body.familyMemberId, to: user.email,
      patientName: buildPersonName(user, "Patient"), doctorName: buildPersonName(bookable.doctor, "Doctor"), otp });
  } catch (error) {
    return res.status(error.status || 503).json({ message: error.status ? error.message : "OTP delivery could not be queued. Please try again later." });
  }

  return res.status(200).json({
    message: "OTP email queued", deliveryStatus: "queued",
    email: user.email,
    expiresInSeconds: OTP_EXPIRY_MS / 1000,
  });
};

const verifyAppointmentOtp = async (req, res) => {
  const { doctorId } = req.params;
  const { otp, familyMemberId } = req.body;

  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only users can verify booking OTP" });
  }

  try { await resolveBookingIdentity(req, undefined, familyMemberId); }
  catch (error) { return res.status(error.status || 400).json({ message: error.message }); }

  if (!otp || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: "Valid 6 digit OTP is required" });
  }

  const bookingToken = await verifyBookingOtp({ userId: req.auth.id, doctorId, familyMemberId, otp });

  return res.status(200).json({
    message: "OTP verified",
    bookingToken,
    expiresInSeconds: BOOKING_TOKEN_EXPIRY_MS / 1000,
  });
};


const refundAppointmentPayment = async (req, res) => {
  const { appointmentId } = req.params;

  if (!["doctor", "user"].includes(req.auth.role)) {
    return res.status(403).json({ message: "Unauthorized refund request" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  const allIds = await getLinkedDoctorIds(req.auth.id);
  const isDoctor =
    req.auth.role === "doctor" && allIds.includes(normalizeId(appointment.doctor));
  const isUser =
    req.auth.role === "user" && (appointment.user._id || appointment.user).toString() === req.auth.id.toString();
  if (!isDoctor && !isUser) {
    return res.status(403).json({ message: "You cannot refund this appointment" });
  }

  if (appointment.status === "active" || appointment.status === "completed") {
    return res
      .status(409)
      .json({ message: "Cannot refund an active or completed appointment" });
  }

  // Validate a payment reference before entering the atomic cancellation service.
  const originalTransactionId =
    appointment.payment?.paymentId || appointment.payment?.orderId;
  if (!originalTransactionId) {
    return res.status(409).json({ message: "No payment found for this appointment" });
  }
  try {
    const changed = await refundAppointment({ appointmentId, expectedRevision: req.body.revision });
    if (changed.token) await afterVisitCommit(() => clearLinkedOpdCache(changed.token), () => emitOpdEvent(getIO(), "opd:no-show", changed.token));
    await afterVisitCommit(() => emitQueueUpdates(normalizeId(appointment.doctor), appointment.queueKey));

    await afterVisitCommit(() => publishEvent("appointment.refunded", {
      userId: normalizeId(appointment.user), doctorId: normalizeId(appointment.doctor), appointmentId: normalizeId(appointment), amount: appointment.payment.amount,
    }));

    return res.status(200).json({ message: changed.replay ? "Demo refund replayed" : "Demo refund completed", replay: changed.replay, compensationStatus: "completed" });
  } catch (error) {
    return res.status(error.status || 409).json({ message: error.status ? error.message : "Refund state needs reconciliation; do not submit another refund" });
  }
};

export const processDueConsultationDeadlines = async (now = new Date()) => {
  const rows = await Appointment.find({ status: "active", visitMode: "online", consultationDeadline: { $lte: now, $ne: null } }).limit(25);
  for (const row of rows) {
    try { await finishAppointment(String(row._id), "system", "auto-timeout", null, row.revision); }
    catch { console.error("Consultation deadline transition needs retry"); }
  }
  return rows.length;
};
export const processDueAutoRefunds = async (now = new Date()) => {
  const rows = await Appointment.find({ status: { $in: ["queued", "refund_pending"] }, visitMode: "online", refundDueAt: { $lte: now, $ne: null }, "payment.paidAt": { $ne: null } }).limit(25);
  for (const row of rows) {
    try { const changed = await refundAppointment({ appointmentId: row._id });
      if (changed.token) await afterVisitCommit(() => clearLinkedOpdCache(changed.token));
      await afterVisitCommit(() => emitQueueUpdates(normalizeId(row.doctor), row.queueKey));
    } catch { console.error("Persisted automatic refund needs retry"); }
  }
  return rows.length;
};
const startAutoRefundWorker = () => {
  let running = false;
  const tick = async () => { if (running) return; running = true;
    try { await processDueConsultationDeadlines(); await processDueAutoRefunds(); }
    catch { console.error("Visit deadline worker needs retry"); } finally { running = false; } };
  const interval = setInterval(tick, Number(process.env.AUTO_REFUND_WORKER_INTERVAL_MS || 60000)); interval.unref?.(); void tick();
  return () => clearInterval(interval);
};

const bookAppointment = async (req, res) => {
  const { doctorId } = req.params;
  const { bookingToken } = req.body;
  if (req.auth.role !== "user") throw accessError(403, "Only users can book appointments");
  if (!mongoose.Types.ObjectId.isValid(doctorId)) throw accessError(400, "Invalid doctor id");
  const doctor = await Doctor.findById(doctorId);
  if (!doctor) {
    if (await HospitalStaff.exists({ _id: doctorId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" })) throw accessError(409, "Book this doctor through the hospital OPD to select the correct care context");
    throw accessError(404, "Doctor not found");
  }
  const context = queueContext({ doctorId, doctor, sessionId: req.body.sessionId, serviceDate: req.body.serviceDate });
  const person = patientKey(req.auth.id, req.body.familyMemberId);
  const request = bookingRequest(req, "appointment", context, person, { doctorId, familyMemberId: req.body.familyMemberId,
    bookingToken, sessionId: context.sessionId, serviceDate: req.body.serviceDate || null });
  let result = await findBookingReplay(request);
  if (!result) {
    let tokenData;
    if (REQUIRE_BOOKING_OTP || bookingToken) {
      if (!bookingToken) throw accessError(401, "Booking token is required. Verify the OTP first");
      tokenData = await readBookingProof(bookingToken);
      if (!tokenData) throw accessError(401, "Booking token expired. Verify OTP again");
      if (normalizeId(tokenData.userId) !== req.auth.id.toString() || normalizeId(tokenData.doctorId) !== doctorId) throw accessError(403, "Invalid booking token");
      if (normalizeId(tokenData.familyMemberId) !== normalizeId(req.body.familyMemberId)) throw accessError(403, "Booking token patient mismatch");
    }
    const family = tokenData?.familyMemberId || req.body.familyMemberId;
    await resolveBookingIdentity(req, undefined, family);
    const fee = resolveConsultationFee(doctor);
    result = await createQueueBooking({ request, context, bookingProofId: bookingToken ? proofId(bookingToken) : undefined, personKey: patientKey(req.auth.id, family), fee, payerId: req.auth.id, receiverId: doctorId,
      appointmentData: { doctor: doctorId, user: req.auth.id, familyMemberId: family, visitMode: "online", roomId: `appointment-${new mongoose.Types.ObjectId()}` } });
  }
  if (result.operation.state !== "completed") return res.status(202).json({ status: "processing", operationId: result.operation._id, message: result.operation.state === "review_required" ? "Booking requires reviewed recovery; do not make another payment" : "Booking is processing; retry with the same request key" });
  const appointment = result.appointment;
  if (!result.replay) await afterVisitCommit(
    () => emitQueueUpdates(doctorId, appointment.queueKey),
    () => publishEvent("appointment.booked", { appointmentId: normalizeId(appointment), doctorId, userId: req.auth.id,
      orderId: result.operation.paymentId, paymentId: result.operation.paymentId, amount: result.operation.fee }));
  return res.status(result.replay ? 200 : 201).json({ message: "Demo appointment booked", appointmentId: appointment._id,
    status: appointment.status,
    ...explicitPractice(appointment), practiceKey: appointment.practiceKey, queueKey: appointment.queueKey, serviceDate: appointment.serviceDate, sessionId: appointment.sessionId, visitMode: appointment.visitMode, revision: appointment.revision,
  appointmentType: appointment.appointmentType || (appointment.visitMode === "in_person" ? "hospital_in_person" : "online_opd"), scheduleReservationId: appointment.scheduleReservationId, scheduledStart: appointment.scheduledStart, scheduledEnd: appointment.scheduledEnd, admissionState: appointment.admissionState, checkedInAt: appointment.checkedInAt, feeSnapshot: appointment.feeSnapshot,
    queuePosition: await queuePositionForAppointment(appointment), amountPaid: result.operation.fee, replay: result.replay });
};

const getDoctorQueue = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res
      .status(403)
      .json({ message: "Only doctors can access full appointment queue" });
  }

  const payload = await buildDoctorQueuePayload(req.auth.id, req.query.queueKey);
  return res.status(200).json(payload);
};

const getDoctorPendingStatus = async (req, res) => {
  const { doctorId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(doctorId)) {
    return res.status(400).json({ message: "Invalid doctor id" });
  }

  const [platformDoctor, hospitalDoctor] = await Promise.all([
    Doctor.findById(doctorId),
    HospitalStaff.findOne({ _id: doctorId, role: "DOCTOR", isActive: true, inviteStatus: "accepted" })
  ]);
  const doctor = platformDoctor || hospitalDoctor;

  if (!doctor) {
    return res.status(404).json({ message: "Doctor not found" });
  }

  const context = queueContext({ doctorId, doctor, sessionId: req.query.sessionId });
  const snapshotRevision = await readQueueRevision(context.queueKey);
  const pendingCount = await Appointment.countDocuments({ queueKey: context.queueKey, status: "queued", admissionState: { $ne: "reserved" } });
  const response = {
    doctorId,
    pendingCount,
    myAppointment: null,
  };

  if (req.auth.role === "user") {
    const myAppointment = await Appointment.findOne({ queueKey: context.queueKey, user: req.auth.id,
      familyMemberId: req.query.familyMemberId || null, status: { $in: ["queued", "active", "booking", "refund_pending"] } }).sort({ createdAt: 1 });
    if (myAppointment) {
      const queuePosition = await queuePositionForAppointment(myAppointment);
      response.myAppointment = {
        _id: myAppointment._id, visitMode: myAppointment.visitMode, queueKey: myAppointment.queueKey, revision: myAppointment.revision,
        status: myAppointment.status,
        createdAt: myAppointment.createdAt,
        queuePosition,
        startedAt: myAppointment.startedAt,
        endsAt: myAppointment.startedAt
          ? myAppointment.consultationDeadline || null
          : null,
        patientBrief: myAppointment.patientBrief || null,
      };
    }
  }

  if (await readQueueRevision(context.queueKey) !== snapshotRevision) throw accessError(409, "Queue changed; refresh status");
  return res.status(200).json({ ...response, queueKey: context.queueKey, queueRevision: snapshotRevision });
};

const getUserAppointmentHistory = async (req, res) => {
  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only users can view appointment history" });
  }

  const { doctorId } = req.query;
  const query = { user: req.auth.id };
  if (doctorId) {
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({ message: "Invalid doctor id" });
    }
    query.doctor = { $in: await getLinkedDoctorIds(doctorId) };
  }

  const appointmentsRaw = await Appointment.find(query)
    .sort({ createdAt: -1 })
    .populate("user", "firstName lastName email ")
    .lean();
  
  const appointments = await populateDoctorForAppointments(appointmentsRaw);

  return res.status(200).json({
    appointments: appointments.map(mapHistoryAppointment),
  });
};

const updateDoctorNotes = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res.status(403).json({ message: "Only doctors can add notes" });
  }

  const { appointmentId } = req.params;
  const { doctorNotes = "" } = req.body;

  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  const allIds = await getLinkedDoctorIds(req.auth.id);
  if (!allIds.includes(normalizeId(appointment.doctor))) {
    return res.status(403).json({ message: "You cannot update this appointment" });
  }

  appointment.doctorNotes = doctorNotes.trim();
  await appointment.save();

  return res.status(200).json({
    message: "Doctor notes saved",
    appointmentId: appointment._id,
    doctorNotes: appointment.doctorNotes,
  });
};

const generateAppointmentReceipt = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res.status(403).json({ message: "Only doctors can generate receipts" });
  }

  const { appointmentId } = req.params;
  const {
    doctorNotes = "",
    voiceConsentRecorded = false,
    voiceConsentKeywords = [],
    voiceConsentTimestamp = null,
  } = req.body;

  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointmentRaw = await Appointment.findById(appointmentId)
    .populate("user", "firstName lastName email");
  
  const [appointment] = await populateDoctorForAppointments(appointmentRaw ? [appointmentRaw] : []);

  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  const allIds = await getLinkedDoctorIds(req.auth.id);
  if (!allIds.includes(appointment.doctor._id.toString())) {
    return res.status(403).json({ message: "You cannot generate receipt for this appointment" });
  }

  const notesToUse = doctorNotes.trim() || appointment.doctorNotes || "";
  const receiptText = await generateReceiptText(appointment, notesToUse);

  appointment.doctorNotes = notesToUse;
  appointment.receiptText = receiptText;
  appointment.receiptGeneratedAt = new Date();
  appointment.voiceConsentRecorded = Boolean(voiceConsentRecorded);
  appointment.voiceConsentKeywords = Array.isArray(voiceConsentKeywords)
    ? voiceConsentKeywords.slice(0, 20)
    : [];
  appointment.voiceConsentTimestamp = voiceConsentTimestamp
    ? new Date(voiceConsentTimestamp)
    : undefined;
  await appointment.save();

  return res.status(200).json({
    message: "Receipt generated successfully",
    appointmentId: appointment._id,
    receiptText,
    receiptGeneratedAt: appointment.receiptGeneratedAt,
    doctorNotes: appointment.doctorNotes,
    voiceConsentRecorded: appointment.voiceConsentRecorded,
  });
};

const getAppointmentById = async (req, res) => {
  const { appointmentId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointmentRaw = await Appointment.findById(appointmentId)
    .populate("user", "firstName lastName email")
    .lean();
  
  const [appointment] = await populateDoctorForAppointments(appointmentRaw ? [appointmentRaw] : []);

  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  const doctorAccess =
    req.auth.role === "doctor" &&
    (await getLinkedDoctorIds(req.auth.id)).includes(appointment.doctor?._id?.toString());
  const userAccess =
    req.auth.role === "user" &&
    appointment.user?._id?.toString() === req.auth.id.toString();

  if (!doctorAccess && !userAccess) {
    return res.status(403).json({ message: "You cannot access this appointment" });
  }

  return res.status(200).json({
    _id: appointment._id,
    status: appointment.status,
  ...explicitPractice(appointment), practiceKey: appointment.practiceKey, queueKey: appointment.queueKey, serviceDate: appointment.serviceDate, sessionId: appointment.sessionId, visitMode: appointment.visitMode, revision: appointment.revision,
  appointmentType: appointment.appointmentType || (appointment.visitMode === "in_person" ? "hospital_in_person" : "online_opd"), scheduleReservationId: appointment.scheduleReservationId, scheduledStart: appointment.scheduledStart, scheduledEnd: appointment.scheduledEnd, admissionState: appointment.admissionState, checkedInAt: appointment.checkedInAt, feeSnapshot: appointment.feeSnapshot,
    roomId: appointment.roomId,
    createdAt: appointment.createdAt,
    startedAt: appointment.startedAt,
    endedAt: appointment.endedAt,
    endedBy: appointment.endedBy,
    endedReason: appointment.endedReason,
    doctorNotes: appointment.doctorNotes || "",
    receiptText: appointment.receiptText || "",
    receiptGeneratedAt: appointment.receiptGeneratedAt || null,
    endsAt: appointment.startedAt
      ? (appointment.visitMode === "in_person" ? null : appointment.consultationDeadline || null)
      : null,
    doctor: appointment.doctor,
    user: appointment.user,
  });
};

const startAppointment = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res.status(403).json({ message: "Only doctors can start appointments" });
  }

  const { appointmentId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  const allIds = await getLinkedDoctorIds(req.auth.id);
  if (!allIds.includes(normalizeId(appointment.doctor))) {
    return res.status(403).json({ message: "You cannot start this appointment" });
  }

  const changed = await transitionVisit({ appointmentId, action: "start", expectedRevision: req.body.revision });
  Object.assign(appointment, { status: changed.appointment.status, startedAt: changed.appointment.startedAt, consultationDeadline: changed.appointment.consultationDeadline, revision: changed.appointment.revision });
  if (changed.token) await afterVisitCommit(() => clearLinkedOpdCache(changed.token), () => emitOpdEvent(getIO(), "opd:consultation-started", changed.token));
  await afterVisitCommit(() => getRedis().zrem(autoRefundSetKey, appointment._id.toString()),
    () => emitQueueUpdates(req.auth.id.toString(), appointment.queueKey),
    () => publishEvent("appointment.started", { appointmentId: normalizeId(appointment), doctorId: normalizeId(appointment.doctor), userId: normalizeId(appointment.user) }));

  const io = getIO();
  if (io) {
    const payload = {
      appointmentId: appointment._id,
      doctorId: normalizeId(appointment.doctor),
      userId: (appointment.user._id || appointment.user).toString(),
      status: appointment.status,
  ...explicitPractice(appointment), practiceKey: appointment.practiceKey, queueKey: appointment.queueKey, serviceDate: appointment.serviceDate, sessionId: appointment.sessionId, visitMode: appointment.visitMode, revision: appointment.revision,
  appointmentType: appointment.appointmentType || (appointment.visitMode === "in_person" ? "hospital_in_person" : "online_opd"), scheduleReservationId: appointment.scheduleReservationId, scheduledStart: appointment.scheduledStart, scheduledEnd: appointment.scheduledEnd, admissionState: appointment.admissionState, checkedInAt: appointment.checkedInAt, feeSnapshot: appointment.feeSnapshot,
      startedAt: appointment.startedAt,
      endsAt: (appointment.visitMode === "in_person" ? null : appointment.consultationDeadline || null),
    };
    io.to(`appointment:${appointmentId}`).emit("appointment:started", payload);
    const allDocIds = await getLinkedDoctorIds(appointment.doctor);
    allDocIds.forEach(id => {
      io.to(`doctor:${id}`).emit("appointment:started", payload);
    });
    // FIXED: The doctor was receiving the patient-facing "join meeting" notification after starting the appointment.
    io.to(`user:${(appointment.user._id || appointment.user).toString()}`).emit("appointment:started", payload);
  }

  return res.status(200).json({
    message: "Appointment started",
    appointmentId: appointment._id,
    status: appointment.status,
  ...explicitPractice(appointment), practiceKey: appointment.practiceKey, queueKey: appointment.queueKey, serviceDate: appointment.serviceDate, sessionId: appointment.sessionId, visitMode: appointment.visitMode, revision: appointment.revision,
  appointmentType: appointment.appointmentType || (appointment.visitMode === "in_person" ? "hospital_in_person" : "online_opd"), scheduleReservationId: appointment.scheduleReservationId, scheduledStart: appointment.scheduledStart, scheduledEnd: appointment.scheduledEnd, admissionState: appointment.admissionState, checkedInAt: appointment.checkedInAt, feeSnapshot: appointment.feeSnapshot,
    startedAt: appointment.startedAt,
    endsAt: (appointment.visitMode === "in_person" ? null : appointment.consultationDeadline || null),
  });
};

const endAppointment = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res.status(403).json({ message: "Only doctors can end appointments" });
  }

  const { appointmentId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }
  const allIds = await getLinkedDoctorIds(req.auth.id);
  if (!allIds.includes(normalizeId(appointment.doctor))) {
    return res.status(403).json({ message: "You cannot end this appointment" });
  }
  if (appointment.status !== "active") {
    return res.status(409).json({ message: "Appointment is not active" });
  }

  if (req.body.revision !== undefined && req.body.revision !== appointment.revision) throw accessError(409, "Visit changed; refresh before retrying");
  const { roughNotes } = req.body;

  const completed = await finishAppointment(
    appointmentId.toString(),
    "doctor",
    "doctor-ended",
    roughNotes, req.body.revision
  );
  if (!completed) {
    return res.status(409).json({ message: "Appointment is no longer active" });
  }

  return res.status(200).json({
    message: "Appointment ended",
    appointmentId: completed._id,
    status: completed.status,
    endedAt: completed.endedAt,
    endedBy: completed.endedBy,
    endedReason: completed.endedReason,
  });
};





const askDoctorAppointmentCopilot = async (req, res) => {
  try {
    // FIXED: Any logged-in role could call the co-pilot, and hospital-linked doctor ids were
    // rejected because the owner check compared only the single primary doctor id.
    if (req.auth.role !== "doctor") {
      return res.status(403).json({ message: "Only doctors can use co-pilot" });
    }
    if (!mongoose.Types.ObjectId.isValid(req.params.appointmentId)) {
      return res.status(400).json({ message: "Invalid appointment id" });
    }

    const appointment = await Appointment.findById(req.params.appointmentId);
    if (!appointment) return res.status(404).json({ message: "Appointment not found" });

    const allIds = await getLinkedDoctorIds(req.auth.id);
    if (!allIds.includes(normalizeId(appointment.doctor))) {
      return res.status(403).json({ message: "Only assigned doctor can use co-pilot" });
    }


    const prompt = String(req.body.prompt || "Suggest focused consultation questions").trim();
    const context = {
      patientBrief: appointment.patientBrief,
      status: appointment.status
    };

    let suggestion = "Review the chief complaint, ask red-flag questions, and document follow-up advice.";
    if (process.env.GEMINI_API_KEY) {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");
      const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: "You are a doctor co-pilot. Give concise clinical workflow support. Do not diagnose. Suggest questions, red flags, and documentation points.",
      });
      const result = await model.generateContent("Doctor request: " + prompt + "\nContext: " + JSON.stringify(context));
      suggestion = result.response.text();
    }

    appointment.doctorCopilot = { lastPrompt: prompt, lastSuggestion: suggestion, updatedAt: new Date() };
    await appointment.save();
    res.status(200).json({ suggestion, context });
  } catch (error) {
    res.status(500).json({ message: error.message || "Doctor co-pilot unavailable" });
  }
};
export {
  bookAppointment,
  endAppointment,
  getAppointmentById,
  getDoctorPendingStatus,
  getDoctorQueue,
  getUserAppointmentHistory,
  generateAppointmentReceipt,
  refundAppointmentPayment,
  sendAppointmentOtp,
  startAppointment,
  startAutoRefundWorker,
  updateDoctorNotes, askDoctorAppointmentCopilot,
  verifyAppointmentOtp,

};


