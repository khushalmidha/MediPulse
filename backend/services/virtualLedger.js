import crypto from "crypto";
import mongoose from "mongoose";
import Wallet from "../model/wallet.js";
import VirtualTransaction from "../model/virtualTransaction.js";
import PaymentNotification from "../model/paymentNotification.js";
import VirtualRefund from "../model/virtualRefund.js";
import { getRedis } from "./redis.js";
import { TOPICS, publishVirtualEvent } from "./virtualEvents.js";

const createTransactionId = () =>
  `TXN-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
const createRefundId = () =>
  `RFND-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

const walletCacheKey = (role, userId) => `wallet:${role}:${userId}`;
const walletLockKey = (role, userId) => `lock:wallet:${role}:${userId}`;

const sanitizeAmount = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    throw new Error("Amount must be a positive number");
  }
  return Math.round(numeric * 100) / 100;
};

const normalizeRole = (role) => {
  if (!["user", "doctor"].includes(role)) {
    throw new Error("Invalid wallet role");
  }
  return role;
};

const getInitialWalletBalance = (role) =>
  role === "user" ? Number(process.env.INITIAL_USER_WALLET_BALANCE || 500) : 0;

const ensureWallet = async ({ userId, userRole }, session = null) => {
  const role = normalizeRole(userRole);
  const query = Wallet.findOneAndUpdate(
    { userId, userRole: role },
    {
      $setOnInsert: {
        userId,
        userRole: role,
        balance: getInitialWalletBalance(role),
        currency: "INR",
        status: "active",
        totalSent: 0,
        totalReceived: 0,
      },
    },
    { new: true, upsert: true },
  );

  if (session) {
    query.session(session);
  }

  const wallet = await query;
  const initialBalance = getInitialWalletBalance(role);
  if (
    role === "user" &&
    initialBalance > 0 &&
    wallet.balance === 0 &&
    wallet.totalSent === 0 &&
    wallet.totalReceived === 0
  ) {
    wallet.balance = initialBalance;
    wallet.totalReceived = initialBalance;
    await wallet.save({ session });
  }

  return wallet;
};

const createNotification = async (
  { userId, userRole, type, title, message, transactionId, data = {} },
  session = null,
) => {
  const payload = {
    userId,
    userRole,
    type,
    title,
    message,
    transactionId: transactionId || null,
    data,
  };

  if (session) {
    return PaymentNotification.create([payload], { session });
  }

  const created = await PaymentNotification.create(payload);
  await publishVirtualEvent(TOPICS.notificationsCreated, "notification.created", {
    userId,
    userRole,
    type,
    title,
    message,
    transactionId: transactionId || null,
    data,
  });
  return created;
};

const acquireWalletLocks = async (pairs) => {
  const redis = getRedis();
  const ordered = [...new Set(pairs.map((entry) => `${entry.role}:${entry.userId}`))].sort();
  const acquired = [];

  try {
    for (const pair of ordered) {
      const [role, userId] = pair.split(":");
      const key = walletLockKey(role, userId);
      const token = crypto.randomBytes(8).toString("hex");
      const lock = await redis.set(key, token, "NX", "PX", 5000);
      if (!lock) {
        throw new Error("Payment is currently processing for this wallet, please retry");
      }
      acquired.push({ key, token });
    }
    return acquired;
  } catch (error) {
    for (const lock of acquired.reverse()) {
      await redis.del(lock.key);
    }
    throw error;
  }
};

const releaseWalletLocks = async (locks) => {
  if (!locks?.length) return;
  const redis = getRedis();
  for (const lock of locks.reverse()) {
    await redis.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      lock.key,
      lock.token,
    );
  }
};

const invalidateWalletCache = async (entries) => {
  const redis = getRedis();
  const keys = entries.map((entry) => walletCacheKey(entry.role, entry.userId));
  if (keys.length) {
    await redis.del(...keys);
  }
};

