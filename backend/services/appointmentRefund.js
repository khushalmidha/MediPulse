import Appointment from "../model/appointment.js";
import VirtualTransaction from "../model/virtualTransaction.js";
import VirtualRefund from "../model/virtualRefund.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { refundInSession, afterTransferCommit } from "./virtualLedger.js";
import { transitionVisit } from "./visitTransitions.js";
import { amountToMinor, moneyError } from "../util/money.js";

// One cancellation identity is shared by manual, automatic and restart recovery.
export const refundAppointment = async ({ appointmentId, expectedRevision }) => {
  const apply = async (session) => {
    const appointment = await Appointment.findById(appointmentId).session(session);
    if (!appointment) throw moneyError(404, "Appointment not found");
    const originalId = appointment.payment?.paymentId || appointment.payment?.orderId;
    const original = await VirtualTransaction.findOne({ transactionId: originalId }).session(session).lean();
    if (!original || original.type !== "PAYMENT" || original.senderRole !== "user" || original.receiverRole !== "doctor"
      || String(original.senderId) !== String(appointment.user) || String(original.receiverId) !== String(appointment.doctor)
      || original.amountMinor !== amountToMinor(appointment.payment.amount)) throw moneyError(409, "Appointment payment needs reviewed reconciliation");
    const key = `appointment-refund-${appointment._id}`;
    if (appointment.payment.refundedAt) {
      if (original.status !== "REFUNDED" || original.refundedMinor !== original.amountMinor) throw moneyError(409, "Recorded refund disagrees with ledger");
      return { appointment, replay: true };
    }
    if (["active", "completed"].includes(appointment.status)) throw moneyError(409, "Cannot refund an active or completed appointment");
    if (appointment.status !== "refund_pending" && appointment.payment.refundState !== "processing") {
      await transitionVisit({ appointmentId, action: "refund_hold", expectedRevision, session });
    } else if (expectedRevision !== undefined && expectedRevision !== appointment.revision) throw moneyError(409, "Visit changed; refresh before retrying");
    let financial;
    if (original.status === "REFUNDED" && original.refundedMinor === original.amountMinor) {
      const refund = await VirtualRefund.findOne({ paymentId: originalId, status: "COMPLETED" }).sort({ createdAt: -1 }).session(session);
      if (!refund) throw moneyError(409, "Legacy refund completion requires review");
      financial = { refund, replay: true };
    } else financial = await refundInSession({ actorId: appointment.doctor, actorRole: "doctor", originalTransactionId: originalId,
      reason: "appointment-cancellation", idempotencyKey: key }, session);
    const changed = await transitionVisit({ appointmentId, action: "cancel", session, appointmentFields: {
      endedReason: "refunded", "payment.refundId": financial.refund.refundId, "payment.refundedAt": new Date(),
    } });
    return { ...changed, financial, replay: financial.replay };
  };
  let result;
  try { result = await moneyTransaction(apply); }
  catch (error) {
    const recorded = await Appointment.findById(appointmentId).lean();
    if (!recorded?.payment?.refundedAt || recorded.status !== "cancelled") throw error;
    result = await moneyTransaction(apply);
  }
  if (result.financial?.refundTxn && !result.financial.replay) await afterTransferCommit(result.financial.refundTxn);
  return result;
};
export const recoverAppointmentRefunds = async (limit = 25) => {
  const pending = await Appointment.find({ $and: [{ $or: [{ status: "refund_pending" }, { "payment.refundState": "processing" }] }, { $or: [{ "payment.nextRecoveryAt": { $exists: false } }, { "payment.nextRecoveryAt": { $lte: new Date() } }] }] }).sort({ updatedAt: 1 }).limit(limit);
  const counts = { completed: 0, pending: 0 };
  for (const row of pending) { try { await refundAppointment({ appointmentId: row._id }); counts.completed++; } catch { counts.pending++; await Appointment.updateOne({ _id: row._id }, { $set: { "payment.nextRecoveryAt": new Date(Date.now() + 60000) } }); } }
  return counts;
};
