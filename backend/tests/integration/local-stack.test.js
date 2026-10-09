import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Redis from "ioredis";
import { localTestTargets } from "../../util/testTargets.js";
import { assertMongoTransactions } from "../../services/readiness.js";

const target = localTestTargets();
const suffix = crypto.randomBytes(6).toString("hex"), prefix = `medipulse-test:${suffix}:`;
const mongo = new URL(target.mongo); mongo.pathname = `/medipulse_test_${suffix}`;
process.env.DATABASE_URL = mongo.href;
process.env.USE_REAL_REDIS = "true"; process.env.REDIS_URL = target.redis; process.env.REDIS_KEY_PREFIX = prefix;
const { getRedis, closeRedis } = await import("../../services/redis.js");
const { transferVirtualMoney, refundVirtualPayment } = await import("../../services/virtualLedger.js");
const { default: Wallet } = await import("../../model/wallet.js");
const { default: VirtualTransaction } = await import("../../model/virtualTransaction.js");
const { default: VirtualRefund } = await import("../../model/virtualRefund.js");
const { default: PaymentNotification } = await import("../../model/paymentNotification.js");
const { default: OpdSequence } = await import("../../model/opdSequence.js");
const { default: User } = await import("../../model/user.js");
const { default: OpdToken } = await import("../../model/opdToken.js");
const { default: Department } = await import("../../model/department.js");
const { default: HospitalStaff } = await import("../../model/hospitalStaff.js");
const { resolveBookingIdentity, loadVisit } = await import("../../services/hospitalAccess.js");
let connected = false, redisReady = false;
before(async () => {
  try {
    await mongoose.connect(mongo.href, { serverSelectionTimeoutMS: 3000 }); connected = true;
    await assertMongoTransactions(mongoose.connection); await getRedis().ping(); redisReady = true;
    await Promise.all([Wallet, VirtualTransaction, VirtualRefund, PaymentNotification, OpdSequence, User, OpdToken, Department, HospitalStaff].map((model) => model.createIndexes()));
  } catch { throw new Error("Local MongoDB replica set/Redis unavailable. Start the development Docker stack before running integration tests."); }
});
after(async () => {
  if (connected && mongoose.connection.db.databaseName === `medipulse_test_${suffix}`) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (redisReady) {
    const cleanup = new Redis(target.redis, { connectTimeout: 2000, commandTimeout: 2000, maxRetriesPerRequest: 0 });
    try { const keys = await cleanup.keys(`${prefix}*`); if (keys.length) await cleanup.del(...keys); }
    finally { await cleanup.quit(); }
  }
  await closeRedis();
});

test("virtual transfer and partial refund conserve balances; failed debit creates no ledger entry", async () => {
  const senderId = new mongoose.Types.ObjectId(), receiverId = new mongoose.Types.ObjectId();
  await Wallet.create([{ userId: senderId, userRole: "user", balance: 1000, initialCreditApplied: true }, { userId: receiverId, userRole: "doctor", balance: 0 }]);
  const payment = await transferVirtualMoney({ senderId, senderRole: "user", receiverId, receiverRole: "doctor", amount: 250, referenceId: `fixture-${suffix}` });
  const refund = await refundVirtualPayment({ actorId: receiverId, actorRole: "doctor", originalTransactionId: payment.transactionId, amount: 100, idempotencyKey: `fixture-refund-${suffix}` });
  assert.equal(refund.refund.status, "COMPLETED");
  assert.equal((await Wallet.findOne({ userId: senderId })).balance, 850);
  assert.equal((await Wallet.findOne({ userId: receiverId })).balance, 150);
  const count = await VirtualTransaction.countDocuments({});
  await assert.rejects(transferVirtualMoney({ senderId, senderRole: "user", receiverId, receiverRole: "doctor", amount: 10000 }));
  assert.equal(await VirtualTransaction.countDocuments({}), count);
});

test("real MongoDB atomic OPD counter produces unique numbers under simultaneous requests", async () => {
  const key = { hospitalId: new mongoose.Types.ObjectId(), doctorId: new mongoose.Types.ObjectId(), date: "2026-10-08" };
  await OpdSequence.create({ ...key, seq: 0 });
  const rows = await Promise.all(Array.from({ length: 12 }, () => OpdSequence.findOneAndUpdate(key, { $inc: { seq: 1 } }, { new: true })));
  assert.equal(new Set(rows.map((row) => row.seq)).size, 12);
  assert.equal((await OpdSequence.findOne(key)).seq, 12);
});

test("real database queries enforce family ownership and assigned hospital visit access", async () => {
  const patient = await User.create({ firstName: "Fixture", email: `fixture-${suffix}@example.invalid`, password: "synthetic-local-password", gender: "other", familyMembers: [{ name: "Fixture family", relation: "child" }] });
  const req = { auth: { id: String(patient._id), role: "user" } };
  await assert.doesNotReject(resolveBookingIdentity(req, undefined, patient.familyMembers[0]._id));
  await assert.rejects(resolveBookingIdentity(req, undefined, new mongoose.Types.ObjectId()), { status: 403 });
  const hospitalId = new mongoose.Types.ObjectId();
  const department = await Department.create({ hospitalId, name: "Fixture OPD", opd: { consultationFee: 0 } });
  const doctor = await HospitalStaff.create({ hospitalId, name: "Fixture Doctor", email: `doctor-${suffix}@example.invalid`, role: "DOCTOR", departmentIds: [department._id], inviteStatus: "accepted" });
  const token = await OpdToken.create({ hospitalId, departmentId: department._id, doctorId: doctor._id, patientId: patient._id, tokenNumber: 1, date: new Date(), displayToken: "T001" });
  await assert.doesNotReject(loadVisit({ id: String(doctor._id), role: "DOCTOR", hospitalId: String(hospitalId) }, token._id));
  await assert.rejects(loadVisit({ id: String(new mongoose.Types.ObjectId()), role: "DOCTOR", hospitalId: String(hospitalId) }, token._id), { status: 403 });
});
