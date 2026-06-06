import mongoose from "mongoose";
import crypto from "crypto";
import Appointment from "../model/appointment.js";
import Doctor from "../model/doctor.js";
import Payment from "../model/payment.js";
import User from "../model/user.js";
import { getIO } from "../socket.js";
import { generateGeminiText } from "./gemini.js";
import {
  sendAppointmentApprovalMail,
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
import {
  getAppointmentAmount,
  getRazorpayClient,
  verifyRazorpayPaymentSignature,
  verifyRazorpayWebhookSignature,
} from "../services/payments.js";
import { refundVirtualPayment, transferVirtualMoney } from "../services/virtualLedger.js";

const APPOINTMENT_DURATION_MS = 5 * 60 * 1000;
const OTP_EXPIRY_MS = 10 * 60 * 1000;
const BOOKING_TOKEN_EXPIRY_MS = 10 * 60 * 1000;
const AUTO_REFUND_DELAY_MS = 30 * 60 * 1000;
const WALLET_APPOINTMENT_FEE_INR = Number(process.env.APPOINTMENT_BOOKING_FEE_INR || 5);
const APPROVAL_TOKEN_EXPIRY_SECONDS = 24 * 60 * 60;
const appointmentTimeouts = new Map();

const hashValue = (value) =>
  crypto.createHash("sha256").update(value).digest("hex");

const generateOtp = () => crypto.randomInt(100000, 1000000).toString();

const buildPersonName = (account, fallback) =>
  [account?.firstName, account?.lastName].filter(Boolean).join(" ") || fallback;

const appointmentApprovalKey = (token) => `appointment:approval:${token}`;

const buildRequestBaseUrl = (req) =>
  process.env.PUBLIC_BACKEND_URL ||
  `${req.protocol}://${req.get("host")}`;

const base64UrlEncode = (value) => Buffer.from(value).toString("base64url");

const base64UrlDecode = (value) => Buffer.from(value, "base64url").toString("utf8");

const createAppointmentActionToken = ({ appointmentId, doctorId, userId }) => {
  const payload = base64UrlEncode(
    JSON.stringify({
      appointmentId,
      doctorId,
      userId,
      exp: Date.now() + APPROVAL_TOKEN_EXPIRY_SECONDS * 1000,
    }),
  );
  const signature = crypto
    .createHmac("sha256", process.env.TOKEN_KEY || "medipulse-dev-secret")
    .update(payload)
    .digest("base64url");

  return `${payload}.${signature}`;
};

const verifyAppointmentActionToken = (token) => {
  const [payload, signature] = String(token || "").split(".");
  if (!payload || !signature) return null;

  const expectedSignature = crypto
    .createHmac("sha256", process.env.TOKEN_KEY || "medipulse-dev-secret")
    .update(payload)
    .digest("base64url");

  const expectedBuffer = Buffer.from(expectedSignature);
  const receivedBuffer = Buffer.from(signature);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return null;
  }

  const data = JSON.parse(base64UrlDecode(payload));
  if (!data.exp || data.exp < Date.now()) return null;
  return data;
};

const ensureBookableAppointment = async (doctorId, userId) => {
  if (!mongoose.Types.ObjectId.isValid(doctorId)) {
    return { status: 400, message: "Invalid doctor id" };
  }

  const [doctor, existing] = await Promise.all([
    Doctor.findById(doctorId),
    Appointment.findOne({
      doctor: doctorId,
      user: userId,
      status: { $in: ["pending_approval", "queued", "active"] },
    }),
  ]);

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
  createdAt: appointment.createdAt,
  startedAt: appointment.startedAt,
  endedAt: appointment.endedAt,
  endedBy: appointment.endedBy,
  endedReason: appointment.endedReason,
  doctorNotes: appointment.doctorNotes || "",
  receiptText: appointment.receiptText || "",
  receiptGeneratedAt: appointment.receiptGeneratedAt || null,
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
      .populate("user", "firstName lastName email"),
    Appointment.findOne({ doctor: doctorId, status: "active" })
      .sort({ startedAt: 1 })
      .populate("user", "firstName lastName email")
      .populate("doctor", "firstName lastName email"),
  ]);

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

