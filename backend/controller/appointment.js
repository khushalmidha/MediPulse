import mongoose from "mongoose";
import crypto from "crypto";
import Appointment from "../model/appointment.js";
import Doctor from "../model/doctor.js";
import OpdToken from "../model/opdToken.js";
import User from "../model/user.js";
import SharedReport from "../model/sharedReport.js";
import HospitalStaff from "../model/hospitalStaff.js";

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
  sendAppointmentOtpMail,
  sendAppointmentRefundMail,
} from "../util/mailer.js";
import {
  autoRefundSetKey,
  bookingTokenKey,
  getRedis,
  otpKey,
  queueCacheKey,
} from "../services/redis.js";
import { publishEvent } from "../services/events.js";
import { refundVirtualPayment, transferVirtualMoney } from "../services/virtualLedger.js";

const APPOINTMENT_DURATION_MS = 5 * 60 * 1000;
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const BOOKING_TOKEN_EXPIRY_MS = 10 * 60 * 1000;
const AUTO_REFUND_DELAY_MS = 30 * 60 * 1000;
const WALLET_APPOINTMENT_FEE_INR = Number(process.env.APPOINTMENT_BOOKING_FEE_INR || 5);
const appointmentTimeouts = new Map();

const hashValue = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

const buildPersonName = (account, fallback) =>
  [account?.firstName, account?.lastName].filter(Boolean).join(" ") || fallback;

const ensureBookableAppointment = async (doctorId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(doctorId)) {
    return { status: 400, message: "Invalid doctor id" };
  }

  const [platformDoctor, hospitalDoctor, existing] = await Promise.all([
    Doctor.findById(doctorId),
    HospitalStaff.findOne({ _id: doctorId, role: "DOCTOR" }),
    Appointment.findOne({
      doctor: doctorId,
      user: userId,
      status: { $in: ["queued", "active"] },
    }),
  ]);

  const doctor = platformDoctor || hospitalDoctor;

  if (!doctor) {
    return { status: 404, message: "Doctor not found" };
  }

  if (existing) {
    const pendingCount = await Appointment.countDocuments({
      doctor: doctorId,
      status: "queued",
    });
    return {
      status: 409,
      message: "You already have a pending appointment for this doctor",
      appointmentId: existing._id,
      appointmentStatus: existing.status,
      pendingCount,
    };
  }

  return { doctor };
};

const mapQueueAppointment = (appointment) => ({
  _id: appointment._id,
  status: appointment.status,
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
        triageProfile: appointment.user.triageProfile,
      }
    : null,
});

const mapHistoryAppointment = (appointment) => ({
  _id: appointment._id,
  doctor: appointment.doctor,
  user: appointment.user,
  status: appointment.status,
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
    ? new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS)
    : null,
});

const mapActiveAppointment = (appointment) => {
  if (!appointment) return null;
  return {
    _id: appointment._id,
    status: appointment.status,
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
      ? new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS)
      : null,
    user: appointment.user
      ? {
          _id: appointment.user._id,
          firstName: appointment.user.firstName,
          lastName: appointment.user.lastName,
          email: appointment.user.email,
          triageProfile: appointment.user.triageProfile,
        }
      : null,
  };
};

const buildDoctorQueuePayload = async (doctorId) => {
  const redis = getRedis();
  const cached = await redis.get(queueCacheKey(doctorId));
  if (cached) {
    return JSON.parse(cached);
  }

  const [queuedAppointments, activeAppointment] = await Promise.all([
    Appointment.find({ doctor: doctorId, status: "queued" })
      .sort({ createdAt: 1 })
      .populate("user", "firstName lastName email triageProfile"),
    Appointment.findOne({ doctor: doctorId, status: "active" })
      .sort({ startedAt: 1 })
      .populate("user", "firstName lastName email triageProfile")
      .lean(),
  ]);

  if (activeAppointment) {
    await populateDoctorForAppointments([activeAppointment]);
  }

  const payload = {
    doctorId,
    pendingCount: queuedAppointments.length,
    queue: queuedAppointments.map(mapQueueAppointment),
    activeAppointment: mapActiveAppointment(activeAppointment),
  };

  await redis.set(queueCacheKey(doctorId), JSON.stringify(payload), "EX", 20);
  return payload;
};

