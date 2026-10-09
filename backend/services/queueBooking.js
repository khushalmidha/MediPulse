import { validateRequestedContext, explicitPractice } from "./queueContext.js";
import BookingChallenge from "../model/bookingChallenge.js";
import { recordVisitEvent } from "./workflowEvents.js";
import { autoRefundDeadline } from "./consultationPolicy.js";
import crypto from "node:crypto";
import mongoose from "mongoose";
import BookingOperation from "../model/bookingOperation.js";
import OpdSequence from "../model/opdSequence.js";
import OpdToken from "../model/opdToken.js";
import Appointment from "../model/appointment.js";
import VirtualTransaction from "../model/virtualTransaction.js";
import { transferInSession, refundInSession, afterTransferCommit } from "./virtualLedger.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { amountToMinor, fromMinor } from "../util/money.js";
import { accessError, idOf } from "./hospitalAccess.js";
import { localServiceDate, liveTokenStatuses, liveAppointmentStatuses } from "./queueContext.js";

const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const bookingRequest = (req, kind, context, personKey, input) => {
  validateRequestedContext(req.body, context);
  const supplied = req.get?.("Idempotency-Key") || req.headers?.["idempotency-key"] || req.body.requestId;
  if (!supplied && !req.auth) throw accessError(428, "Idempotency-Key is required for assisted bookings");
  const requestKey = supplied || `legacy:${context.queueKey}:${personKey}`;
  if (supplied && (typeof supplied !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(supplied))) throw accessError(400, "Invalid Idempotency-Key");
  return { actorKey: `${req.staff ? "staff" : "patient"}:${req.staff?.id || req.auth?.id}`, kind, requestKey,
    fingerprint: crypto.createHash("sha256").update(JSON.stringify(canonical(input))).digest("hex") };
};
export const queueTransaction = async (callback) => {
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => callback(session)); }
  catch (error) { if (error.code === 11000) throw accessError(409, "A booking or consultation already occupies this queue"); throw error; }
  finally { await session.endSession(); }
};
export const nextTokenNumber = async (context, hospitalId, doctorId) => {
  const filter = { queueKey: context.queueKey };
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const row = await OpdSequence.findOneAndUpdate(filter, { $inc: { seq: 1 }, $setOnInsert: {
        hospitalId, doctorId, date: context.serviceDate, sessionId: context.sessionId,
      } }, { upsert: true, new: true });
      return row.seq;
    } catch (error) { if (error.code !== 11000 || attempt === 7) throw error; }
  }
};
const resources = async (operation) => {
  if (operation.sourceOperationId) {
    const source = await BookingOperation.findById(operation.sourceOperationId);
    if (source?.state === "failed") {
      operation.state = "failed"; operation.responseStatus = source.responseStatus; operation.errorMessage = source.errorMessage;
      await operation.save(); throw accessError(source.responseStatus || 409, source.errorMessage || "Booking failed");
    }
    if (source?.state === "completed") { operation.paymentId = source.paymentId; operation.fee = source.fee; }
  }
  const token = operation.tokenId ? await OpdToken.findById(operation.tokenId) : null;
  const appointment = operation.appointmentId ? await Appointment.findById(operation.appointmentId) : null;
  if (operation.sourceOperationId) {
    const source = await BookingOperation.findById(operation.sourceOperationId);
    if (source?.state === "completed" && operation.state !== "completed") { operation.state = "completed"; await operation.save(); }
  }
  return { token, appointment, operation, replay: true };
};

const replayOperation = async (operation) => {
  if (operation.state === "failed") throw Object.assign(accessError(operation.responseStatus || 409, operation.errorMessage || "Booking failed"), { compensationStatus: operation.compensationStatus || "none" });
  return resources(operation);
};
export const findBookingReplay = async (request) => {
  const operation = await BookingOperation.findOne({ actorKey: request.actorKey, kind: request.kind, requestKey: request.requestKey });
  if (!operation) return null;
  if (operation.fingerprint !== request.fingerprint) throw accessError(409, "This request key was used with different booking details");
  return operation.state === "completed" ? replayOperation(operation) : recoverOrHold(operation);
};

