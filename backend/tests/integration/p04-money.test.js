import OutboxJob from "../../model/outboxJob.js";
import QueueRevision from "../../model/queueRevision.js";
import BookingChallenge from "../../model/bookingChallenge.js";
import AuthSession from "../../model/authSession.js";
import { sessionToken } from "../fixtures/sessionToken.js";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { localTestTargets } from "../../util/testTargets.js";
import { transferVirtualMoney, refundVirtualPayment, topupWallet, ensureWallet } from "../../services/virtualLedger.js";
import { createQueueBooking, recoverBookingOperations } from "../../services/queueBooking.js";
import { refundAppointment, recoverAppointmentRefunds } from "../../services/appointmentRefund.js";
import { inspectMoneyMigration, applyMoneyMigration, rollbackMoneyMigration, assertMoneyReady } from "../../services/moneyMigration.js";
import { queueModels } from "../../services/queueMigration.js";
import { queueContext, patientKey } from "../../services/queueContext.js";
import { getRedis, closeRedis } from "../../services/redis.js";
import Wallet from "../../model/wallet.js";
import VirtualTransaction from "../../model/virtualTransaction.js";
import VirtualRefund from "../../model/virtualRefund.js";
import PaymentNotification from "../../model/paymentNotification.js";
import Appointment from "../../model/appointment.js";
import BookingOperation from "../../model/bookingOperation.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
const targets = localTestTargets(), suffix = crypto.randomBytes(6).toString("hex");
const uri = new URL(targets.mongo); uri.pathname = `/medipulse_test_p04_${suffix}`;
const prefix = `medipulse-test:p04:${suffix}:`;
process.env.DATABASE_URL = uri.href; process.env.USE_REAL_REDIS = "true"; process.env.REDIS_URL = targets.redis; process.env.REDIS_KEY_PREFIX = prefix;
const id = () => new mongoose.Types.ObjectId(), key = () => crypto.randomUUID();
const payer = id(), merchant = id(), other = id();
process.env.ADMIN_USER_IDS = String(payer);
const children = [], origins = [];
const startAPI = async (recover = false) => {
  const child = fork(fileURLToPath(new URL("../fixtures/p03-api.mjs", import.meta.url)), [], {
    execArgv: ["--import", new URL("../bootstrap.js", import.meta.url).href], stdio: ["ignore", "ignore", "pipe", "ipc"],
    env: { ...process.env, TEST_DATABASE_URL: uri.href, TEST_REDIS_URL: targets.redis, RUN_PAYMENT_RECOVERY_ON_START: String(recover) },
  });
  children.push(child);
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error("Isolated API startup timed out")); }, 120000);
    child.once("message", ({ port }) => { clearTimeout(timer); resolve(port); });
    child.once("exit", () => { clearTimeout(timer); reject(new Error("Isolated API startup failed")); });
  });
  return `http://127.0.0.1:${port}`;
};
const http = async (path, body, requestKey = key(), server = 0, actor = payer, role = "user") => {
  const response = await fetch(origins[server] + path, { method: "POST", signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey, Authorization: `Bearer ${await sessionToken({ _id: actor }, role)}` }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() };
};
const balance = async (owner) => (await Wallet.findOne({ userId: owner }).lean()).balanceMinor;
const transfer = (amount, referenceId = key()) => transferVirtualMoney({ senderId: payer, senderRole: "user", receiverId: merchant, receiverRole: "doctor", amount, referenceId });
const refund = (payment, amount, request = key()) => refundVirtualPayment({ actorId: merchant, actorRole: "doctor", originalTransactionId: payment.transactionId, ...(amount !== undefined ? { amount } : {}), idempotencyKey: request });
const booking = (name) => {
  const context = queueContext({ doctorId: merchant, doctor: { queueSessionIds: [name] }, sessionId: name });
  return { request: { actorKey: `patient:${payer}`, kind: "appointment", requestKey: key(), fingerprint: key() }, context, personKey: patientKey(payer), fee: 10.01,
    payerId: payer, receiverId: merchant, appointmentData: { user: payer, doctor: merchant, roomId: key(), visitMode: "online" } };
};
before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  await getRedis().ping();
  await Promise.all([OutboxJob, QueueRevision, BookingChallenge,AuthSession, ...queueModels, Wallet, VirtualTransaction, VirtualRefund, PaymentNotification].map((model) => model.createIndexes()));
  await User.collection.insertMany([payer, other].map((_id) => ({ _id, firstName: "Synthetic", email: `${_id}@example.invalid`, familyMembers: [] })));
  await Doctor.collection.insertOne({ _id: merchant, firstName: "Synthetic", email: `${merchant}@example.invalid`, consultationFee: 10.01, queueSessionIds: ["day"] });
  await Wallet.create([{ userId: payer, userRole: "user", balance: 1000, initialCreditApplied: true }, { userId: merchant, userRole: "doctor", balance: 0 }, { userId: other, userRole: "user", balance: 1000, initialCreditApplied: true }]);
  origins.push(await startAPI(), await startAPI());
});
after(async () => {
  for (const child of children) if (child.exitCode === null) { const ended = once(child, "exit"); child.send("stop"); await ended; }
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === uri.pathname.slice(1)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); await closeRedis();
  const redis = new Redis(targets.redis);
  try { const keys = await redis.keys(`${prefix}*`); if (keys.length) await redis.del(...keys); } finally { await redis.quit(); }
});
test("decimal transfers preserve exact balances and same-reference retries debit once", async () => {
  const before = await balance(payer), reference = key();
  const results = await Promise.all(Array.from({ length: 6 }, () => transfer(0.01, reference)));
  assert.equal(new Set(results.map((txn) => txn.transactionId)).size, 1);
  assert.equal(await balance(payer), before - 1);
  assert.equal(results[0].amountMinor, 1);
  await assert.rejects(transfer(0.02, reference), { status: 409 });
});
test("concurrent distinct partial refunds cannot exceed the original amount", async () => {
  const payment = await transfer(10), before = await balance(payer);
  const results = await Promise.allSettled([refund(payment, 6), refund(payment, 6), refund(payment, 4)]);
  const successful = results.filter((row) => row.status === "fulfilled");
  const total = successful.reduce((sum, row) => sum + row.value.refund.amountMinor, 0);
  assert.ok(total <= 1000); assert.equal(await balance(payer), before + total);
  assert.equal((await VirtualTransaction.findById(payment._id)).refundedMinor, total);
  assert.ok(results.some((row) => row.status === "rejected"));
});
test("completed full refund replays after the original becomes REFUNDED", async () => {
  const payment = await transfer(1.23), request = key();
  const first = await refund(payment, undefined, request), before = await balance(payer);
  const replay = await refund(payment, undefined, request);
  assert.equal(replay.replay, true); assert.equal(replay.refundTxn.transactionId, first.refundTxn.transactionId);
  assert.equal(await balance(payer), before);
  await assert.rejects(refund(payment, 0.01, request), { status: 409 });
  await assert.rejects(refundVirtualPayment({ actorId: other, actorRole: "user", originalTransactionId: payment.transactionId, idempotencyKey: request }), { status: 403 });
});
test("refund failure after wallet movement rolls back balances, accounting and records", async (t) => {
  const payment = await transfer(2), before = await balance(payer), count = await VirtualTransaction.countDocuments({});
  t.mock.method(VirtualRefund, "create", async () => { throw new Error("Synthetic failure after transfer"); });
  await assert.rejects(refund(payment, 1));
  assert.equal(await balance(payer), before); assert.equal(await VirtualTransaction.countDocuments({}), count);
  assert.equal((await VirtualTransaction.findById(payment._id)).refundedMinor, 0);
});
test("post-commit Redis failure cannot turn a successful payment or refund into failure", async (t) => {
  t.mock.method(getRedis(), "del", async () => { throw new Error("Synthetic cache failure"); }); t.mock.method(console, "error", () => {});
  const before = await balance(payer), payment = await transfer(3);
  assert.equal(await balance(payer), before - 300);
  const completed = await refund(payment, 3);
  assert.equal(completed.refund.status, "COMPLETED"); assert.equal(await balance(payer), before);
});
const loseOneCommitAcknowledgement = (t) => {
  const start = mongoose.startSession.bind(mongoose); let lost = false;
  t.mock.method(mongoose, "startSession", async (...args) => {
    const session = await start(...args), commit = session.withTransaction.bind(session);
    session.withTransaction = async (callback) => {
      const result = await commit(callback);
      if (!lost) { lost = true; throw new Error("Synthetic lost commit acknowledgement"); }
      return result;
    };
    return session;
  });
};
test("lost payment commit acknowledgement returns persisted success and never debits twice", async (t) => {
  const reference = key(), before = await balance(payer); loseOneCommitAcknowledgement(t);
  const first = await transfer(0.99, reference), replay = await transfer(0.99, reference);
  assert.equal(first.transactionId, replay.transactionId); assert.equal(await balance(payer), before - 99);
});
test("lost refund commit acknowledgement returns a completed authorized replay", async (t) => {
  const payment = await transfer(0.99), before = await balance(payer); loseOneCommitAcknowledgement(t);
  const result = await refund(payment);
  assert.equal(result.refund.status, "COMPLETED"); assert.equal(await balance(payer), before + 99);
});
test("demo top-up credit, ledger and notification roll back together", async (t) => {
  const before = await balance(payer), count = await VirtualTransaction.countDocuments({});
  t.mock.method(PaymentNotification, "create", async () => { throw new Error("Synthetic notification write failure"); });
  await assert.rejects(topupWallet({ adminId: payer, targetId: payer, targetRole: "user", amount: 5, referenceId: key() }));
  assert.equal(await balance(payer), before); assert.equal(await VirtualTransaction.countDocuments({}), count);
});
test("concurrent first-wallet creation credits a demo wallet exactly once", async () => {
  const owner = id();
  const wallets = await Promise.all(Array.from({ length: 5 }, () => ensureWallet({ userId: owner, userRole: "user" })));
  assert.equal(new Set(wallets.map((row) => String(row._id))).size, 1);
  assert.equal(await balance(owner), 100000);
});
test("HTTP payment keys are persistent across processes and scoped to actor and endpoint", async () => {
  const request = key(), before = await balance(payer), body = { receiverId: String(merchant), receiverRole: "doctor", amount: 1.01 };
  const results = await Promise.all([http("/vpay/send", body, request), http("/vpay/send", body, request, 1)]);
  assert.ok(results.every((row) => [200, 201].includes(row.status)));
  assert.equal(results[0].body.transaction.transactionId, results[1].body.transaction.transactionId);
  assert.equal(await balance(payer), before - 101);
  assert.equal((await http("/vpay/send", { ...body, amount: 2 }, request, 1)).status, 409);
  const otherResult = await http("/vpay/send", body, request, 1, other); assert.equal(otherResult.status, 201);
  const topup = await http("/vpay/wallet/topup", { targetId: String(payer), amount: 1 }, request); assert.equal(topup.status, 201);
  const replay = await http("/vpay/wallet/topup", { targetId: String(payer), amount: 1 }, request, 1); assert.equal(replay.status, 200);
});
test("booking failure after debit commits neither a ledger payment nor appointment", async (t) => {
  const intent = booking("rollback"), before = await balance(payer), count = await VirtualTransaction.countDocuments({});
  const create = t.mock.method(Appointment, "create", async () => { throw new Error("Synthetic resource failure"); });
  const pending = await createQueueBooking(intent);
  assert.equal(pending.operation.state, "reconciliation_required");
  assert.equal(await balance(payer), before); assert.equal(await VirtualTransaction.countDocuments({}), count);
  create.mock.restore();
  await recoverBookingOperations(25, { force: true });
  const operation = await BookingOperation.findById(pending.operation._id);
  assert.equal(operation.state, "completed"); assert.equal(await balance(payer), before - 1001);
});
test("lost demo top-up commit acknowledgement resolves one persisted credit", async (t) => {
  const before = await balance(payer), referenceId = key(); loseOneCommitAcknowledgement(t);
  const input = { adminId: payer, targetId: payer, targetRole: "user", amount: 1, referenceId };
  const first = await topupWallet(input), replay = await topupWallet(input);
  assert.equal(first.transactionId, replay.transactionId); assert.equal(await balance(payer), before + 100);
});
test("lost booking commit acknowledgement resolves the completed operation without another debit", async (t) => {
  const intent = booking("lost-booking-commit"), before = await balance(payer); loseOneCommitAcknowledgement(t);
  const first = await createQueueBooking(intent), replay = await createQueueBooking(intent);
  assert.equal(first.operation.state, "completed"); assert.equal(String(first.appointment._id), String(replay.appointment._id));
  assert.equal(await balance(payer), before - 1001);
});
test("restart recovery resumes a persisted pre-resource intent once in a new API process", async () => {
  const intent = booking("restart"), before = await balance(payer);
  const operation = await BookingOperation.create({ ...intent.request, fee: intent.fee, appointmentId: id(),
    recoveryData: { context: intent.context, personKey: intent.personKey, appointmentData: intent.appointmentData, payerId: payer, receiverId: merchant } });
  const old = children[0], ended = once(old, "exit"); old.send("stop"); await ended;
  origins[0] = await startAPI(true);
  assert.equal((await BookingOperation.findById(operation._id)).state, "completed");
  await recoverBookingOperations(); assert.equal(await balance(payer), before - 1001);
  assert.equal(await VirtualTransaction.countDocuments({ referenceId: `BOOKING-${operation._id}` }), 1);
});
test("legacy committed debit with a provisional appointment is finalized without a second debit", async () => {
  const intent = booking("legacy"), operation = await BookingOperation.create({ ...intent.request, fee: intent.fee, appointmentId: id(), state: "reconciliation_required" });
  await Appointment.create({ ...intent.appointmentData, ...intent.context, personKey: intent.personKey, _id: operation.appointmentId, bookingOperationId: operation._id, status: "booking" });
  await transferVirtualMoney({ senderId: payer, senderRole: "user", receiverId: merchant, receiverRole: "doctor", amount: intent.fee,
    referenceId: `BOOKING-${operation._id}`, description: "Demo consultation booking", metadata: { bookingOperationId: String(operation._id) } });
  const before = await balance(payer); await recoverBookingOperations();
  assert.equal((await BookingOperation.findById(operation._id)).state, "completed"); assert.equal(await balance(payer), before);
});
test("manual and recovery refunds share one identity and clinical cancellation commits with money", async () => {
  const booked = await createQueueBooking(booking("refund")), before = await balance(payer);
  const results = await Promise.all([refundAppointment({ appointmentId: booked.appointment._id }), refundAppointment({ appointmentId: booked.appointment._id })]);
  assert.equal(await balance(payer), before + 1001);
  assert.equal((await Appointment.findById(booked.appointment._id)).status, "cancelled");
  assert.equal(await VirtualRefund.countDocuments({ paymentId: booked.operation.paymentId }), 1);
  assert.ok(results.some((row) => row.replay));
  const replay = await http(`/appointment/${booked.appointment._id}/refund`, {}); assert.equal(replay.status, 200); assert.equal(replay.body.replay, true);
});
test("failed appointment refund leaves clinical eligibility and money unchanged", async (t) => {
  const booked = await createQueueBooking(booking("refund-failure")), before = await balance(payer);
  t.mock.method(VirtualRefund, "create", async () => { throw new Error("Synthetic refund commit failure"); });
  await assert.rejects(refundAppointment({ appointmentId: booked.appointment._id }));
  assert.equal((await Appointment.findById(booked.appointment._id)).status, "queued"); assert.equal(await balance(payer), before);
});
test("competing consultation start and refund commit exactly one eligible outcome", async () => {
  const booked = await createQueueBooking(booking("start-refund-race")), before = await balance(payer);
  const { transitionVisit } = await import("../../services/visitTransitions.js");
  const results = await Promise.allSettled([transitionVisit({ appointmentId: booked.appointment._id, action: "start" }), refundAppointment({ appointmentId: booked.appointment._id })]);
  assert.equal(results.filter((row) => row.status === "fulfilled").length, 1);
  const current = await Appointment.findById(booked.appointment._id);
  assert.ok(["active", "cancelled"].includes(current.status));
  assert.equal(await balance(payer), before + (current.status === "cancelled" ? 1001 : 0));
});
test("legacy refund holds recover after restart without duplicating an already committed refund", async () => {
  const booked = await createQueueBooking(booking("refund-hold"));
  const { transitionVisit } = await import("../../services/visitTransitions.js");
  await transitionVisit({ appointmentId: booked.appointment._id, action: "refund_hold" });
  await refundVirtualPayment({ actorId: merchant, actorRole: "doctor", originalTransactionId: booked.operation.paymentId,
    amount: 10.01, reason: "legacy-manual", idempotencyKey: key() });
  const before = await balance(payer);
  await recoverAppointmentRefunds();
  assert.equal((await Appointment.findById(booked.appointment._id)).status, "cancelled"); assert.equal(await balance(payer), before);
});
test("generic payment refund cannot bypass an appointment's clinical cancellation guard", async () => {
  const booked = await createQueueBooking(booking("guard"));
  const result = await http("/vpay/refund", { transactionId: booked.operation.paymentId }, key(), 0, merchant, "doctor");
  assert.equal(result.status, 409);
});
test("expired persisted intent cannot take payment; an existing debit is compensated once", async () => {
  const context = queueContext({ doctorId: merchant, doctor: { queueSessionIds: ["expired"] }, sessionId: "expired", serviceDate: "2000-01-01", historical: true });
  const unpaid = booking("expired"), paid = booking("expired-paid");
  const make = (intent) => BookingOperation.create({ ...intent.request, fee: intent.fee, appointmentId: id(), recoveryData: {
    context, personKey: intent.personKey, appointmentData: intent.appointmentData, payerId: payer, receiverId: merchant } });
  const first = await make(unpaid), second = await make(paid);
  const before = await balance(payer);
  await transferVirtualMoney({ senderId: payer, senderRole: "user", receiverId: merchant, receiverRole: "doctor", amount: paid.fee,
    referenceId: `BOOKING-${second._id}`, metadata: { bookingOperationId: String(second._id) } });
  await recoverBookingOperations(); await recoverBookingOperations();
  assert.equal(await balance(payer), before);
  assert.equal((await BookingOperation.findById(first._id)).compensationStatus, "none");
  assert.equal((await BookingOperation.findById(second._id)).compensationStatus, "completed");
  const operation = await BookingOperation.findById(second._id);
  assert.equal(operation.state, "failed"); assert.match(operation.errorMessage, /refund completed/);
  assert.equal(await Appointment.countDocuments({ _id: { $in: [first.appointmentId, second.appointmentId] } }), 0);
});
test("failed expired-booking compensation stays pending and retries without claiming a refund", async () => {
  const context = queueContext({ doctorId: merchant, doctor: { queueSessionIds: ["expired-held"] }, sessionId: "expired-held", serviceDate: "2000-01-01", historical: true });
  const intent = booking("expired-held"), before = await balance(payer);
  const operation = await BookingOperation.create({ ...intent.request, fee: intent.fee, appointmentId: id(), recoveryData: {
    context, personKey: intent.personKey, appointmentData: intent.appointmentData, payerId: payer, receiverId: merchant } });
  await transferVirtualMoney({ senderId: payer, senderRole: "user", receiverId: merchant, receiverRole: "doctor", amount: intent.fee, referenceId: `BOOKING-${operation._id}` });
  try {
    await Wallet.updateOne({ userId: merchant }, { $set: { status: "frozen" } });
    await recoverBookingOperations(25, { force: true });
    const pending = await BookingOperation.findById(operation._id);
    assert.equal(pending.state, "reconciliation_required"); assert.equal(pending.compensationStatus, "pending");
    assert.equal(await balance(payer), before - 1001);
  } finally { await Wallet.updateOne({ userId: merchant }, { $set: { status: "active" } }); }
  await recoverBookingOperations(25, { force: true });
  assert.equal((await BookingOperation.findById(operation._id)).compensationStatus, "completed");
  assert.equal(await balance(payer), before);
});
test("populated ledger migration detects conflicts, repairs committed refund accounting and guards rollback", async () => {
  const legacyPayer = id(), legacyMerchant = id(), paymentId = key(), refundId = key(), refundTxnId = key();
  await Wallet.collection.insertOne({ userId: legacyPayer, userRole: "user", balance: 0.1 + 0.2, totalSent: 0, totalReceived: 0, status: "active" });
  const legacy = { transactionId: paymentId, senderId: legacyPayer, senderRole: "user", receiverId: legacyMerchant, receiverRole: "doctor", amount: 2, type: "PAYMENT", status: "SUCCESS", referenceId: key() };
  await VirtualTransaction.collection.insertMany([legacy, { transactionId: refundTxnId, senderId: legacyMerchant, senderRole: "doctor", receiverId: legacyPayer, receiverRole: "user",
    amount: 1, type: "REFUND", status: "SUCCESS", relatedTransactionId: paymentId, referenceId: key(), metadata: { refundId } }]);
  await VirtualRefund.collection.insertOne({ refundId, paymentId, amount: 1, reason: "legacy", status: "FAILED", requestedById: legacyMerchant, requestedByRole: "doctor" });
  const corruptId = id(); await VirtualTransaction.collection.insertOne({ ...legacy, _id: corruptId, transactionId: key(), referenceId: key(), amount: 1.001 });
  const bad = await inspectMoneyMigration(); assert.ok(bad.issues.includes("invalid_ledger_or_refund_total"));
  await assert.rejects(applyMoneyMigration(mongoose.connection, bad)); await VirtualTransaction.collection.deleteOne({ _id: corruptId });
  const plan = await inspectMoneyMigration(); assert.equal(plan.issues.length, 0, JSON.stringify(plan.summary.issues));
  const run = await applyMoneyMigration(mongoose.connection, plan); await assertMoneyReady();
  assert.equal((await VirtualTransaction.findOne({ transactionId: paymentId })).refundedMinor, 100);
  assert.equal((await VirtualRefund.findOne({ refundId })).status, "COMPLETED");
  assert.equal((await Wallet.findOne({ userId: legacyPayer })).balanceMinor, 30);
  await Wallet.collection.updateOne({ userId: legacyPayer }, { $set: { balance: 1 } });
  await assert.rejects(rollbackMoneyMigration(mongoose.connection, run), /Data changed/);
  await Wallet.collection.updateOne({ userId: legacyPayer }, { $set: { balance: 0.3 } });
  await rollbackMoneyMigration(mongoose.connection, run);
  const restored = await VirtualRefund.collection.findOne({ refundId }); assert.equal(restored.status, "FAILED"); assert.equal(restored.amountMinor, undefined);
});