const emitQueueUpdates = async (doctorId) => {
  await getRedis().del(queueCacheKey(doctorId));
  const io = getIO();
  if (!io) return;

  const payload = await buildDoctorQueuePayload(doctorId);
  io.to(`doctor:${doctorId}`).emit("appointment:queue-updated", payload);

  payload.queue.forEach((appointment, index) => {
    io.to(`user:${appointment.user._id}`).emit("appointment:user-status", {
      doctorId,
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
        doctorId,
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

const clearAppointmentTimeout = (appointmentId) => {
  const timer = appointmentTimeouts.get(appointmentId);
  if (!timer) return;
  clearTimeout(timer);
  appointmentTimeouts.delete(appointmentId);
};

const scheduleAppointmentTimeout = (appointmentId) => {
  clearAppointmentTimeout(appointmentId);
  const timer = setTimeout(async () => {
    await finishAppointment(appointmentId, "system", "auto-timeout");
  }, APPOINTMENT_DURATION_MS);
  appointmentTimeouts.set(appointmentId, timer);
};

const finishAppointment = async (appointmentId, endedBy, endedReason, roughNotes = null) => {
  const appointment = await Appointment.findById(appointmentId).populate("user");
  if (!appointment || appointment.status !== "active") {
    clearAppointmentTimeout(appointmentId);
    return null;
  }

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
        patientBrief: appointment.user?.triageProfile || null,
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
  } catch (error) {
    console.error("Auto SOAP generation failed:", error.message);
  }

  appointment.status = "completed";
  appointment.endedAt = new Date();
  appointment.endedBy = endedBy;
  appointment.endedReason = endedReason;
  await appointment.save();
  clearAppointmentTimeout(appointmentId);

  const linkedToken = await OpdToken.findOne({ appointmentId: appointment._id });
  if (linkedToken) {
    // FIXED: Ending a synced hospital OPD appointment from the normal doctor queue did not complete the OPD token.
    linkedToken.status = "completed";
    linkedToken.consultationEndedAt = appointment.endedAt;
    await linkedToken.save();
    await clearLinkedOpdCache(linkedToken);
    const io = getIO();
    if (io) {
      io.to(`hospital:${linkedToken.hospitalId.toString()}`).emit("opd:consultation-completed", { token: linkedToken });
      io.to(`doctor:${linkedToken.doctorId.toString()}`).emit("opd:consultation-completed", { token: linkedToken });
    }
  }

  await emitQueueUpdates(appointment.doctor.toString());

  const io = getIO();
  if (io) {
    const endedPayload = {
      appointmentId: appointment._id,
      endedAt: appointment.endedAt,
      endedBy,
      endedReason,
    };
    io.to(`appointment:${appointmentId}`).emit("appointment:ended", endedPayload);
    io.to(`doctor:${appointment.doctor.toString()}`).emit(
      "appointment:ended",
      endedPayload,
    );
    io.to(`user:${appointment.user.toString()}`).emit("appointment:ended", endedPayload);
  }

  await publishEvent("appointment.completed", {
    appointmentId: appointment._id.toString(),
    doctorId: appointment.doctor.toString(),
    userId: appointment.user.toString(),
    endedBy,
    endedReason,
  });

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

const generateReceiptText = async (appointment, notes) => {
  const prompt = buildReceiptPrompt(appointment, notes);
  return generateGeminiText(prompt, "general");
};

const createQueuedAppointmentFromDemoBooking = async ({
  doctorId,
  userId,
  bookingToken,
}) => {
  const tokenDataRaw = await getRedis().get(bookingTokenKey(bookingToken));
  if (!tokenDataRaw) {
    return { status: 401, message: "Booking token expired. Verify OTP again" };
  }

  const tokenData = JSON.parse(tokenDataRaw);
  if (tokenData.userId !== userId || tokenData.doctorId !== doctorId) {
    return { status: 403, message: "Invalid booking token" };
  }

  const bookable = await ensureBookableAppointment(doctorId, userId);
  if (bookable.status) {
    return bookable;
  }

  const transaction = await transferVirtualMoney({
    senderId: userId,
    senderRole: "user",
    receiverId: doctorId,
    receiverRole: "doctor",
    amount: WALLET_APPOINTMENT_FEE_INR,
    type: "PAYMENT",
    description: "Appointment booking fee",
    referenceId: `APPOINTMENT-${hashValue(bookingToken)}`,
    metadata: {
      doctorId,
      userId,
      source: "appointment-booking",
    },
  });

  const appointment = await Appointment.create({
    doctor: doctorId,
    user: userId,
    familyMemberId: tokenData.familyMemberId,
    roomId: `appointment-${new mongoose.Types.ObjectId().toString()}`,
    status: "queued",
    payment: {
      provider: "wallet",
      orderId: transaction.transactionId,
      paymentId: transaction.transactionId,
      amount: WALLET_APPOINTMENT_FEE_INR,
      currency: "INR",
      paidAt: new Date(),
    },
  });

  const autoRefundDueAt = new Date(Date.now() + AUTO_REFUND_DELAY_MS);
  await getRedis().zadd(autoRefundSetKey, autoRefundDueAt.getTime(), appointment._id.toString());
  await getRedis().del(bookingTokenKey(bookingToken));
  await emitQueueUpdates(doctorId);

  const user = await User.findById(userId);
  try {
    await sendAppointmentBookedMail({
      to: user.email,
      doctorName: buildPersonName(bookable.doctor, "Doctor"),
      patientName: buildPersonName(user, "Patient"),
      appointmentId: appointment._id.toString(),
    });
  } catch (error) {
    console.error("Appointment booking email failed:", error.message);
  }

  await publishEvent("appointment.booked", {
    appointmentId: appointment._id.toString(),
    orderId: transaction.transactionId,
    paymentId: transaction.transactionId,
    doctorId,
    userId,
    amount: WALLET_APPOINTMENT_FEE_INR,
  });

  const queuePosition =
    appointment.status === "queued" ? await queuePositionForAppointment(appointment) : 0;

  return { appointment, queuePosition };
};

const queuePositionForAppointment = async (appointment) =>
  (await Appointment.countDocuments({
    doctor: appointment.doctor,
    status: "queued",
    createdAt: { $lte: appointment.createdAt },
  })) || 1;

const clearLinkedOpdCache = async (token) => {
  if (!token) return;
  const date = (token.date || new Date()).toISOString().slice(0, 10);
  await getRedis().del(
    `opd:queue:${token.doctorId.toString()}:${date}`,
    `hospital:queue-status:${token.hospitalId.toString()}`,
  );
};

const sendAppointmentOtp = async (req, res) => {
  const { doctorId } = req.params;
  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only users can book appointments" });
  }

  const bookable = await ensureBookableAppointment(doctorId, req.auth.id);
  if (bookable.status) {
    return res.status(bookable.status).json(bookable);
  }

  const user = await User.findById(req.auth.id);
  const otp = generateOtp();

  try {
    await getRedis().set(
      otpKey(req.auth.id, doctorId),
      JSON.stringify({
        otpHash: hashValue(otp),
        attempts: 0,
        createdAt: new Date().toISOString(),
      }),
      "PX",
      OTP_EXPIRY_MS,
    );
  } catch (error) {
    console.error("Appointment OTP Redis write failed:", {
      message: error.message,
      code: error.code,
      name: error.name,
    });
    return res.status(503).json({
      message: `Redis OTP storage failed: ${error.message || "Check REDIS_URL"}`,
    });
  }

  try {
    await sendAppointmentOtpMail({
      to: user.email,
      patientName: buildPersonName(user, "Patient"),
      doctorName: `Dr. ${buildPersonName(bookable.doctor, "Doctor")}`,
      otp,
    });
  } catch (error) {
    console.error("Appointment OTP email failed:", {
      message: error.message,
      code: error.code,
      command: error.command,
      responseCode: error.responseCode,
    });
    return res.status(503).json({
      message: `SMTP OTP email failed: ${error.message || "Check SMTP configuration"}`,
    });
  }

  await publishEvent("appointment.otp_sent", {
    doctorId,
    userId: req.auth.id,
  });

  return res.status(200).json({
    message: "OTP sent to your registered email",
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

  if (!otp || !/^\d{6}$/.test(otp)) {
    return res.status(400).json({ message: "Valid 6 digit OTP is required" });
  }

  const key = otpKey(req.auth.id, doctorId);
  const redis = getRedis();
  const storedOtp = await redis.get(key);
  if (!storedOtp) {
    return res.status(410).json({ message: "OTP expired. Please request a new OTP" });
  }

  const otpState = JSON.parse(storedOtp);
  if (otpState.attempts >= 5) {
    await redis.del(key);
    return res.status(429).json({ message: "Too many wrong OTP attempts" });
  }

  if (otpState.otpHash !== hashValue(otp)) {
    otpState.attempts += 1;
    await redis.set(key, JSON.stringify(otpState), "PX", OTP_EXPIRY_MS);
    return res.status(401).json({ message: "Incorrect OTP" });
  }

  const bookingToken = crypto.randomBytes(32).toString("hex");
  await redis
    .multi()
    .del(key)
    .set(
      bookingTokenKey(bookingToken),
      JSON.stringify({ doctorId, userId: req.auth.id, familyMemberId }),
      "PX",
      BOOKING_TOKEN_EXPIRY_MS,
    )
    .exec();

  await publishEvent("appointment.otp_verified", {
    doctorId,
    userId: req.auth.id,
  });

  return res.status(200).json({
    message: "OTP verified",
    bookingToken,
    expiresInSeconds: BOOKING_TOKEN_EXPIRY_MS / 1000,
  });
};


const refundAppointmentPayment = async (req, res) => {
  const { appointmentId } = req.params;
  const { reason = "manual-refund" } = req.body;

  if (!["doctor", "user"].includes(req.auth.role)) {
    return res.status(403).json({ message: "Unauthorized refund request" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  const isDoctor =
    req.auth.role === "doctor" && appointment.doctor.toString() === req.auth.id.toString();
  const isUser =
    req.auth.role === "user" && appointment.user.toString() === req.auth.id.toString();
  if (!isDoctor && !isUser) {
    return res.status(403).json({ message: "You cannot refund this appointment" });
  }

  if (appointment.status === "active" || appointment.status === "completed") {
    return res
      .status(409)
      .json({ message: "Cannot refund an active or completed appointment" });
  }

  try {
    const refund = await refundVirtualPayment({
      actorId: appointment.doctor.toString(),
      actorRole: "doctor",
      originalTransactionId: appointment.payment.paymentId || appointment.payment.orderId,
      amount: appointment.payment.amount || WALLET_APPOINTMENT_FEE_INR,
      reason,
      isAdmin: false,
      idempotencyKey: `appointment-manual-refund-${appointment._id.toString()}`,
    });

    appointment.status = "cancelled";
    appointment.endedAt = new Date();
    appointment.endedBy = "system";
    appointment.endedReason = "refunded";
    appointment.payment.refundId = refund.refund?.refundId || refund.refundTxn?.transactionId;
    appointment.payment.refundedAt = new Date();
    await appointment.save();
    await emitQueueUpdates(appointment.doctor.toString());

    const populated = await Appointment.findById(appointment._id)
      .populate("user", "firstName lastName email triageProfile")
      .lean();
    await populateDoctorForAppointments([populated]);

    try {
      await sendAppointmentRefundMail({
        to: populated.user.email,
        patientName: buildPersonName(populated.user, "Patient"),
        doctorName: buildPersonName(populated.doctor, "Doctor"),
        appointmentId: populated._id.toString(),
        amount: appointment.payment.amount || WALLET_APPOINTMENT_FEE_INR,
      });
    } catch (error) {
      console.error("Appointment manual refund email failed:", error.message);
    }

    return res.status(200).json({ message: "Refund processed successfully" });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Refund failed" });
  }
};

const processDueAutoRefunds = async () => {
  const redis = getRedis();
  const dueAppointmentIds = await redis.zrangebyscore(
    autoRefundSetKey,
    0,
    Date.now(),
    "LIMIT",
    0,
    25,
  );

  for (const appointmentId of dueAppointmentIds) {
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      await redis.zrem(autoRefundSetKey, appointmentId);
      continue;
    }

    const shouldRefund = appointment.status === "queued" && !appointment.startedAt;

    if (!shouldRefund) {
      await redis.zrem(autoRefundSetKey, appointmentId);
      continue;
    }

    try {
      const refund = await refundVirtualPayment({
        actorId: appointment.doctor.toString(),
        actorRole: "doctor",
        originalTransactionId: appointment.payment?.paymentId || appointment.payment?.orderId,
        amount: appointment.payment?.amount || WALLET_APPOINTMENT_FEE_INR,
        reason: "doctor-not-started-within-30-minutes",
        isAdmin: false,
        idempotencyKey: `appointment-auto-refund-${appointment._id.toString()}`,
      });

      appointment.status = "cancelled";
      appointment.endedAt = new Date();
      appointment.endedBy = "system";
      appointment.endedReason = "refunded";
      appointment.payment.refundId = refund.refund?.refundId || refund.refundTxn?.transactionId;
      appointment.payment.refundedAt = new Date();
      await appointment.save();
      await emitQueueUpdates(appointment.doctor.toString());
    } catch (error) {
      console.error("Auto refund failed:", error.message);
    } finally {
      await redis.zrem(autoRefundSetKey, appointmentId);
    }
  }
};

const startAutoRefundWorker = () => {
  const intervalMs = Number(process.env.AUTO_REFUND_WORKER_INTERVAL_MS || 60_000);
  setInterval(() => {
    processDueAutoRefunds().catch((error) => {
      console.error("Auto refund worker failed:", error.message);
    });
  }, intervalMs);
};

const bookAppointment = async (req, res) => {
  const { doctorId } = req.params;
  const { bookingToken } = req.body;

  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only users can book appointments" });
  }
  const bookable = await ensureBookableAppointment(doctorId, req.auth.id);
  if (bookable.status) {
    return res.status(bookable.status).json(bookable);
  }

  const transaction = await transferVirtualMoney({
    senderId: req.auth.id,
    senderRole: "user",
    receiverId: doctorId,
    receiverRole: "doctor",
    amount: WALLET_APPOINTMENT_FEE_INR,
    type: "PAYMENT",
    description: "Appointment booking fee",
    referenceId: `APPOINTMENT-${new mongoose.Types.ObjectId().toString()}`,
    metadata: {
      doctorId,
      userId: req.auth.id,
      source: "appointment-booking",
    },
  });

  const appointment = await Appointment.create({
    doctor: doctorId,
    user: req.auth.id,
    roomId: `appointment-${new mongoose.Types.ObjectId().toString()}`,
    status: "queued",
    payment: {
      amount: WALLET_APPOINTMENT_FEE_INR,
      paymentId: transaction.transactionId,
      paidAt: new Date(),
    },
  });

  await emitQueueUpdates(doctorId);

  const pendingCount = await Appointment.countDocuments({
    doctor: doctorId,
    status: "queued",
    createdAt: { $lte: appointment.createdAt },
  });

  const result = {
    appointment,
    queuePosition: pendingCount,
  };

  return res.status(201).json({
    message: `Appointment booked and queued successfully. INR ${WALLET_APPOINTMENT_FEE_INR} debited from your wallet.`,
    appointmentId: result.appointment._id,
    status: result.appointment.status,
    queuePosition: result.queuePosition,
  });
};

const getDoctorQueue = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res
      .status(403)
      .json({ message: "Only doctors can access full appointment queue" });
  }

  const payload = await buildDoctorQueuePayload(req.auth.id);
  return res.status(200).json(payload);
};

const getDoctorPendingStatus = async (req, res) => {
  const { doctorId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(doctorId)) {
    return res.status(400).json({ message: "Invalid doctor id" });
  }

  const [platformDoctor, hospitalDoctor] = await Promise.all([
    Doctor.findById(doctorId),
    HospitalStaff.findOne({ _id: doctorId, role: "DOCTOR" })
  ]);
  const doctor = platformDoctor || hospitalDoctor;

  if (!doctor) {
    return res.status(404).json({ message: "Doctor not found" });
  }

  const pendingCount = await Appointment.countDocuments({
    doctor: doctorId,
    status: "queued",
  });

  const response = {
    doctorId,
    pendingCount,
    myAppointment: null,
  };

  if (req.auth.role === "user") {
    const myAppointment = await Appointment.findOne({
      doctor: doctorId,
      user: req.auth.id,
      status: { $in: ["queued", "active"] },
    }).sort({ createdAt: 1 });

    if (myAppointment) {
      const queuePosition =
        myAppointment.status === "queued"
          ? await Appointment.countDocuments({
              doctor: doctorId,
              status: "queued",
              createdAt: { $lte: myAppointment.createdAt },
            })
          : 0;
      response.myAppointment = {
        _id: myAppointment._id,
        status: myAppointment.status,
        createdAt: myAppointment.createdAt,
        queuePosition,
        startedAt: myAppointment.startedAt,
        endsAt: myAppointment.startedAt
          ? new Date(myAppointment.startedAt.getTime() + APPOINTMENT_DURATION_MS)
          : null,
        patientBrief: myAppointment.patientBrief || null,
      };
    }
  }

  return res.status(200).json(response);
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
    query.doctor = doctorId;
  }

  const appointmentsRaw = await Appointment.find(query)
    .sort({ createdAt: -1 })
    .populate("user", "firstName lastName email triageProfile")
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

  if (appointment.doctor.toString() !== req.auth.id.toString()) {
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
    .populate("user", "firstName lastName email")
    .lean();
  
  const [appointment] = await populateDoctorForAppointments(appointmentRaw ? [appointmentRaw] : []);

  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  if (appointment.doctor._id.toString() !== req.auth.id.toString()) {
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
    appointment.doctor?._id?.toString() === req.auth.id.toString();
  const userAccess =
    req.auth.role === "user" &&
    appointment.user?._id?.toString() === req.auth.id.toString();

  if (!doctorAccess && !userAccess) {
    return res.status(403).json({ message: "You cannot access this appointment" });
  }

  return res.status(200).json({
    _id: appointment._id,
    status: appointment.status,
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
      ? new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS)
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

  if (appointment.doctor.toString() !== req.auth.id.toString()) {
    return res.status(403).json({ message: "You cannot start this appointment" });
  }

  if (appointment.status !== "queued") {
    return res.status(409).json({ message: "Appointment is not in queued state" });
  }

  const firstInQueue = await Appointment.findOne({
    doctor: req.auth.id,
    status: "queued",
  }).sort({ createdAt: 1 });

  if (!firstInQueue || firstInQueue._id.toString() !== appointmentId.toString()) {
    return res
      .status(409)
      .json({ message: "Please start appointments strictly in queue order" });
  }

  appointment.status = "active";
  appointment.startedAt = new Date();
  appointment.endedAt = null;
  appointment.endedBy = null;
  appointment.endedReason = null;
  await appointment.save();
  await getRedis().zrem(autoRefundSetKey, appointment._id.toString());

  const linkedToken = await OpdToken.findOne({ appointmentId: appointment._id });
  if (linkedToken) {
    // FIXED: Starting a synced hospital OPD appointment from the doctor queue did not update the OPD console or patient token status.
    linkedToken.status = "in_consultation";
    linkedToken.consultationStartedAt = appointment.startedAt;
    await linkedToken.save();
    await clearLinkedOpdCache(linkedToken);
    const io = getIO();
    if (io) {
      io.to(`hospital:${linkedToken.hospitalId.toString()}`).emit("opd:consultation-started", { token: linkedToken });
      io.to(`doctor:${linkedToken.doctorId.toString()}`).emit("opd:consultation-started", { token: linkedToken });
    }
  }

  scheduleAppointmentTimeout(appointmentId.toString());
  await emitQueueUpdates(req.auth.id.toString());
  await publishEvent("appointment.started", {
    appointmentId: appointment._id.toString(),
    doctorId: appointment.doctor.toString(),
    userId: appointment.user.toString(),
  });

  const io = getIO();
  if (io) {
    const payload = {
      appointmentId: appointment._id,
      doctorId: appointment.doctor.toString(),
      userId: appointment.user.toString(),
      status: appointment.status,
      startedAt: appointment.startedAt,
      endsAt: new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS),
    };
    io.to(`appointment:${appointmentId}`).emit("appointment:started", payload);
    // FIXED: The doctor was receiving the patient-facing "join meeting" notification after starting the appointment.
    io.to(`user:${appointment.user.toString()}`).emit("appointment:started", payload);
  }

  return res.status(200).json({
    message: "Appointment started",
    appointmentId: appointment._id,
    status: appointment.status,
    startedAt: appointment.startedAt,
    endsAt: new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS),
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
  if (appointment.doctor.toString() !== req.auth.id.toString()) {
    return res.status(403).json({ message: "You cannot end this appointment" });
  }
  if (appointment.status !== "active") {
    return res.status(409).json({ message: "Appointment is not active" });
  }

  const { roughNotes } = req.body;

  const completed = await finishAppointment(
    appointmentId.toString(),
    "doctor",
    "doctor-ended",
    roughNotes
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

const uploadSharedReport = async (req, res) => {
  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only patients can upload reports" });
  }

  const { doctorId, fileUrl, title } = req.body;
  if (!doctorId || !fileUrl || !title) {
    return res.status(400).json({ message: "doctorId, fileUrl, and title are required" });
  }

  const hasCompletedAppointment = await Appointment.exists({
    user: req.auth.id,
    doctor: doctorId,
    status: "completed"
  });

  if (!hasCompletedAppointment) {
    return res.status(403).json({ message: "You can only share reports with doctors you have had a completed appointment with" });
  }

  try {
    const report = await SharedReport.create({
      patientId: req.auth.id,
      doctorId,
      fileUrl,
      title,
    });

    return res.status(201).json({ message: "Report shared successfully", report });
  } catch (error) {
    return res.status(500).json({ message: "Failed to upload report", error: error.message });
  }
};

const getSharedReports = async (req, res) => {
  const query = {};
  if (req.auth.role === "user") {
    query.patientId = req.auth.id;
    if (req.query.doctorId) query.doctorId = req.query.doctorId;
  } else if (req.auth.role === "doctor") {
    query.doctorId = req.auth.id;
    if (req.query.patientId) query.patientId = req.query.patientId;
  } else {
    return res.status(403).json({ message: "Unauthorized role" });
  }

  try {
    const reports = await SharedReport.find(query)
      .sort({ uploadedAt: -1 })
      .populate("patientId", "firstName lastName")
      .populate("doctorId", "firstName lastName");

    return res.status(200).json(reports);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch reports", error: error.message });
  }
};

export {
  APPOINTMENT_DURATION_MS,
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
  updateDoctorNotes,
  verifyAppointmentOtp,
  uploadSharedReport,
  getSharedReports,
};