const finishAppointment = async (appointmentId, endedBy, endedReason) => {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment || appointment.status !== "active") {
    clearAppointmentTimeout(appointmentId);
    return null;
  }

  appointment.status = "completed";
  appointment.endedAt = new Date();
  appointment.endedBy = endedBy;
  appointment.endedReason = endedReason;
  await appointment.save();
  clearAppointmentTimeout(appointmentId);

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

const createQueuedAppointmentFromPayment = async (payment) => {
  if (payment.appointment) {
    return Appointment.findById(payment.appointment);
  }

  const existingAppointment = await Appointment.findOne({
    "payment.orderId": payment.orderId,
  });
  if (existingAppointment) {
    payment.appointment = existingAppointment._id;
    await payment.save();
    return existingAppointment;
  }

  let appointment;
  try {
    appointment = await Appointment.create({
      doctor: payment.doctor,
      user: payment.user,
      roomId: `appointment-${new mongoose.Types.ObjectId().toString()}`,
      status: "queued",
      payment: {
        provider: "razorpay",
        orderId: payment.orderId,
        paymentId: payment.paymentId,
        amount: payment.amount,
        currency: payment.currency,
        paidAt: payment.paidAt || new Date(),
      },
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    appointment = await Appointment.findOne({ "payment.orderId": payment.orderId });
  }

  payment.appointment = appointment._id;
  payment.autoRefundDueAt = new Date(Date.now() + AUTO_REFUND_DELAY_MS);
  await payment.save();
  await getRedis().zadd(
    autoRefundSetKey,
    payment.autoRefundDueAt.getTime(),
    payment._id.toString(),
  );
  await emitQueueUpdates(payment.doctor.toString());
  await publishEvent("appointment.booked", {
    appointmentId: appointment._id.toString(),
    orderId: payment.orderId,
    paymentId: payment.paymentId,
    doctorId: payment.doctor.toString(),
    userId: payment.user.toString(),
  });

  return appointment;
};

const createQueuedAppointmentFromDemoBooking = async ({
  doctorId,
  userId,
  bookingToken,
  requestBaseUrl,
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
    roomId: `appointment-${new mongoose.Types.ObjectId().toString()}`,
    status: "pending_approval",
    payment: {
      provider: "wallet",
      orderId: transaction.transactionId,
      paymentId: transaction.transactionId,
      amount: WALLET_APPOINTMENT_FEE_INR,
      currency: "INR",
      paidAt: new Date(),
    },
  });

  await getRedis().del(bookingTokenKey(bookingToken));
  await emitQueueUpdates(doctorId);

  const user = await User.findById(userId);
  const approvalToken = createAppointmentActionToken({
      appointmentId: appointment._id.toString(),
      doctorId,
      userId,
  });

  const approveUrl = `${requestBaseUrl}/appointment/email-action/${approvalToken}?decision=approve`;
  const cancelUrl = `${requestBaseUrl}/appointment/email-action/${approvalToken}?decision=cancel`;
  try {
    await sendAppointmentApprovalMail({
      to: user.email,
      doctorName: buildPersonName(bookable.doctor, "Doctor"),
      patientName: buildPersonName(user, "Patient"),
      appointmentId: appointment._id.toString(),
      approveUrl,
      cancelUrl,
    });
  } catch (error) {
    console.error("Appointment approval email failed:", error.message);
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

const requestPaymentRefund = async (payment, reason = "manual-refund") => {
  if (!payment.paymentId) {
    throw new Error("Payment id is missing");
  }

  if (payment.status === "refunded") {
    return payment;
  }

  const refundRequestedAt = new Date();
  payment.refunds.push({
    amount: payment.amount,
    status: "requested",
    reason,
    requestedAt: refundRequestedAt,
  });
  await payment.save();

  try {
    const refund = await getRazorpayClient().payments.refund(payment.paymentId, {
      amount: payment.amount,
      notes: { reason },
    });
    const lastRefund = payment.refunds[payment.refunds.length - 1];
    lastRefund.refundId = refund.id;
    lastRefund.status = "processed";
    lastRefund.processedAt = new Date();
    payment.status = "refunded";
    await payment.save();

    if (payment.appointment) {
      await Appointment.findByIdAndUpdate(payment.appointment, {
        status: "cancelled",
        endedAt: new Date(),
        endedBy: "system",
        endedReason: "refunded",
        "payment.refundId": refund.id,
        "payment.refundedAt": lastRefund.processedAt,
      });
    }

    await publishEvent("payment.refunded", {
      paymentId: payment.paymentId,
      orderId: payment.orderId,
      refundId: refund.id,
      reason,
    });
    return payment;
  } catch (error) {
    const lastRefund = payment.refunds[payment.refunds.length - 1];
    lastRefund.status = "failed";
    lastRefund.error = error.message;
    payment.status = "refund_failed";
    await payment.save();
    await publishEvent("payment.refund_failed", {
      paymentId: payment.paymentId,
      orderId: payment.orderId,
      reason,
      error: error.message,
    });
    throw error;
  }
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
  const { otp } = req.body;

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
      JSON.stringify({ doctorId, userId: req.auth.id }),
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

const createPaymentOrder = async (req, res) => {
  const { doctorId } = req.params;
  const { bookingToken } = req.body;

  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only users can pay for appointments" });
  }

  const tokenDataRaw = await getRedis().get(bookingTokenKey(bookingToken));
  if (!tokenDataRaw) {
    return res.status(401).json({ message: "Please verify email OTP before payment" });
  }

  const tokenData = JSON.parse(tokenDataRaw);
  if (tokenData.userId !== req.auth.id || tokenData.doctorId !== doctorId) {
    return res.status(403).json({ message: "Invalid booking token" });
  }

  const bookable = await ensureBookableAppointment(doctorId, req.auth.id);
  if (bookable.status) {
    return res.status(bookable.status).json(bookable);
  }

  const amount = getAppointmentAmount();
  const receipt = `appt_${Date.now()}_${req.auth.id.slice(-6)}`;
  const razorpayOrder = await getRazorpayClient().orders.create({
    amount,
    currency: "INR",
    receipt,
    notes: {
      userId: req.auth.id,
      doctorId,
    },
  });

  const payment = await Payment.create({
    user: req.auth.id,
    doctor: doctorId,
    orderId: razorpayOrder.id,
    amount,
    currency: razorpayOrder.currency,
    receipt,
    metadata: {
      bookingTokenHash: hashValue(bookingToken),
    },
  });

  await publishEvent("payment.order_created", {
    orderId: payment.orderId,
    doctorId,
    userId: req.auth.id,
    amount,
  });

  return res.status(201).json({
    message: "Payment order created",
    keyId: process.env.RAZORPAY_KEY_ID,
    orderId: payment.orderId,
    amount: payment.amount,
    currency: payment.currency,
    doctorName: `Dr. ${buildPersonName(bookable.doctor, "Doctor")}`,
  });
};

const verifyPaymentAndBook = async (req, res) => {
  const { doctorId } = req.params;
  const { bookingToken, razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    req.body;

  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only users can book appointments" });
  }

  const tokenDataRaw = await getRedis().get(bookingTokenKey(bookingToken));
  if (!tokenDataRaw) {
    return res.status(401).json({ message: "Booking token expired. Verify OTP again" });
  }

  const tokenData = JSON.parse(tokenDataRaw);
  if (tokenData.userId !== req.auth.id || tokenData.doctorId !== doctorId) {
    return res.status(403).json({ message: "Invalid booking token" });
  }

  if (
    !verifyRazorpayPaymentSignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    })
  ) {
    return res.status(400).json({ message: "Payment signature verification failed" });
  }

  const payment = await Payment.findOne({
    orderId: razorpay_order_id,
    user: req.auth.id,
    doctor: doctorId,
  });
  if (!payment) {
    return res.status(404).json({ message: "Payment order not found" });
  }

  payment.paymentId = razorpay_payment_id;
  payment.status = "paid";
  payment.paidAt = new Date();
  await payment.save();

  const appointment = await createQueuedAppointmentFromPayment(payment);
  const queuePosition = await queuePositionForAppointment(appointment);
  await getRedis().del(bookingTokenKey(bookingToken));
  await publishEvent("payment.verified", {
    orderId: payment.orderId,
    paymentId: payment.paymentId,
    appointmentId: appointment._id.toString(),
  });

  return res.status(201).json({
    message: "Payment verified and appointment booked successfully",
    appointmentId: appointment._id,
    status: appointment.status,
    queuePosition,
  });
};

const handleRazorpayWebhook = async (req, res) => {
  const signature = req.headers["x-razorpay-signature"];
  const rawBody = req.body;

  if (!verifyRazorpayWebhookSignature(rawBody, signature)) {
    return res.status(400).json({ message: "Invalid webhook signature" });
  }

  const event = JSON.parse(rawBody.toString("utf8"));
  const paymentEntity = event.payload?.payment?.entity;
  const refundEntity = event.payload?.refund?.entity;
  const eventId = paymentEntity?.id || refundEntity?.id;
  const orderId = paymentEntity?.order_id;

  if (orderId) {
    const payment = await Payment.findOne({ orderId });
    if (payment && eventId && !payment.webhookEvents.includes(eventId)) {
      payment.webhookEvents.push(eventId);
      if (event.event === "payment.captured") {
        payment.paymentId = paymentEntity.id;
        payment.status = "paid";
        payment.paidAt = payment.paidAt || new Date();
      }
      if (event.event === "payment.failed") {
        payment.status = "failed";
        payment.failedAt = new Date();
      }
      await payment.save();

      if (event.event === "payment.captured") {
        await createQueuedAppointmentFromPayment(payment);
      }
    }
  }

  if (refundEntity?.payment_id) {
    const payment = await Payment.findOne({ paymentId: refundEntity.payment_id });
    if (payment && eventId && !payment.webhookEvents.includes(eventId)) {
      payment.webhookEvents.push(eventId);
      const refund = payment.refunds.find((item) => item.refundId === refundEntity.id);
      if (refund) {
        refund.status = refundEntity.status === "processed" ? "processed" : refund.status;
        refund.processedAt = refund.processedAt || new Date();
      }
      if (refundEntity.status === "processed") {
        payment.status = "refunded";
      }
      await payment.save();
    }
  }

  await publishEvent("razorpay.webhook_received", {
    event: event.event,
    orderId,
    eventId,
  });

  return res.status(200).json({ received: true });
};

const renderEmailActionResult = (res, { title, message, statusCode = 200 }) =>
  res.status(statusCode).send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title}</title>
        <style>
          body { margin: 0; font-family: Arial, sans-serif; background: #f8fafc; color: #111827; }
          main { min-height: 100vh; display: grid; place-items: center; padding: 24px; }
          section { max-width: 520px; width: 100%; background: #ffffff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 28px; box-shadow: 0 10px 30px rgba(15, 23, 42, 0.08); }
          h1 { margin: 0 0 12px; font-size: 24px; }
          p { margin: 0; line-height: 1.6; color: #4b5563; }
        </style>
      </head>
      <body>
        <main>
          <section>
            <h1>${title}</h1>
            <p>${message}</p>
          </section>
        </main>
      </body>
    </html>
  `);

const handleEmailAppointmentAction = async (req, res) => {
  const { token } = req.params;
  const decision = String(req.query.decision || "").toLowerCase();

  if (!["approve", "cancel"].includes(decision)) {
    return renderEmailActionResult(res, {
      title: "Invalid action",
      message: "This appointment link is missing a valid action.",
      statusCode: 400,
    });
  }

  const tokenData = verifyAppointmentActionToken(token);
  if (!tokenData) {
    return renderEmailActionResult(res, {
      title: "Link expired",
      message: "This appointment approval link has expired or is invalid.",
      statusCode: 410,
    });
  }

  const appointment = await Appointment.findById(tokenData.appointmentId)
    .populate("doctor", "firstName lastName email")
    .populate("user", "firstName lastName email");

  if (!appointment) {
    return renderEmailActionResult(res, {
      title: "Appointment not found",
      message: "This appointment could not be found.",
      statusCode: 404,
    });
  }

  if (!["pending_approval", "queued"].includes(appointment.status)) {
    return renderEmailActionResult(res, {
      title: "Already handled",
      message: `This appointment is already ${appointment.status}.`,
    });
  }

  const doctorId = appointment.doctor._id.toString();
  const userId = appointment.user._id.toString();
  const doctorName = buildPersonName(appointment.doctor, "Doctor");
  const patientName = buildPersonName(appointment.user, "Patient");

  if (decision === "approve") {
    if (appointment.status === "pending_approval") {
      appointment.status = "queued";
      appointment.startedAt = null;
      appointment.endedAt = null;
      appointment.endedBy = null;
      appointment.endedReason = null;
      await appointment.save();
    }

    await emitQueueUpdates(doctorId);
    await publishEvent("appointment.approved_from_email", {
      appointmentId: appointment._id.toString(),
      doctorId,
      userId,
    });

    try {
      await sendAppointmentBookedMail({
        to: appointment.user.email,
        patientName,
        doctorName,
        appointmentId: appointment._id.toString(),
      });
    } catch (error) {
      console.error("Appointment booked email failed:", error.message);
    }

    return renderEmailActionResult(res, {
      title: "Appointment approved",
      message: "The appointment has been approved and added to the doctor's queue. The meeting will start only when the doctor starts it.",
    });
  }

  let refund;
  try {
    refund = await refundVirtualPayment({
      actorId: doctorId,
      actorRole: "doctor",
      originalTransactionId: appointment.payment?.paymentId || appointment.payment?.orderId,
      amount: appointment.payment?.amount || WALLET_APPOINTMENT_FEE_INR,
      reason: "Appointment request cancelled from email",
      isAdmin: false,
      idempotencyKey: `appointment-email-cancel-${appointment._id.toString()}`,
    });
  } catch (error) {
    console.error("Appointment email refund failed:", error.message);
    return renderEmailActionResult(res, {
      title: "Refund failed",
      message: error.message || "The appointment could not be refunded right now.",
      statusCode: 400,
    });
  }

  appointment.status = "cancelled";
  appointment.endedAt = new Date();
  appointment.endedBy = "system";
  appointment.endedReason = "refunded";
  appointment.payment.refundId = refund.refund?.refundId || refund.refundTxn?.transactionId;
  appointment.payment.refundedAt = new Date();
  await appointment.save();
  await emitQueueUpdates(doctorId);
  await publishEvent("appointment.cancelled_from_email", {
    appointmentId: appointment._id.toString(),
    doctorId,
    userId,
    refundId: appointment.payment.refundId,
  });

  try {
    await sendAppointmentRefundMail({
      to: appointment.user.email,
      patientName,
      doctorName,
      appointmentId: appointment._id.toString(),
      amount: appointment.payment?.amount || WALLET_APPOINTMENT_FEE_INR,
    });
  } catch (error) {
    console.error("Appointment refund email failed:", error.message);
  }

  return renderEmailActionResult(res, {
    title: "Appointment cancelled",
    message: "The appointment request has been cancelled, the wallet refund is complete, and the patient has been notified by email.",
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

  if (appointment.payment?.provider === "wallet") {
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
        .populate("doctor", "firstName lastName email")
        .populate("user", "firstName lastName email");

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
  }

  const payment = await Payment.findOne({ appointment: appointment._id, status: "paid" });
  if (!payment) {
    return res.status(404).json({ message: "Paid payment not found" });
  }

  await requestPaymentRefund(payment, reason);
  await emitQueueUpdates(appointment.doctor.toString());

  return res.status(200).json({ message: "Refund processed successfully" });
};

const processDueAutoRefunds = async () => {
  const redis = getRedis();
  const duePaymentIds = await redis.zrangebyscore(
    autoRefundSetKey,
    0,
    Date.now(),
    "LIMIT",
    0,
    25,
  );

  for (const paymentId of duePaymentIds) {
    const payment = await Payment.findById(paymentId).populate("appointment");
    if (!payment) {
      await redis.zrem(autoRefundSetKey, paymentId);
      continue;
    }

    payment.autoRefundCheckedAt = new Date();

    const shouldRefund =
      payment.status === "paid" &&
      payment.appointment &&
      payment.appointment.status === "queued" &&
      !payment.appointment.startedAt;

    if (!shouldRefund) {
      await payment.save();
      await redis.zrem(autoRefundSetKey, paymentId);
      continue;
    }

    try {
      await requestPaymentRefund(payment, "doctor-not-started-within-30-minutes");
      await emitQueueUpdates(payment.doctor.toString());
    } catch (error) {
      console.error("Auto refund failed:", error.message);
    } finally {
      await redis.zrem(autoRefundSetKey, paymentId);
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

  if (!bookingToken) {
    return res.status(400).json({ message: "Booking token is required" });
  }

  const result = await createQueuedAppointmentFromDemoBooking({
    doctorId,
    userId: req.auth.id,
    bookingToken,
    requestBaseUrl: buildRequestBaseUrl(req),
  });

  if (result.status && result.message) {
    return res.status(result.status).json(result);
  }

  return res.status(201).json({
    message: "Appointment request sent to doctor. INR 5 debited from your wallet.",
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

  const doctor = await Doctor.findById(doctorId);
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
      status: { $in: ["pending_approval", "queued", "active"] },
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

  const appointments = await Appointment.find(query)
    .sort({ createdAt: -1 })
    .populate("doctor", "firstName lastName email")
    .populate("user", "firstName lastName email");

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

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctor", "firstName lastName email")
    .populate("user", "firstName lastName email");

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

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctor", "firstName lastName email")
    .populate("user", "firstName lastName email");

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
  const payment = await Payment.findOne({ appointment: appointment._id });
  if (payment) {
    await getRedis().zrem(autoRefundSetKey, payment._id.toString());
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
      status: appointment.status,
      startedAt: appointment.startedAt,
      endsAt: new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS),
    };
    io.to(`appointment:${appointmentId}`).emit("appointment:started", payload);
    io.to(`doctor:${appointment.doctor.toString()}`).emit("appointment:started", payload);
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

  const completed = await finishAppointment(
    appointmentId.toString(),
    "doctor",
    "doctor-ended",
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

export {
  APPOINTMENT_DURATION_MS,
  bookAppointment,
  createPaymentOrder,
  endAppointment,
  getAppointmentById,
  getDoctorPendingStatus,
  getDoctorQueue,
  getUserAppointmentHistory,
  generateAppointmentReceipt,
  handleEmailAppointmentAction,
  handleRazorpayWebhook,
  refundAppointmentPayment,
  sendAppointmentOtp,
  startAppointment,
  startAutoRefundWorker,
  updateDoctorNotes,
  verifyAppointmentOtp,
  verifyPaymentAndBook,
};
