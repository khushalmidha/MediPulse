import crypto from "crypto";
import mongoose from "mongoose";
import Wallet from "../model/wallet.js";
import VirtualTransaction from "../model/virtualTransaction.js";
import PaymentNotification from "../model/paymentNotification.js";
import VirtualRefund from "../model/virtualRefund.js";
import VirtualAnalyticsEvent from "../model/virtualAnalyticsEvent.js";
import { getRedis } from "../services/redis.js";
import { TOPICS, publishVirtualEvent } from "../services/virtualEvents.js";
import { ensureWallet, invalidateWalletCache, refundVirtualPayment, topupWallet, transferVirtualMoney } from "../services/virtualLedger.js";

const MAX_PAGE_SIZE = 50;
const RATE_LIMIT_MAX = Number(process.env.VPAY_RATE_LIMIT_MAX || 30);
const RATE_LIMIT_WINDOW_SEC = Number(process.env.VPAY_RATE_LIMIT_WINDOW_SEC || 60);


const isAdmin = (req) => {
  const allowed = String(process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return req.auth?.role === "user" && allowed.includes(String(req.auth.id));
};

const assertAdmin = (req, res) => {
  if (!isAdmin(req)) {
    res.status(403).json({ message: "Admin access required" });
    return false;
  }
  return true;
};

const parsePagination = (query) => {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, Number(query.limit) || 10));
  const skip = (page - 1) * limit;
  return { page, limit, skip };
};

const walletCacheKey = (userId, userRole) => `wallet:${userRole}:${userId}`;
const isObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const enforceRateLimit = async (req, action) => {
  const redis = getRedis();
  const key = `rate:${action}:${req.auth.role}:${req.auth.id}`;
  const count = await redis.incr(key);
  if (count === 1) {
    await redis.expire(key, RATE_LIMIT_WINDOW_SEC);
  }
  if (count > RATE_LIMIT_MAX) {
    throw new Error("Too many payment requests. Please wait and retry.");
  }
};

const getIdempotencyKey = (req, fallbackPrefix) => {
  const raw =
    req.headers["x-idempotency-key"] ||
    req.body?.requestId;
  if (!raw) {
    throw new Error(`x-idempotency-key header or requestId is required for ${fallbackPrefix}`);
  }
  return `payment:${String(raw).trim()}`;
};

const withIdempotency = async (req, keyPrefix, action) => {
  const redis = getRedis();
  const key = getIdempotencyKey(req, keyPrefix);
  const existing = await redis.get(key);
  if (existing) {
    const parsed = JSON.parse(existing);
    if (parsed.state === "done") {
      return { replay: true, response: parsed.response };
    }
    throw new Error("A request with this idempotency key is already in progress");
  }

  const claimed = await redis.set(key, JSON.stringify({ state: "processing" }), "NX", "EX", 300);
  if (!claimed) {
    throw new Error("Unable to claim idempotency key, retry shortly");
  }

  try {
    const response = await action();
    await redis.set(key, JSON.stringify({ state: "done", response }), "EX", 600);
    return { replay: false, response };
  } catch (error) {
    await redis.del(key);
    throw error;
  }
};


const buildTxnQuery = ({ userId, userRole, query, includeAll = false }) => {
  const filters = {};

  if (!includeAll) {
    filters.$or = [
      { senderId: new mongoose.Types.ObjectId(userId), senderRole: userRole },
      { receiverId: new mongoose.Types.ObjectId(userId), receiverRole: userRole },
    ];
  }

  if (query.type) filters.type = query.type;
  if (query.status) filters.status = query.status;
  if (query.search) {
    filters.$or = [...(filters.$or || []), { transactionId: { $regex: query.search, $options: "i" } }, { referenceId: { $regex: query.search, $options: "i" } }, { description: { $regex: query.search, $options: "i" } }];
  }

  const dateRange = {};
  if (query.fromDate) dateRange.$gte = new Date(query.fromDate);
  if (query.toDate) dateRange.$lte = new Date(query.toDate);
  if (Object.keys(dateRange).length) {
    filters.createdAt = dateRange;
  }

  return filters;
};