// All new resource, wallet, ledger and completion writes share one Mongo transaction.
export const resumeQueueBooking = async (operationId) => {
  let paymentEffect;
  const result = await moneyTransaction(async (session) => {
    const operation = await BookingOperation.findById(operationId).session(session);
    if (!operation) throw accessError(404, "Booking operation not found");
    if (operation.state === "completed" || operation.state === "failed") return operation;
    if (operation.sourceOperationId) {
      const source = await BookingOperation.findById(operation.sourceOperationId).session(session);
      if (!source) throw accessError(409, "Booking source requires review");
      if (["completed", "failed", "review_required"].includes(source.state)) {
        Object.assign(operation, { state: source.state, paymentId: source.paymentId, fee: source.fee, responseStatus: source.responseStatus, errorMessage: source.errorMessage });
        await operation.save({ session });
      }
      return operation;
    }
    let token = operation.tokenId ? await OpdToken.findById(operation.tokenId).session(session) : null;
    let appointment = operation.appointmentId ? await Appointment.findById(operation.appointmentId).session(session) : null;
    const intent = operation.recoveryData;
    const primary = token || appointment;
    if (!intent && !primary) throw accessError(409, "Legacy operation has no recoverable booking intent");
    if (primary && primary.status !== "booking") throw accessError(409, "Interrupted visit requires review before recovery");
    const context = intent?.context || Object.fromEntries(["queueKey", "practiceKey", "serviceDate", "sessionId", "timezone"].map((field) => [field, primary[field]]));
    const personKey = intent?.personKey || primary.personKey;
    if (context.serviceDate !== localServiceDate(new Date(), context.timezone)) {
      const prior = await VirtualTransaction.findOne({ referenceId: `BOOKING-${operation._id}` }).session(session).lean();
      let compensated = false;
      if (prior) {
        const payerId = intent ? intent.payerId : appointment?.user, receiverId = intent ? intent.receiverId : appointment?.doctor;
        if (String(prior.senderId) !== String(payerId) || String(prior.receiverId) !== String(receiverId) || prior.amountMinor !== amountToMinor(operation.fee)) throw accessError(409, "Expired payment references require review");
        if (prior.status === "SUCCESS") {
          const refund = await refundInSession({ actorId: receiverId, actorRole: "doctor", originalTransactionId: prior.transactionId,
            reason: "expired-booking-recovery", idempotencyKey: `booking-expired-${operation._id}` }, session);
          paymentEffect = refund.replay ? null : refund.refundTxn;
          compensated = true;
        } else if (prior.status === "REFUNDED" && prior.refundedMinor === prior.amountMinor) compensated = true;
        else throw accessError(409, "Expired payment requires reconciliation");
      }
      if (token) await OpdToken.updateOne({ _id: token._id, status: "booking" }, { $set: { status: "cancelled" }, $inc: { revision: 1 } }, { session });
      if (appointment) await Appointment.updateOne({ _id: appointment._id, status: "booking" }, { $set: { status: "cancelled", endedAt: new Date(), ...(compensated ? { "payment.refundedAt": new Date(), "payment.refundState": "completed" } : {}) }, $inc: { revision: 1 } }, { session });
      operation.state = "failed"; operation.responseStatus = 409; operation.compensationStatus = compensated ? "completed" : "none";
      operation.errorMessage = compensated ? "Care session expired; demo payment refund completed" : "Care session expired; no demo payment was taken";
      await operation.save({ session }); return operation;
    }

    const existing = await (intent?.tokenData || token ? OpdToken : Appointment).findOne({ queueKey: context.queueKey, personKey,
      _id: { $ne: token?._id || appointment?._id || operation.tokenId || operation.appointmentId }, status: { $in: token || intent?.tokenData ? liveTokenStatuses : liveAppointmentStatuses } }).session(session);
    if (existing) {
      operation.sourceOperationId = existing.bookingOperationId;
      operation.tokenId = intent?.tokenData ? existing._id : undefined;
      operation.appointmentId = intent?.tokenData ? existing.appointmentId : existing._id;
      operation.state = ["booking", "refund_pending"].includes(existing.status) ? "reconciliation_required" : "completed";
      operation.paymentId = existing.payment?.paymentId;
      operation.fee = existing.paymentAmount ?? existing.payment?.amount ?? 0;
      await operation.save({ session }); return operation;
    }
    if (intent?.bookingProofId) {
      const proof = await BookingChallenge.findOneAndUpdate({ _id: intent.bookingProofId, kind: "proof", consumedAt: null,
        userId: intent.payerId, doctorId: intent.receiverId, familyMemberId: String(intent.appointmentData?.familyMemberId || ""), expiresAt: { $gt: new Date() } },
        { $set: { consumedAt: new Date() } }, { session, new: true });
      if (!proof) throw accessError(401, "Booking authorization expired or was already used");
    }
    const fee = operation.fee || 0;
    const payerId = intent ? intent.payerId : appointment?.user;
    const receiverId = intent ? intent.receiverId : appointment?.doctor;
    let payment;
    if (fee > 0 && payerId) {
      const prior = await VirtualTransaction.findOne({ referenceId: `BOOKING-${operation._id}`, senderId: payerId, senderRole: "user" }).session(session).lean();
      if (prior) {
        if (String(prior.receiverId) !== String(receiverId) || prior.amountMinor !== amountToMinor(fee) || prior.type !== "PAYMENT" || prior.status !== "SUCCESS") throw accessError(409, "Existing booking payment requires reconciliation");
        payment = prior;
      } else {
        const moved = await transferInSession({ senderId: payerId, senderRole: "user", receiverId, receiverRole: "doctor", amount: fee,
          referenceId: `BOOKING-${operation._id}`, description: "Demo consultation booking", metadata: { bookingOperationId: String(operation._id), demo: true } }, session);
        payment = moved.transaction; paymentEffect = moved.replay ? null : payment;
      }
    }
    const paymentBlock = payment ? { provider: "wallet", orderId: payment.transactionId, paymentId: payment.transactionId,
      amount: fromMinor(payment.amountMinor), amountMinor: payment.amountMinor, currency: "INR", paidAt: payment.createdAt || new Date() } : undefined;
    if (!appointment && intent?.appointmentData) [appointment] = await Appointment.create([{ ...intent.appointmentData, ...context, ...explicitPractice(context), personKey, _id: operation.appointmentId,
      opdTokenId: operation.tokenId, bookingOperationId: operation._id, status: "queued", revision: 1,
      appointmentType: intent.appointmentData.appointmentType || (context.practiceKey.startsWith("hospital:") ? "hospital_in_person" : "online_opd"),
      feeSnapshot: { amountMinor: amountToMinor(fee, { zero: true }), currency: "INR", demo: true }, ...(paymentBlock ? { payment: paymentBlock } : {}) }], { session });
    else if (appointment) appointment = await Appointment.findOneAndUpdate({ _id: appointment._id, status: "booking", revision: appointment.revision || 0 },
      { $set: { status: "queued", ...(paymentBlock ? { payment: paymentBlock } : {}) }, $inc: { revision: 1 } }, { new: true, session });
    if (!token && intent?.tokenData) [token] = await OpdToken.create([{ ...intent.tokenData, ...context, ...explicitPractice(context), personKey, _id: operation.tokenId, bookingOperationId: operation._id,
      appointmentId: operation.appointmentId, tokenNumber: intent.tokenNumber, displayToken: `${intent.tokenData.tokenPrefix || "T"}${String(intent.tokenNumber).padStart(3, "0")}`,
      date: new Date(`${context.serviceDate}T00:00:00Z`), status: intent.tokenData.arrivedAt ? "waiting" : "reserved", revision: 1,
      paymentStatus: payerId ? (fee > 0 ? "paid" : "waived") : "pending" }], { session });
    else if (token) token = await OpdToken.findOneAndUpdate({ _id: token._id, status: "booking", revision: token.revision || 0 },
      { $set: { status: token.arrivedAt ? "waiting" : "reserved", paymentStatus: payerId ? (fee > 0 ? "paid" : "waived") : "pending" }, $inc: { revision: 1 } }, { new: true, session });
    if ((!token && (intent?.tokenData || operation.tokenId)) || (!appointment && (intent?.appointmentData || operation.appointmentId))) throw accessError(409, "Booking records changed before commit");
    if (appointment) {
      const refundDueAt = autoRefundDeadline(appointment);
      if (refundDueAt) await Appointment.updateOne({ _id: appointment._id }, { $set: { refundDueAt } }, { session });
    }
    await recordVisitEvent({ token, appointment, action: "booked" }, session);
    operation.state = "completed"; operation.paymentId = payment?.transactionId;
    await operation.save({ session }); return operation;
  });
  if (paymentEffect && ["completed", "failed"].includes(result.state)) await afterTransferCommit(paymentEffect);
  return replayOperation(result);
};
const recoverOrHold = async (operation) => {
  try { return await resumeQueueBooking(operation._id); }
  catch (error) {
    // Business failure is definitive only when no prior debit exists. Unknown
    // commit/network outcomes remain durable and can safely be checked on restart.
    const persisted = await BookingOperation.findById(operation._id);
    if (["completed", "failed"].includes(persisted.state)) return replayOperation(persisted);
    const paid = await VirtualTransaction.findOne({ referenceId: `BOOKING-${operation._id}`, status: { $in: ["SUCCESS", "REFUNDED"] } });
    if ([400, 401, 402].includes(error.status) && !paid) {
      await moneyTransaction(async (session) => {
        await OpdToken.updateOne({ _id: persisted.tokenId, status: "booking" }, { $set: { status: "cancelled" }, $inc: { revision: 1 } }, { session });
        await Appointment.updateOne({ _id: persisted.appointmentId, status: "booking" }, { $set: { status: "cancelled", endedAt: new Date() }, $inc: { revision: 1 } }, { session });
        await BookingOperation.updateOne({ _id: persisted._id, state: { $in: ["processing", "reconciliation_required"] } }, { $set: { state: "failed", responseStatus: error.status, errorMessage: error.message } }, { session });
      });
      throw error;
    }
    await BookingOperation.updateOne({ _id: persisted._id, state: { $in: ["processing", "reconciliation_required", "review_required"] } }, { $set: { state: error.status === 409 ? "review_required" : "reconciliation_required", compensationStatus: paid ? "pending" : "none", errorMessage: error.status === 409 ? "Booking references require reviewed recovery" : "Booking recovery is pending", nextRecoveryAt: new Date(Date.now() + Math.min(3600000, 30000 * 2 ** Math.min(persisted.recoveryAttempts || 0, 7))) }, $inc: { recoveryAttempts: 1 } });
    return resources(await BookingOperation.findById(persisted._id));
  }
};
export const createQueueBooking = async ({ request, context, personKey, tokenData, appointmentData, fee = 0, payerId, receiverId, bookingProofId }) => {
  const prior = await findBookingReplay(request);
  if (prior) return prior.operation.state === "completed" ? prior : recoverOrHold(prior.operation);
  const minor = fee ? amountToMinor(fee) : 0;
  const tokenId = tokenData ? new mongoose.Types.ObjectId() : undefined;
  const appointmentId = appointmentData ? new mongoose.Types.ObjectId() : undefined;
  const tokenNumber = tokenData ? await nextTokenNumber(context, tokenData.hospitalId, tokenData.doctorId) : undefined;
  let operation, created = true;
  try { operation = await BookingOperation.create({ ...request, fee: fromMinor(minor), tokenId, appointmentId,
    recoveryData: { context, personKey, tokenData, appointmentData, payerId, receiverId, tokenNumber, bookingProofId } }); }
  catch (error) {
    if (error.code !== 11000) throw error;
    created = false;
    operation = await BookingOperation.findOne({ actorKey: request.actorKey, kind: request.kind, requestKey: request.requestKey });
    if (operation.fingerprint !== request.fingerprint) throw accessError(409, "This request key was used with different booking details");
  }
  const result = await recoverOrHold(operation);
  result.replay = !created || Boolean(result.operation.sourceOperationId);
  // A duplicate-key winner may have created the operation in another API process.
  return result;
};
export const recoverBookingOperations = async (limit = 25, { force = false } = {}) => {
  const rows = await BookingOperation.find({ state: { $in: ["processing", "reconciliation_required"] }, ...(!force ? { $or: [{ nextRecoveryAt: { $exists: false } }, { nextRecoveryAt: { $lte: new Date() } }] } : {}) }).sort({ createdAt: 1 }).limit(limit);
  const counts = { completed: 0, failed: 0, pending: 0 };
  for (const row of rows) {
    try { const result = await recoverOrHold(row); counts[result.operation.state === "completed" ? "completed" : "pending"]++; }
    catch { counts.failed++; }
  }
  return counts;
};