const transferVirtualMoney = async ({
  senderId,
  senderRole,
  receiverId,
  receiverRole,
  amount,
  type,
  description,
  referenceId,
  relatedTransactionId,
  metadata = {},
}) => {
  if (String(senderId) === String(receiverId) && senderRole === receiverRole) {
    throw new Error("Sender and receiver cannot be the same wallet");
  }

  const debitAmount = sanitizeAmount(amount);
  const normalizedSenderRole = normalizeRole(senderRole);
  const normalizedReceiverRole = normalizeRole(receiverRole);
  const txnType = type || "PAYMENT";

  const session = await mongoose.startSession();
  let createdTransaction;
  const locks = await acquireWalletLocks([
    { role: normalizedSenderRole, userId: senderId },
    { role: normalizedReceiverRole, userId: receiverId },
  ]);

  try {
    await session.withTransaction(async () => {
      if (referenceId) {
        const duplicate = await VirtualTransaction.findOne({
          referenceId,
          senderId,
          receiverId,
          type: txnType,
          status: { $in: ["SUCCESS", "REFUNDED"] },
        }).session(session);
        if (duplicate) {
          throw new Error("Duplicate transaction request detected");
        }
      }

      const [senderWallet, receiverWallet] = await Promise.all([
        ensureWallet({ userId: senderId, userRole: normalizedSenderRole }, session),
        ensureWallet({ userId: receiverId, userRole: normalizedReceiverRole }, session),
      ]);

      if (senderWallet.status !== "active" || receiverWallet.status !== "active") {
        throw new Error("One of the wallets is frozen");
      }

      const debitResult = await Wallet.updateOne(
        {
          _id: senderWallet._id,
          status: "active",
          balance: { $gte: debitAmount },
        },
        {
          $inc: {
            balance: -debitAmount,
            totalSent: debitAmount,
          },
        },
        { session },
      );

      if (!debitResult.modifiedCount) {
        throw new Error("Insufficient wallet balance");
      }

      await Wallet.updateOne(
        { _id: receiverWallet._id, status: "active" },
        {
          $inc: {
            balance: debitAmount,
            totalReceived: debitAmount,
          },
        },
        { session },
      );

      const payload = {
        transactionId: createTransactionId(),
        senderId,
        senderRole: normalizedSenderRole,
        receiverId,
        receiverRole: normalizedReceiverRole,
        amount: debitAmount,
        type: txnType,
        status: "SUCCESS",
        description: description || "",
        referenceId: referenceId || null,
        relatedTransactionId: relatedTransactionId || null,
        metadata,
      };

      const created = await VirtualTransaction.create([payload], { session });
      createdTransaction = created[0];

      await createNotification(
        {
          userId: receiverId,
          userRole: normalizedReceiverRole,
          type: txnType === "REFUND" ? "REFUND_RECEIVED" : "PAYMENT_RECEIVED",
          title: txnType === "REFUND" ? "Refund credited" : "Payment received",
          message:
            txnType === "REFUND"
              ? `You received a refund of INR ${debitAmount.toFixed(2)}`
              : `You received INR ${debitAmount.toFixed(2)}`,
          transactionId: payload.transactionId,
          data: { referenceId },
        },
        session,
      );
    });
  } finally {
    await session.endSession();
    await releaseWalletLocks(locks);
  }

  await invalidateWalletCache([
    { role: normalizedSenderRole, userId: senderId },
    { role: normalizedReceiverRole, userId: receiverId },
  ]);

  const eventBase = {
    transactionId: createdTransaction.transactionId,
    senderId,
    senderRole: normalizedSenderRole,
    receiverId,
    receiverRole: normalizedReceiverRole,
    amount: debitAmount,
    type: txnType,
    referenceId: referenceId || null,
    relatedTransactionId: relatedTransactionId || null,
  };

  if (txnType === "REFUND") {
    await publishVirtualEvent(TOPICS.refundsCompleted, "refund.completed", eventBase);
  } else {
    await publishVirtualEvent(TOPICS.paymentsCompleted, "payment.completed", eventBase);
  }

  await publishVirtualEvent(TOPICS.walletUpdated, "wallet.updated", {
    userId: senderId,
    userRole: normalizedSenderRole,
    change: -debitAmount,
    transactionId: createdTransaction.transactionId,
  });
  await publishVirtualEvent(TOPICS.walletUpdated, "wallet.updated", {
    userId: receiverId,
    userRole: normalizedReceiverRole,
    change: debitAmount,
    transactionId: createdTransaction.transactionId,
  });
  await publishVirtualEvent(TOPICS.analyticsEvents, "transaction.recorded", eventBase);

  return createdTransaction;
};

const topupWallet = async ({ adminId, targetId, targetRole, amount, description }) => {
  const creditAmount = sanitizeAmount(amount);
  const role = normalizeRole(targetRole);
  const wallet = await ensureWallet({ userId: targetId, userRole: role });

  if (wallet.status !== "active") {
    throw new Error("Target wallet is frozen");
  }

  await Wallet.updateOne(
    { _id: wallet._id },
    {
      $inc: {
        balance: creditAmount,
        totalReceived: creditAmount,
      },
    },
  );

  const transaction = await VirtualTransaction.create({
    transactionId: createTransactionId(),
    senderId: adminId,
    senderRole: "user",
    receiverId: targetId,
    receiverRole: role,
    amount: creditAmount,
    type: "TOPUP",
    status: "SUCCESS",
    description: description || "Admin demo top-up",
    referenceId: `TOPUP-${Date.now()}-${targetId}`,
    metadata: {
      source: "admin",
    },
  });

  await createNotification({
    userId: targetId,
    userRole: role,
    type: "TOPUP_SUCCESS",
    title: "Top-up received",
    message: `INR ${creditAmount.toFixed(2)} was added to your wallet`,
    transactionId: transaction.transactionId,
  });

  await invalidateWalletCache([{ role, userId: targetId }]);
  await publishVirtualEvent(TOPICS.walletUpdated, "wallet.updated", {
    userId: targetId,
    userRole: role,
    change: creditAmount,
    transactionId: transaction.transactionId,
  });
  await publishVirtualEvent(TOPICS.analyticsEvents, "wallet.topup", {
    transactionId: transaction.transactionId,
    amount: creditAmount,
    targetId,
    targetRole: role,
    adminId,
  });

  return transaction;
};

