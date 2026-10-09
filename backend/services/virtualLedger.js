import crypto from "node:crypto";
import Wallet from "../model/wallet.js";
import VirtualTransaction from "../model/virtualTransaction.js";
import VirtualRefund from "../model/virtualRefund.js";
import PaymentNotification from "../model/paymentNotification.js";
import { getRedis } from "./redis.js";
import { TOPICS, publishVirtualEvent } from "./virtualEvents.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { amountToMinor, fromMinor, fingerprint, moneyError } from "../util/money.js";
export const sanitizeAmount = (value) => fromMinor(amountToMinor(value));
const roleOf = (role) => { if (!["user", "doctor"].includes(role)) throw moneyError(400, "Invalid wallet role"); return role; };
const initialCredit = (role) => role === "user" ? amountToMinor(process.env.INITIAL_USER_WALLET_BALANCE || 5000, { zero: true }) : 0;
export const financialEffects = async (...effects) => {
  for (const effect of effects) { try { await effect(); } catch { console.error("Demo ledger committed; optional delivery needs retry"); } }
};
export const invalidateWalletCache = async (entries) => {
  if (entries.length) await getRedis().del(...entries.map(({ role, userId }) => `wallet:${role}:${userId}`));
};
export const ensureWallet = async (actor, session = null) => {
  if (!session) {
    const wallet = await moneyTransaction((txn) => ensureWallet(actor, txn));
    await financialEffects(() => invalidateWalletCache([{ role: actor.userRole, userId: actor.userId }]));
    return wallet;
  }
  const role = roleOf(actor.userRole), credit = initialCredit(role);
  let wallet = await Wallet.findOneAndUpdate({ userId: actor.userId, userRole: role }, { $setOnInsert: {
    balance: fromMinor(credit), balanceMinor: credit, totalSent: 0, totalSentMinor: 0,
    totalReceived: fromMinor(credit), totalReceivedMinor: credit, currency: "INR", status: "active", initialCreditApplied: credit > 0,
  } }, { upsert: true, new: true, session, setDefaultsOnInsert: false }).lean();
  if (![wallet.balanceMinor, wallet.totalSentMinor, wallet.totalReceivedMinor].every(Number.isSafeInteger)) throw moneyError(409, "Wallet accounting migration is required");
  if (wallet.currency !== "INR" || ["balance", "totalSent", "totalReceived"].some((field) => amountToMinor(wallet[field], { zero: true }) !== wallet[`${field}Minor`])) throw moneyError(409, "Wallet units or accounting require review");
  if (role === "user" && credit && !wallet.initialCreditApplied && wallet.status === "active") {
    wallet = await Wallet.findOneAndUpdate({ _id: wallet._id, initialCreditApplied: { $ne: true }, status: "active" }, [
      { $set: { balanceMinor: { $add: ["$balanceMinor", credit] }, totalReceivedMinor: { $add: ["$totalReceivedMinor", credit] }, initialCreditApplied: true } },
      { $set: { balance: { $divide: ["$balanceMinor", 100] }, totalReceived: { $divide: ["$totalReceivedMinor", 100] } } },
    ], { new: true, session });
    if (!wallet) throw moneyError(409, "Wallet is frozen");
  }
  return wallet;
};
export const createNotification = async (payload, session = null) => {
  if (session) return PaymentNotification.create([payload], { session });
  const created = await PaymentNotification.create(payload);
  await financialEffects(() => publishVirtualEvent(TOPICS.notificationsCreated, "notification.created", payload));
  return created;
};
const changeWallet = async (wallet, minor, debit, session) => {
  const updated = await Wallet.findOneAndUpdate({ _id: wallet._id, status: "active", balanceMinor: debit ? { $gte: minor } : { $lte: 1e12 - minor } }, [
    { $set: { balanceMinor: { $add: ["$balanceMinor", debit ? -minor : minor] },
      [debit ? "totalSentMinor" : "totalReceivedMinor"]: { $add: [debit ? "$totalSentMinor" : "$totalReceivedMinor", minor] } } },
    { $set: { balance: { $divide: ["$balanceMinor", 100] }, totalSent: { $divide: ["$totalSentMinor", 100] }, totalReceived: { $divide: ["$totalReceivedMinor", 100] } } },
  ], { new: true, session });
  if (!updated) throw moneyError(402, debit ? "Insufficient demo wallet balance or frozen wallet" : "Recipient wallet is frozen or exceeds its limit");
};
export const transactionFingerprint = (input, minor = amountToMinor(input.amount)) => fingerprint({
  senderId: String(input.senderId), senderRole: input.senderRole, receiverId: String(input.receiverId), receiverRole: input.receiverRole,
  amountMinor: minor, type: input.type || "PAYMENT", description: input.description || "", relatedTransactionId: input.relatedTransactionId || null, metadata: input.metadata || {},
});
export const transferInSession = async (input, session, { refund = false } = {}) => {
  const minor = amountToMinor(input.amount), type = input.type || "PAYMENT";
  if (!(type === "PAYMENT" || (type === "REFUND" && refund))) throw moneyError(400, "Use the refund service for refunds");
  roleOf(input.senderRole); roleOf(input.receiverRole);
  if (String(input.senderId) === String(input.receiverId) && input.senderRole === input.receiverRole) throw moneyError(400, "Sender and receiver cannot be the same wallet");
  const digest = transactionFingerprint(input, minor);
  if (input.referenceId) {
    const prior = await VirtualTransaction.findOne({ senderId: input.senderId, senderRole: input.senderRole, referenceId: input.referenceId }).session(session);
    if (prior) {
      if (prior.fingerprint !== digest || !["SUCCESS", "REFUNDED"].includes(prior.status)) throw moneyError(409, "Request reference conflicts with an existing transaction");
      return { transaction: prior, replay: true };
    }
  }
  const sender = await ensureWallet({ userId: input.senderId, userRole: input.senderRole }, session);
  const receiver = await ensureWallet({ userId: input.receiverId, userRole: input.receiverRole }, session);
  await changeWallet(sender, minor, true, session);
  await changeWallet(receiver, minor, false, session);
  const [transaction] = await VirtualTransaction.create([{ ...input, amount: fromMinor(minor), amountMinor: minor, refundedMinor: 0,
    transactionId: `TXN-${crypto.randomUUID()}`, type, status: "SUCCESS", fingerprint: digest }], { session });
  await createNotification({ userId: input.receiverId, userRole: input.receiverRole, type: type === "REFUND" ? "REFUND_RECEIVED" : "PAYMENT_RECEIVED",
    title: type === "REFUND" ? "Demo refund credited" : "Demo payment received", message: `${fromMinor(minor).toFixed(2)} demo INR credits received`,
    transactionId: transaction.transactionId, data: { demo: true, referenceId: input.referenceId } }, session);
  return { transaction, replay: false };
};
export const afterTransferCommit = async (txn) => financialEffects(
  () => invalidateWalletCache([{ role: txn.senderRole, userId: txn.senderId }, { role: txn.receiverRole, userId: txn.receiverId }]),
  () => publishVirtualEvent(txn.type === "REFUND" ? TOPICS.refundsCompleted : TOPICS.paymentsCompleted, txn.type === "REFUND" ? "refund.completed" : "payment.completed", txn.toObject()),
  () => publishVirtualEvent(TOPICS.walletUpdated, "wallet.updated", { userId: txn.senderId, userRole: txn.senderRole, change: -txn.amount, transactionId: txn.transactionId }),
  () => publishVirtualEvent(TOPICS.walletUpdated, "wallet.updated", { userId: txn.receiverId, userRole: txn.receiverRole, change: txn.amount, transactionId: txn.transactionId }),
  () => publishVirtualEvent(TOPICS.analyticsEvents, "transaction.recorded", txn.toObject()),
);
export const transferVirtualMoney = async (input) => {
  let result;
  try { result = await moneyTransaction((session) => transferInSession(input, session)); }
  catch (error) {
    const prior = input.referenceId ? await VirtualTransaction.findOne({ senderId: input.senderId, senderRole: input.senderRole, referenceId: input.referenceId }) : null;
    if (!prior || prior.fingerprint !== transactionFingerprint(input) || !["SUCCESS", "REFUNDED"].includes(prior.status)) throw error;
    result = { transaction: prior, replay: true };
  }
  if (!result.replay) await afterTransferCommit(result.transaction);
  result.transaction.$locals.replay = result.replay;
  return result.transaction;
};
export const topupWallet = async ({ adminId, targetId, targetRole, amount, description = "Admin demo top-up", referenceId }) => {
  const minor = amountToMinor(amount); roleOf(targetRole);
  const input = { senderId: adminId, senderRole: "user", receiverId: targetId, receiverRole: targetRole, amount: fromMinor(minor), type: "TOPUP", description, metadata: { source: "admin", demo: true } };
  const digest = transactionFingerprint(input, minor);
  const apply = async (session) => {
    if (referenceId) {
      const prior = await VirtualTransaction.findOne({ senderId: adminId, senderRole: "user", referenceId }).session(session);
      if (prior) { if (prior.fingerprint !== digest) throw moneyError(409, "Top-up request details changed"); return { transaction: prior, replay: true }; }
    }
    const wallet = await ensureWallet({ userId: targetId, userRole: targetRole }, session);
    await changeWallet(wallet, minor, false, session);
    const [transaction] = await VirtualTransaction.create([{ ...input, referenceId, fingerprint: digest, amountMinor: minor, refundedMinor: 0, transactionId: `TXN-${crypto.randomUUID()}`, status: "SUCCESS" }], { session });
    await createNotification({ userId: targetId, userRole: targetRole, type: "TOPUP_SUCCESS", title: "Demo credits added", message: `${fromMinor(minor).toFixed(2)} demo INR credits added`, transactionId: transaction.transactionId }, session);
    return { transaction, replay: false };
  };
  let result;
  try { result = await moneyTransaction(apply); }
  catch (error) {
    const prior = referenceId ? await VirtualTransaction.findOne({ senderId: adminId, senderRole: "user", referenceId }) : null;
    if (!prior || prior.fingerprint !== digest || prior.status !== "SUCCESS") throw error;
    result = { transaction: prior, replay: true };
  }
  if (!result.replay) await financialEffects(() => invalidateWalletCache([{ role: targetRole, userId: targetId }]), () => publishVirtualEvent(TOPICS.analyticsEvents, "wallet.topup", result.transaction.toObject()));
  result.transaction.$locals.replay = result.replay;
  return result.transaction;
};
export const refundInSession = async (input, session) => {
  let original = await VirtualTransaction.findOne({ transactionId: input.originalTransactionId }).session(session).lean();
  if (!original) throw moneyError(404, "Original transaction not found");
  if (!input.isAdmin && (String(original.receiverId) !== String(input.actorId) || original.receiverRole !== input.actorRole)) throw moneyError(403, "Only the merchant can refund this payment");
  const digest = fingerprint({ amount: input.amount === undefined ? "remaining" : amountToMinor(input.amount), reason: input.reason || "Refund issued" });
  const key = input.idempotencyKey || `remaining:${input.actorRole}:${input.actorId}`;
  const prior = await VirtualRefund.findOne({ paymentId: original.transactionId, idempotencyKey: key }).session(session);
  if (prior?.status === "COMPLETED") {
    if (prior.fingerprint !== digest) throw moneyError(409, "Refund request details changed");
    const refundTxn = await VirtualTransaction.findOne({ transactionId: prior.refundTransactionId }).session(session);
    if (!refundTxn) throw moneyError(409, "Refund ledger requires reviewed recovery");
    return { original, refundTxn, refund: prior, replay: true };
  }
  if (prior) throw moneyError(409, "Legacy refund requires reconciliation");
  if (original.type !== "PAYMENT" || original.status !== "SUCCESS") throw moneyError(409, "Only successful payments with remaining balance can be refunded");
  if (!Number.isSafeInteger(original.amountMinor) || !Number.isSafeInteger(original.refundedMinor)) throw moneyError(409, "Ledger migration is required");
  const remaining = original.amountMinor - original.refundedMinor;
  const minor = input.amount === undefined ? remaining : amountToMinor(input.amount);
  if (minor <= 0 || minor > remaining) throw moneyError(409, "Refund amount exceeds remaining refundable balance");
  original = await VirtualTransaction.findOneAndUpdate({ _id: original._id, refundedMinor: original.refundedMinor, status: "SUCCESS" },
    { $inc: { refundedMinor: minor }, $set: { status: minor === remaining ? "REFUNDED" : "SUCCESS", "metadata.refundedAmount": fromMinor(original.refundedMinor + minor) } }, { new: true, session });
  if (!original) throw moneyError(409, "Payment refund state changed");
  const refundId = `RFND-${crypto.randomUUID()}`;
  const moved = await transferInSession({ senderId: original.receiverId, senderRole: original.receiverRole, receiverId: original.senderId, receiverRole: original.senderRole,
    amount: fromMinor(minor), type: "REFUND", description: input.reason || "Refund issued", referenceId: `REFUND-${refundId}`, relatedTransactionId: original.transactionId,
    metadata: { originalTransactionId: original.transactionId, refundId, demo: true } }, session, { refund: true });
  const [refund] = await VirtualRefund.create([{ refundId, paymentId: original.transactionId, amount: fromMinor(minor), amountMinor: minor, fingerprint: digest,
    reason: input.reason || "Refund issued", requestedById: input.actorId, requestedByRole: input.actorRole, idempotencyKey: key, status: "COMPLETED", refundTransactionId: moved.transaction.transactionId }], { session });
  await VirtualTransaction.updateOne({ _id: original._id }, { $set: { "metadata.latestRefundTransactionId": moved.transaction.transactionId } }, { session });
  return { original, refundTxn: moved.transaction, refund, replay: false };
};
export const refundVirtualPayment = async (input) => {
  let result;
  try { result = await moneyTransaction((session) => refundInSession(input, session)); }
  catch (error) {
    const prior = await VirtualRefund.findOne({ paymentId: input.originalTransactionId, idempotencyKey: input.idempotencyKey || `remaining:${input.actorRole}:${input.actorId}`, status: "COMPLETED" });
    if (!prior) throw error;
    // Re-enter the read/replay path so authorization and input validation still run.
    result = await moneyTransaction((session) => refundInSession(input, session));
  }
  if (!result.replay) await afterTransferCommit(result.refundTxn);
  return result;
};