const getWalletDashboard = async (req, res) => {
  const actor = { userId: req.auth.id, userRole: req.auth.role };
  const redis = getRedis();
  const cacheKey = walletCacheKey(actor.userId, actor.userRole);
  const cached = await redis.get(cacheKey);
  if (cached) {
    return res.status(200).json(JSON.parse(cached));
  }

  const wallet = await ensureWallet(actor);

  const [recentTransactions, totals] = await Promise.all([
    VirtualTransaction.find({
      $or: [
        { senderId: actor.userId, senderRole: actor.userRole },
        { receiverId: actor.userId, receiverRole: actor.userRole },
      ],
    })
      .sort({ createdAt: -1 })
      .limit(10),
    VirtualTransaction.aggregate([
      {
        $match: {
          status: "SUCCESS",
          $or: [
            { senderId: new mongoose.Types.ObjectId(actor.userId), senderRole: actor.userRole },
            { receiverId: new mongoose.Types.ObjectId(actor.userId), receiverRole: actor.userRole },
          ],
        },
      },
      {
        $group: {
          _id: null,
          totalSent: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$senderId", new mongoose.Types.ObjectId(actor.userId)] },
                    { $eq: ["$senderRole", actor.userRole] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
          totalReceived: {
            $sum: {
              $cond: [
                {
                  $and: [
                    { $eq: ["$receiverId", new mongoose.Types.ObjectId(actor.userId)] },
                    { $eq: ["$receiverRole", actor.userRole] },
                  ],
                },
                "$amount",
                0,
              ],
            },
          },
        },
      },
    ]),
  ]);

  const summary = totals[0] || { totalSent: 0, totalReceived: 0 };
  const payload = {
    wallet,
    summary,
    recentTransactions,
  };

  await redis.set(cacheKey, JSON.stringify(payload), "EX", 20);

  return res.status(200).json(payload);
};

const sendMoney = async (req, res) => {
  const { receiverId, receiverRole = "user", amount, description, referenceId } = req.body;
  if (!receiverId || !amount) {
    return res.status(400).json({ message: "receiverId and amount are required" });
  }
  if (!isObjectId(receiverId)) {
    return res.status(400).json({ message: "Invalid receiver id" });
  }

  try {
    await enforceRateLimit(req, "send");
    const result = await withIdempotency(req, "send", async () => {
      const transaction = await transferVirtualMoney({
        senderId: req.auth.id,
        senderRole: req.auth.role,
        receiverId,
        receiverRole,
        amount,
        type: "PAYMENT",
        description: description || "Peer transfer",
        referenceId: referenceId || `SEND-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        metadata: { channel: "send-money" },
      });
      return { message: "Transfer completed", transaction };
    });

    return res.status(result.replay ? 200 : 201).json(result.response);
  } catch (error) {
    await publishVirtualEvent(TOPICS.paymentsFailed, "payment.failed", {
      senderId: req.auth.id,
      receiverId,
      amount,
      reason: error.message,
    });
    return res.status(400).json({ message: error.message || "Transfer failed" });
  }
};

const topupVirtualFunds = async (req, res) => {
  if (!assertAdmin(req, res)) return;

  const { targetId, targetRole = "user", amount, description } = req.body;
  if (!targetId || !amount) {
    return res.status(400).json({ message: "targetId and amount are required" });
  }
  if (!isObjectId(targetId)) {
    return res.status(400).json({ message: "Invalid target id" });
  }

  try {
    const result = await withIdempotency(req, "topup", async () => {
      const transaction = await topupWallet({
        adminId: req.auth.id,
        targetId,
        targetRole,
        amount,
        description,
      });
      return { message: "Demo funds added", transaction };
    });

    return res.status(result.replay ? 200 : 201).json(result.response);
  } catch (error) {
    return res.status(400).json({ message: error.message || "Top-up failed" });
  }
};

const merchantPayDoctor = async (req, res) => {
  const { doctorId, amount, description, referenceId } = req.body;
  if (!doctorId || !amount) {
    return res.status(400).json({ message: "doctorId and amount are required" });
  }
  if (!isObjectId(doctorId)) {
    return res.status(400).json({ message: "Invalid doctor id" });
  }

  try {
    await enforceRateLimit(req, "doctor-pay");
    const result = await withIdempotency(req, "doctor-pay", async () => {
      const transaction = await transferVirtualMoney({
        senderId: req.auth.id,
        senderRole: req.auth.role,
        receiverId: doctorId,
        receiverRole: "doctor",
        amount,
        type: "PAYMENT",
        description: description || "Doctor consultation payment",
        referenceId: referenceId || `DOCPAY-${Date.now()}-${crypto.randomBytes(3).toString("hex")}`,
        metadata: {
          channel: "merchant",
        },
      });
      return { message: "Doctor payment successful", transaction };
    });

    return res.status(result.replay ? 200 : 201).json(result.response);
  } catch (error) {
    await publishVirtualEvent(TOPICS.paymentsFailed, "payment.failed", {
      senderId: req.auth.id,
      receiverId: doctorId,
      amount,
      reason: error.message,
    });
    return res.status(400).json({ message: error.message || "Doctor payment failed" });
  }
};

const createRefund = async (req, res) => {
  const { transactionId, amount, reason } = req.body;
  if (!transactionId) {
    return res.status(400).json({ message: "transactionId is required" });
  }

  try {
    const idempotencyKey = String(
      req.headers["x-idempotency-key"] || req.body?.requestId || "",
    ).trim();
    if (!idempotencyKey) {
      return res.status(400).json({
        message: "x-idempotency-key header or requestId is required for refund",
      });
    }
    const result = await refundVirtualPayment({
      actorId: req.auth.id,
      actorRole: req.auth.role,
      originalTransactionId: transactionId,
      amount,
      reason,
      isAdmin: isAdmin(req),
      idempotencyKey,
    });

    return res.status(result.replay ? 200 : 201).json({
      message: result.replay ? "Refund replayed" : "Refund processed",
      refund: result.refund,
      originalTransaction: result.original,
      refundTransaction: result.refundTxn,
    });
  } catch (error) {
    return res.status(400).json({ message: error.message || "Refund failed" });
  }
};

const getRefundHistory = async (req, res) => {
  const paging = parsePagination(req.query);
  const relatedTransactions = await VirtualTransaction.find({
    $or: [
      { senderId: req.auth.id, senderRole: req.auth.role },
      { receiverId: req.auth.id, receiverRole: req.auth.role },
    ],
  }).distinct("transactionId");

  const filters = { paymentId: { $in: relatedTransactions } };
  if (req.query.status) filters.status = req.query.status;

  const [items, total] = await Promise.all([
    VirtualRefund.find(filters).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit),
    VirtualRefund.countDocuments(filters),
  ]);

  return res.status(200).json({
    page: paging.page,
    limit: paging.limit,
    total,
    totalPages: Math.ceil(total / paging.limit),
    items,
  });
};

const getTransactionHistory = async (req, res) => {
  const paging = parsePagination(req.query);
  const filters = buildTxnQuery({ userId: req.auth.id, userRole: req.auth.role, query: req.query });

  const [items, total] = await Promise.all([
    VirtualTransaction.find(filters)
      .sort({ createdAt: -1 })
      .skip(paging.skip)
      .limit(paging.limit),
    VirtualTransaction.countDocuments(filters),
  ]);

  return res.status(200).json({
    page: paging.page,
    limit: paging.limit,
    total,
    totalPages: Math.ceil(total / paging.limit),
    items,
  });
};

const exportTransactionHistory = async (req, res) => {
  const filters = buildTxnQuery({ userId: req.auth.id, userRole: req.auth.role, query: req.query });
  const items = await VirtualTransaction.find(filters).sort({ createdAt: -1 }).limit(1000);

  const header = ["transactionId", "type", "status", "amount", "senderId", "receiverId", "referenceId", "createdAt"];
  const rows = items.map((entry) => [
    entry.transactionId,
    entry.type,
    entry.status,
    entry.amount,
    entry.senderId,
    entry.receiverId,
    entry.referenceId || "",
    entry.createdAt.toISOString(),
  ]);
  const csv = [header, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replaceAll("\"", "\"\"")}"`).join(","))
    .join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", "attachment; filename=virtual-transactions.csv");
  return res.status(200).send(csv);
};

const getNotifications = async (req, res) => {
  const paging = parsePagination(req.query);
  const filters = {
    userId: req.auth.id,
    userRole: req.auth.role,
  };
  if (req.query.unreadOnly === "true") filters.isRead = false;

  const [items, total] = await Promise.all([
    PaymentNotification.find(filters).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit),
    PaymentNotification.countDocuments(filters),
  ]);

  return res.status(200).json({
    page: paging.page,
    limit: paging.limit,
    total,
    items,
  });
};

const markNotificationRead = async (req, res) => {
  const { id } = req.params;
  if (!isObjectId(id)) {
    return res.status(400).json({ message: "Invalid notification id" });
  }

  const notification = await PaymentNotification.findOneAndUpdate(
    { _id: id, userId: req.auth.id, userRole: req.auth.role },
    { $set: { isRead: true } },
    { new: true },
  );

  if (!notification) {
    return res.status(404).json({ message: "Notification not found" });
  }

  return res.status(200).json({ message: "Notification marked as read", notification });
};

const getAllWallets = async (req, res) => {
  if (!assertAdmin(req, res)) return;
  const paging = parsePagination(req.query);
  const filters = {};
  if (req.query.status) filters.status = req.query.status;
  if (req.query.userRole) filters.userRole = req.query.userRole;

  const [items, total] = await Promise.all([
    Wallet.find(filters).sort({ updatedAt: -1 }).skip(paging.skip).limit(paging.limit),
    Wallet.countDocuments(filters),
  ]);

  return res.status(200).json({ page: paging.page, limit: paging.limit, total, items });
};

const freezeWallet = async (req, res) => {
  if (!assertAdmin(req, res)) return;
  const { walletId } = req.params;
  if (!isObjectId(walletId)) {
    return res.status(400).json({ message: "Invalid wallet id" });
  }

  const wallet = await Wallet.findByIdAndUpdate(walletId, { $set: { status: "frozen" } }, { new: true });
  if (!wallet) return res.status(404).json({ message: "Wallet not found" });
  return res.status(200).json({ message: "Wallet frozen", wallet });
};

const unfreezeWallet = async (req, res) => {
  if (!assertAdmin(req, res)) return;
  const { walletId } = req.params;
  if (!isObjectId(walletId)) {
    return res.status(400).json({ message: "Invalid wallet id" });
  }

  const wallet = await Wallet.findByIdAndUpdate(walletId, { $set: { status: "active" } }, { new: true });
  if (!wallet) return res.status(404).json({ message: "Wallet not found" });
  return res.status(200).json({ message: "Wallet unfrozen", wallet });
};

const getAdminTransactions = async (req, res) => {
  if (!assertAdmin(req, res)) return;
  const paging = parsePagination(req.query);
  const filters = buildTxnQuery({ query: req.query, includeAll: true });

  const [items, total] = await Promise.all([
    VirtualTransaction.find(filters).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit),
    VirtualTransaction.countDocuments(filters),
  ]);

  return res.status(200).json({ page: paging.page, limit: paging.limit, total, items });
};

const getAdminStats = async (req, res) => {
  if (!assertAdmin(req, res)) return;

  const [
    walletStats,
    txnStats,
    paymentStats,
    refundStats,
    activeUsers,
    mostActiveDoctors,
    dailyTransactionVolume,
    recentAnalyticsEvents,
  ] = await Promise.all([
    Wallet.aggregate([
      { $group: { _id: null, totalMoney: { $sum: "$balance" } } },
    ]),
    VirtualTransaction.aggregate([
      { $match: { type: "PAYMENT", status: { $in: ["SUCCESS", "REFUNDED"] } } },
      { $group: { _id: null, totalPayments: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    VirtualTransaction.countDocuments({ type: "PAYMENT", status: "SUCCESS" }),
    VirtualTransaction.aggregate([
      { $match: { type: "REFUND", status: "SUCCESS" } },
      { $group: { _id: null, totalRefunds: { $sum: "$amount" }, count: { $sum: 1 } } },
    ]),
    Wallet.countDocuments({ status: "active" }),
    VirtualTransaction.aggregate([
      {
        $match: {
          type: "PAYMENT",
          status: { $in: ["SUCCESS", "REFUNDED"] },
          receiverRole: "doctor",
        },
      },
      {
        $group: {
          _id: "$receiverId",
          totalVolume: { $sum: "$amount" },
          paymentCount: { $sum: 1 },
        },
      },
      { $sort: { totalVolume: -1 } },
      { $limit: 5 },
      {
        $lookup: {
          from: "doctors",
          localField: "_id",
          foreignField: "_id",
          as: "doctor",
        },
      },
      {
        $project: {
          doctorId: "$_id",
          totalVolume: 1,
          paymentCount: 1,
          doctorName: {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: [{ $arrayElemAt: ["$doctor.firstName", 0] }, ""] },
                  " ",
                  { $ifNull: [{ $arrayElemAt: ["$doctor.lastName", 0] }, ""] },
                ],
              },
            },
          },
        },
      },
    ]),
    VirtualTransaction.aggregate([
      { $match: { status: "SUCCESS" } },
      {
        $group: {
          _id: {
            $dateToString: { format: "%Y-%m-%d", date: "$createdAt" },
          },
          amount: { $sum: "$amount" },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: -1 } },
      { $limit: 14 },
    ]),
    VirtualAnalyticsEvent.find({}).sort({ occurredAt: -1 }).limit(20),
  ]);

  return res.status(200).json({
    totalVirtualMoneyInCirculation: walletStats[0]?.totalMoney || 0,
    totalPayments: txnStats[0]?.totalPayments || 0,
    totalPaymentCount: paymentStats,
    totalRefunds: refundStats[0]?.totalRefunds || 0,
    totalRefundCount: refundStats[0]?.count || 0,
    activeUsers,
    mostActiveDoctors,
    dailyTransactionVolume: dailyTransactionVolume.reverse(),
    recentAnalyticsEvents,
    revenueSimulation: (txnStats[0]?.totalPayments || 0) - (refundStats[0]?.totalRefunds || 0),
  });
};

const getAdminRefunds = async (req, res) => {
  if (!assertAdmin(req, res)) return;
  const paging = parsePagination(req.query);
  const filters = {};
  if (req.query.status) filters.status = req.query.status;
  if (req.query.paymentId) filters.paymentId = req.query.paymentId;

  const [items, total] = await Promise.all([
    VirtualRefund.find(filters).sort({ createdAt: -1 }).skip(paging.skip).limit(paging.limit),
    VirtualRefund.countDocuments(filters),
  ]);

  return res.status(200).json({
    page: paging.page,
    limit: paging.limit,
    total,
    totalPages: Math.ceil(total / paging.limit),
    items,
  });
};

export {
  createRefund,
  exportTransactionHistory,
  freezeWallet,
  getAdminStats,
  getAdminTransactions,
  getAdminRefunds,
  getAllWallets,
  getNotifications,
  getRefundHistory,
  getTransactionHistory,
  getWalletDashboard,
  markNotificationRead,
  merchantPayDoctor,
  sendMoney,
  topupVirtualFunds,
  unfreezeWallet,
};