const refundVirtualPayment = async ({
  actorId,
  actorRole,
  originalTransactionId,
  amount,
  reason,
  isAdmin,
  idempotencyKey,
}) => {
  const original = await VirtualTransaction.findOne({ transactionId: originalTransactionId });
  if (!original) {
    throw new Error("Original transaction not found");
  }

  if (original.type !== "PAYMENT" || original.status !== "SUCCESS") {
    throw new Error("Only successful PAYMENT transactions can be refunded");
  }

  if (!isAdmin && (String(original.receiverId) !== String(actorId) || original.receiverRole !== actorRole)) {
    throw new Error("Only the merchant can refund this payment");
  }

  if (idempotencyKey) {
    const existingRefund = await VirtualRefund.findOne({
      paymentId: original.transactionId,
      idempotencyKey,
    });
    if (existingRefund?.status === "COMPLETED") {
      const existingTxn = await VirtualTransaction.findOne({
        transactionId: existingRefund.refundTransactionId,
      });
      return { original, refundTxn: existingTxn, refund: existingRefund, replay: true };
    }
    if (existingRefund?.status === "CREATED") {
      throw new Error("Refund with this idempotency key is already processing");
    }
  }

  const previousRefunds = await VirtualTransaction.aggregate([
    {
      $match: {
        relatedTransactionId: original.transactionId,
        type: "REFUND",
        status: "SUCCESS",
      },
    },
    {
      $group: {
        _id: null,
        refundedAmount: { $sum: "$amount" },
      },
    },
  ]);
  const alreadyRefunded = previousRefunds[0]?.refundedAmount || 0;

  const duplicateFullRefund = await VirtualTransaction.findOne({
    relatedTransactionId: original.transactionId,
    type: "REFUND",
    status: "SUCCESS",
    amount: original.amount,
  });

  const refundAmount = amount ? sanitizeAmount(amount) : original.amount;
  if (!amount && duplicateFullRefund) {
    throw new Error("Full refund already issued");
  }
  if (alreadyRefunded + refundAmount > original.amount) {
    throw new Error("Refund amount exceeds remaining refundable balance");
  }

  let refund = await VirtualRefund.create({
    refundId: createRefundId(),
    paymentId: original.transactionId,
    amount: refundAmount,
    reason: reason || "Refund issued",
    requestedById: actorId,
    requestedByRole: actorRole,
    idempotencyKey,
  });

  await publishVirtualEvent(TOPICS.refundsCreated, "refund.created", {
    refundId: refund.refundId,
    paymentId: original.transactionId,
    amount: refundAmount,
    requestedById: actorId,
    requestedByRole: actorRole,
  });

  try {
    const refundTxn = await transferVirtualMoney({
      senderId: original.receiverId,
      senderRole: original.receiverRole,
      receiverId: original.senderId,
      receiverRole: original.senderRole,
      amount: refundAmount,
      type: "REFUND",
      description: reason || "Refund issued",
      referenceId: `REFUND-${original.transactionId}-${refund.refundId}`,
      relatedTransactionId: original.transactionId,
      metadata: {
        originalTransactionId: original.transactionId,
        refundId: refund.refundId,
      },
    });

    refund.status = "COMPLETED";
    refund.refundTransactionId = refundTxn.transactionId;
    await refund.save();

    const totalRefunded = alreadyRefunded + refundAmount;
    if (totalRefunded >= original.amount) {
      original.status = "REFUNDED";
    }
    original.metadata = {
      ...(original.metadata || {}),
      refundedAmount: totalRefunded,
      latestRefundTransactionId: refundTxn.transactionId,
    };
    await original.save();

    return { original, refundTxn, refund, replay: false };
  } catch (error) {
    refund.status = "FAILED";
    refund.failureReason = error.message;
    await refund.save();
    throw error;
  }
};

export {
  createNotification,
  ensureWallet,
  invalidateWalletCache,
  refundVirtualPayment,
  sanitizeAmount,
  topupWallet,
  transferVirtualMoney,
};
