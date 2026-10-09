import OutboxJob from "../../model/outboxJob.js";
import QueueRevision from "../../model/queueRevision.js";
import BookingChallenge from "../../model/bookingChallenge.js";
import AuthSession from "../../model/authSession.js";
import { sessionToken } from "../fixtures/sessionToken.js";
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { once } from "node:events";
import mongoose from "mongoose";
import Redis from "ioredis";
import jwt from "jsonwebtoken";
import { localTestTargets } from "../../util/testTargets.js";
import { queueContext, patientKey } from "../../services/queueContext.js";
import { nextTokenNumber } from "../../services/queueBooking.js";
import { transitionVisit } from "../../services/visitTransitions.js";
import { queueModels, inspectQueueMigration, applyQueueMigration, rollbackQueueMigration, assertQueueIndexes } from "../../services/queueMigration.js";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import OpdToken from "../../model/opdToken.js";
import Appointment from "../../model/appointment.js";
import OpdSequence from "../../model/opdSequence.js";
import BookingOperation from "../../model/bookingOperation.js";
import Wallet from "../../model/wallet.js";
import VirtualTransaction from "../../model/virtualTransaction.js";
import VirtualRefund from "../../model/virtualRefund.js";
import PaymentNotification from "../../model/paymentNotification.js";

const targets = localTestTargets(), suffix = crypto.randomBytes(6).toString("hex");
const mongo = new URL(targets.mongo); mongo.pathname = `/medipulse_test_p03_${suffix}`;
const prefix = `medipulse-test:p03:${suffix}:`;
process.env.DATABASE_URL = mongo.href; process.env.USE_REAL_REDIS = "true";
process.env.REDIS_URL = targets.redis; process.env.REDIS_KEY_PREFIX = prefix;
const children = [], origins = [];
let hospital, department, otherDepartment, staffDoctor, receptionist, nurse, platformDoctor, patient, secondPatient;
const key = () => crypto.randomUUID();
const auth = sessionToken;
const request = async (path, record, role, body, method = "POST", requestKey = key(), server = 0) => {
  const response = await fetch(origins[server] + path, { method, signal: AbortSignal.timeout(30000),
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${await auth(record, role)}`, ...(requestKey ? { "Idempotency-Key": requestKey } : {}) },
    ...(method === "GET" ? {} : { body: JSON.stringify(body || {}) }) });
  return { status: response.status, body: await response.json() };
};
const session = async (name) => {
  await Hospital.updateOne({ _id: hospital._id }, { $addToSet: { "settings.queueSessionIds": name } });
  return queueContext({ hospital: await Hospital.findById(hospital._id), doctorId: staffDoctor._id, sessionId: name });
};
const book = (context, requestKey = key(), body = {}, server = 0, actor = patient, assisted = false) => request(
  `/opd/${hospital._id}/${department._id}/${assisted ? "token" : "book"}`, assisted ? receptionist : actor, assisted ? "staff" : "user",
  { doctorId: String(staffDoctor._id), sessionId: context.sessionId, ...body }, "POST", requestKey, server);

before(async () => {
  await mongoose.connect(mongo.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  await Promise.all([OutboxJob, QueueRevision, BookingChallenge,AuthSession, ...queueModels, Wallet, VirtualTransaction, VirtualRefund, PaymentNotification].map((model) => model.createIndexes()));
  hospital = await Hospital.create({ name: "Synthetic Hospital", slug: `fixture-${suffix}`, registrationNumber: `fixture-${suffix}`, type: "clinic",
    email: `hospital-${suffix}@example.invalid`, address: { city: "Fixture", state: "Fixture" }, status: "active" });
  department = await Department.create({ hospitalId: hospital._id, name: "Synthetic OPD", opd: { consultationFee: 0 } });
  otherDepartment = await Department.create({ hospitalId: hospital._id, name: "Synthetic second department", opd: { consultationFee: 0 } });
  platformDoctor = await Doctor.create({ firstName: "Synthetic Doctor", email: `doctor-${suffix}@example.invalid`, password: "synthetic-password", gender: "other",
    experience: { years: 1, expertise: "Fixture" }, consultationFee: 0 });
  staffDoctor = await HospitalStaff.create({ hospitalId: hospital._id, name: "Synthetic Doctor", email: `staff-${suffix}@example.invalid`, role: "DOCTOR",
    departmentIds: [department._id, otherDepartment._id], doctorId: platformDoctor._id, inviteStatus: "accepted", doctorProfile: { consultationFee: 0 } });
  receptionist = await HospitalStaff.create({ hospitalId: hospital._id, name: "Synthetic Reception", email: `reception-${suffix}@example.invalid`, role: "RECEPTIONIST", inviteStatus: "accepted" });
  nurse = await HospitalStaff.create({ hospitalId: hospital._id, name: "Synthetic Nurse", email: `nurse-${suffix}@example.invalid`, role: "NURSE", departmentIds: [department._id], inviteStatus: "accepted" });
  patient = await User.create({ firstName: "Synthetic Patient", email: `patient-${suffix}@example.invalid`, password: "synthetic-password", gender: "other",
    familyMembers: [{ name: "Synthetic child one", relation: "child" }, { name: "Synthetic child two", relation: "child" }] });
  secondPatient = await User.create({ firstName: "Synthetic second patient", email: `patient2-${suffix}@example.invalid`, password: "synthetic-password", gender: "other" });
  for (let i = 0; i < 2; i++) {
    const child = fork(fileURLToPath(new URL("../fixtures/p03-api.mjs", import.meta.url)), [], {
      execArgv: ["--import", new URL("../bootstrap.js", import.meta.url).href], stdio: ["ignore", "ignore", "pipe", "ipc"],
      env: { ...process.env, TEST_DATABASE_URL: mongo.href, TEST_REDIS_URL: targets.redis },
    });
    children.push(child);
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error("Synthetic API startup timed out")); }, 120000);
      child.once("message", (message) => { clearTimeout(timer); resolve(message.port); });
      child.once("exit", () => { clearTimeout(timer); reject(new Error("Synthetic API exited during startup")); });
    });
    origins.push(`http://127.0.0.1:${port}`);
  }
});
after(async () => {
  for (const child of children) if (child.exitCode === null) { const ended = once(child, "exit"); child.send("stop"); await ended; }
  if (mongoose.connection.readyState === 1 && mongoose.connection.db.databaseName === `medipulse_test_p03_${suffix}`) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  const cleanup = new Redis(targets.redis, { connectTimeout: 2000, maxRetriesPerRequest: 0 });
  try { const keys = await cleanup.keys(`${prefix}*`); if (keys.length) await cleanup.del(...keys); } finally { await cleanup.quit(); }
  const { closeRedis } = await import("../../services/redis.js"); await closeRedis();
});

test("simultaneous first sequence upserts assign unique numbers", async () => {
  const context = await session("counter");
  const numbers = await Promise.all(Array.from({ length: 20 }, () => nextTokenNumber(context, hospital._id, staffDoctor._id)));
  assert.equal(new Set(numbers).size, 20); assert.equal(Math.max(...numbers), 20);
});
test("two API processes issue multiple anonymous walk-ins without duplicate numbers", async () => {
  const context = await session("walkins");
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => book(context, key(), { patientInfo: { name: "Identical synthetic walk-in" } }, i % 2, null, true)));
  assert.ok(results.every((result) => result.status === 201), JSON.stringify(results.map((result) => [result.status, result.body.message])));
  assert.equal(new Set(results.map((result) => result.body.token.tokenNumber)).size, 12);
  assert.equal(await OpdToken.countDocuments({ queueKey: context.queueKey }), 12);
});
test("same-key retries across API processes return one resource and reject changed input", async () => {
  const context = await session("retry"), requestKey = key();
  const results = await Promise.all(Array.from({ length: 8 }, (_, i) => book(context, requestKey, {}, i % 2)));
  assert.ok(results.every((result) => [200, 201, 202].includes(result.status)));
  const replay = await book(context, requestKey, {}, 1);
  assert.equal(replay.status, 200); assert.equal(replay.body.replay, true);
  assert.equal(await OpdToken.countDocuments({ queueKey: context.queueKey }), 1);
  assert.equal(await Appointment.countDocuments({ queueKey: context.queueKey }), 1);
  assert.equal((await book(context, requestKey, { chiefComplaint: "Changed synthetic input" })).status, 409);
});
test("different request keys for the same live patient still reserve one visit", async () => {
  const context = await session("patient-duplicate");
  const results = await Promise.all([book(context), book(context, key(), {}, 1)]);
  assert.ok(results.every((result) => [200, 201, 202].includes(result.status)));
  assert.equal(await OpdToken.countDocuments({ queueKey: context.queueKey }), 1);
});
test("two owned family members get separate bookings; another account's member is denied", async () => {
  const context = await session("family");
  const results = await Promise.all(patient.familyMembers.map((family, i) => book(context, key(), { familyMemberId: String(family._id) }, i)));
  assert.deepEqual(results.map((result) => result.status), [201, 201]);
  assert.notEqual(results[0].body.token._id, results[1].body.token._id);
  assert.equal((await book(context, key(), { familyMemberId: String(patient.familyMembers[0]._id) }, 0, secondPatient)).status, 403);
});
test("different departments share a doctor's hospital session numbering", async () => {
  const context = await session("departments");
  const first = await book(context, key(), {}, 0, null, true);
  const second = await request(`/opd/${hospital._id}/${otherDepartment._id}/token`, receptionist, "staff", { doctorId: String(staffDoctor._id), sessionId: context.sessionId });
  assert.equal(first.body.token.tokenNumber, 1); assert.equal(second.body.token.tokenNumber, 2);
});
test("remote reservations cannot receive care until staff check-in; stale revisions are rejected", async () => {
  const context = await session("arrival"), booking = await book(context), token = booking.body.token;
  assert.equal(token.status, "reserved"); assert.equal(token.arrivedAt, undefined);
  assert.equal((await request(`/opd/tokens/${token._id}/start-consultation`, staffDoctor, "staff", {}, "PATCH")).status, 409);
  assert.equal((await request(`/opd/tokens/${token._id}/vitals`, nurse, "staff", { pulse: 77 }, "PATCH")).status, 409);
  const arrived = await request(`/opd/tokens/${token._id}/check-in`, receptionist, "staff", { revision: token.revision }, "PATCH");
  assert.equal(arrived.status, 200); assert.equal(arrived.body.token.status, "waiting"); assert.ok(arrived.body.token.arrivedAt);
  assert.equal((await request(`/opd/tokens/${token._id}/vitals`, nurse, "staff", { pulse: 77, revision: token.revision }, "PATCH")).status, 409);
  const queue = await request(`/opd/${hospital._id}/${staffDoctor._id}/queue?sessionId=${context.sessionId}`, staffDoctor, "staff", null, "GET");
  assert.equal(queue.body.waiting.length, 1); assert.equal(queue.body.reservations.length, 0);
});
test("competing starts across processes leave one active consultation", async () => {
  const context = await session("starts"), first = await book(context, key(), {}, 0, null, true), second = await book(context, key(), {}, 1, null, true);
  const results = await Promise.all([first, second].map((result, i) => request(`/opd/tokens/${result.body.token._id}/start-consultation`, staffDoctor, "staff", {}, "PATCH", key(), i)));
  assert.equal(results.filter((result) => result.status === 200).length, 1);
  assert.equal(results.filter((result) => result.status === 409).length, 1);
  assert.equal(await OpdToken.countDocuments({ queueKey: context.queueKey, status: "in_consultation" }), 1);
});
test("the database active-token index rejects direct competing active writes", async () => {
  const context = await session("active-index");
  const first = await book(context, key(), {}, 0, null, true), second = await book(context, key(), {}, 1, null, true);
  await OpdToken.updateOne({ _id: first.body.token._id }, { $set: { status: "in_consultation" } });
  await assert.rejects(OpdToken.updateOne({ _id: second.body.token._id }, { $set: { status: "in_consultation" } }), { code: 11000 });
});
test("linked start and completion are transactional and completed visits cannot reopen", async () => {
  const context = await session("linked"), booking = await book(context), token = booking.body.token;
  await request(`/opd/tokens/${token._id}/check-in`, receptionist, "staff", {}, "PATCH");
  const started = await request(`/appointment/${booking.body.appointmentId}/start`, platformDoctor, "doctor", {});
  assert.equal(started.status, 200); assert.equal(started.body.endsAt, null);
  assert.equal((await OpdToken.findById(token._id)).status, "in_consultation");
  const done = await request(`/opd/tokens/${token._id}/complete`, staffDoctor, "staff", { notes: "Synthetic clinical draft" }, "PATCH");
  assert.equal(done.status, 200); assert.equal((await Appointment.findById(booking.body.appointmentId)).status, "completed");
  assert.ok(await OutboxJob.exists({ _id: `review:${token._id}`, kind: "review.mail" }));
  for (const action of ["vitals", "no-show", "start-consultation", "complete"]) {
    const actor = action === "vitals" ? nurse : action === "no-show" ? receptionist : staffDoctor;
    assert.equal((await request(`/opd/tokens/${token._id}/${action}`, actor, "staff", {}, "PATCH")).status, 409);
  }
});
test("a linked state mismatch rolls back both records", async () => {
  const context = await session("atomic"), booking = await book(context), token = booking.body.token;
  await request(`/opd/tokens/${token._id}/check-in`, receptionist, "staff", {}, "PATCH");
  await Appointment.updateOne({ _id: booking.body.appointmentId }, { $set: { status: "cancelled" } });
  const result = await request(`/opd/tokens/${token._id}/start-consultation`, staffDoctor, "staff", {}, "PATCH");
  assert.equal(result.status, 409); assert.equal((await OpdToken.findById(token._id)).status, "waiting");
});
test("refund hold blocks consultation start and cancellation synchronizes the linked token", async () => {
  const context = await session("refund-race"), booking = await book(context);
  await request(`/opd/tokens/${booking.body.token._id}/check-in`, receptionist, "staff", {}, "PATCH");
  await transitionVisit({ appointmentId: booking.body.appointmentId, action: "refund_hold" });
  assert.equal((await request(`/appointment/${booking.body.appointmentId}/start`, platformDoctor, "doctor", {})).status, 409);
  await transitionVisit({ appointmentId: booking.body.appointmentId, action: "cancel" });
  assert.equal((await OpdToken.findById(booking.body.token._id)).status, "cancelled");
});
test("independent booking retries cannot debit twice and hospital visits remain a separate queue", async () => {
  await Doctor.updateOne({ _id: platformDoctor._id }, { $set: { consultationFee: 25 } });
  await Wallet.create([{ userId: patient._id, userRole: "user", balance: 1000, initialCreditApplied: true }, { userId: platformDoctor._id, userRole: "doctor", balance: 0 }]);
  const requestKey = key(), path = `/appointment/book/${platformDoctor._id}`;
  const results = await Promise.all([request(path, patient, "user", {}, "POST", requestKey), request(path, patient, "user", {}, "POST", requestKey, 1)]);
  assert.ok(results.every((result) => [200, 201, 202].includes(result.status)));
  const replay = await request(path, patient, "user", {}, "POST", requestKey, 1);
  assert.equal(replay.status, 200); assert.equal(replay.body.amountPaid, 25);
  assert.equal((await Wallet.findOne({ userId: patient._id })).balance, 975);
  assert.equal(await VirtualTransaction.countDocuments({ senderId: patient._id, amount: 25 }), 1);
  assert.match(replay.body.queueKey, /^independent:/);
});
test("future or expired service dates and unknown sessions are rejected", async () => {
  const context = await session("date-boundary");
  assert.equal((await book(context, key(), { serviceDate: "2000-01-01" })).status, 409);
  assert.equal((await book(context, key(), { sessionId: "not-configured" })).status, 400);
  const old = await book(context, key(), {}, 0, null, true);
  await OpdToken.updateOne({ _id: old.body.token._id }, { $set: { serviceDate: "2000-01-01" } });
  assert.equal((await request(`/opd/tokens/${old.body.token._id}/start-consultation`, staffDoctor, "staff", {}, "PATCH")).status, 409);
});
test("aliases of a failed unpaid booking replay the failure and never report a cancelled visit as booked", async () => {
  await Doctor.updateOne({ _id: platformDoctor._id }, { $addToSet: { queueSessionIds: "declined" } });
  await Wallet.create({ userId: secondPatient._id, userRole: "user", balance: 0, initialCreditApplied: true });
  const path = `/appointment/book/${platformDoctor._id}`, keys = [key(), key()];
  const results = await Promise.all(keys.map((requestKey, i) => request(path, secondPatient, "user", { sessionId: "declined" }, "POST", requestKey, i)));
  assert.ok(results.every((result) => [402, 202].includes(result.status)), JSON.stringify(results.map((row) => row.status)));
  for (const requestKey of keys) assert.equal((await request(path, secondPatient, "user", { sessionId: "declined" }, "POST", requestKey)).status, 402);
  assert.equal(await VirtualTransaction.countDocuments({ senderId: secondPatient._id }), 0);
});
test("a paid no-show can be refunded while its clinical state stays terminal", async () => {
  await HospitalStaff.updateOne({ _id: staffDoctor._id }, { $set: { "doctorProfile.consultationFee": 10 } });
  const context = await session("paid-no-show"), booking = await book(context);
  assert.equal(booking.status, 201);
  const tokenId = booking.body.token._id;
  assert.equal((await request(`/opd/tokens/${tokenId}/no-show`, receptionist, "staff", {}, "PATCH")).status, 200);
  const refund = await request(`/appointment/${booking.body.appointmentId}/refund`, patient, "user", {});
  assert.equal(refund.status, 200);
  assert.equal((await OpdToken.findById(tokenId)).status, "no_show");
  assert.equal((await Appointment.findById(booking.body.appointmentId)).status, "cancelled");
  assert.ok((await Appointment.findById(booking.body.appointmentId)).payment.refundedAt);
  assert.equal((await request(`/opd/tokens/${tokenId}/start-consultation`, staffDoctor, "staff", {}, "PATCH")).status, 409);
  await HospitalStaff.updateOne({ _id: staffDoctor._id }, { $set: { "doctorProfile.consultationFee": 0 } });
});
test("a lost response retried after a timezone date boundary replays the original resource", async () => {
  try {
    await Hospital.updateOne({ _id: hospital._id }, { $set: { "settings.timezone": "Pacific/Kiritimati" } });
    const context = await session("midnight-retry"), requestKey = key();
    const first = await book(context, requestKey);
    await Hospital.updateOne({ _id: hospital._id }, { $set: { "settings.timezone": "Etc/GMT+12" } });
    const replay = await book(context, requestKey, {}, 1);
    assert.equal(replay.status, 200); assert.equal(replay.body.token._id, first.body.token._id);
    assert.equal(replay.body.token.serviceDate, first.body.token.serviceDate);
  } finally { await Hospital.updateOne({ _id: hospital._id }, { $set: { "settings.timezone": "Asia/Kolkata" } }); }
});
test("independent active-appointment uniqueness is enforced in MongoDB", async () => {
  const first = await Appointment.findOne({ practiceKey: `independent:${platformDoctor._id}`, user: patient._id });
  const context = Object.fromEntries(["queueKey", "practiceKey", "serviceDate", "sessionId", "timezone"].map((field) => [field, first[field]]));
  const second = await Appointment.create({ ...context, doctor: platformDoctor._id, user: secondPatient._id, personKey: patientKey(secondPatient._id), roomId: key(), status: "queued" });
  await Appointment.updateOne({ _id: first._id }, { $set: { status: "active" } });
  await assert.rejects(Appointment.updateOne({ _id: second._id }, { $set: { status: "active" } }), { code: 11000 });
});
test("index migration dry-run detects corruption without mutating records", async () => {
  const before = await OpdToken.countDocuments({});
  const plan = await inspectQueueMigration();
  assert.ok(plan.issues.includes("linked_state_mismatch"));
  for (const row of plan.tokens.filter((token) => !token.patientId)) {
    assert.equal(row.personKey, (await OpdToken.findById(row._id).lean()).personKey);
  }
  await assert.rejects(applyQueueMigration(mongoose.connection, plan));
  assert.equal(await OpdToken.countDocuments({}), before);
});
test("populated isolated migration detects duplicates, backfills metadata and rehearses guarded rollback", async () => {
  const original = mongoose.connection.name;
  // A separate Mongoose connection is unnecessary: use a separate empty test DB
  // only after stopping the synthetic HTTP writers and restoring the connection.
  for (const child of children) if (child.exitCode === null) { const ended = once(child, "exit"); child.send("stop"); await ended; }
  await mongoose.disconnect();
  const rehearsal = new URL(mongo.href); rehearsal.pathname = `/medipulse_test_p03_rehearsal_${suffix}`;
  try {
    await mongoose.connect(rehearsal.href, { autoIndex: false, autoCreate: false });
    await Hospital.collection.insertOne(hospital.toObject());
    await HospitalStaff.collection.insertOne(staffDoctor.toObject());
    await Department.collection.insertMany([department.toObject(), otherDepartment.toObject()]);
    await Doctor.collection.insertOne(platformDoctor.toObject());
    await User.collection.insertOne(patient.toObject());
    const tokenId = new mongoose.Types.ObjectId(), appointmentId = new mongoose.Types.ObjectId();
    const legacy = { _id: tokenId, hospitalId: hospital._id, departmentId: department._id, doctorId: staffDoctor._id,
      patientId: patient._id, familyMemberId: patient.familyMembers[0]._id, tokenNumber: 1, date: new Date("2026-10-08T18:30:00Z"), status: "waiting", arrivedAt: new Date(), appointmentId };
    await OpdToken.collection.insertMany([legacy, { ...legacy, _id: new mongoose.Types.ObjectId(), patientId: undefined, familyMemberId: undefined, appointmentId: undefined, tokenNumber: 2 }]);
    await Appointment.collection.insertOne({ _id: appointmentId, doctor: platformDoctor._id, user: patient._id, familyMemberId: patient.familyMembers[0]._id, roomId: key(), status: "queued", createdAt: new Date() });
    await OpdToken.collection.createIndex({ hospitalId: 1, departmentId: 1, doctorId: 1, date: 1, tokenNumber: 1 }, { unique: true });
    const duplicateId = new mongoose.Types.ObjectId();
    await OpdToken.collection.insertOne({ ...legacy, _id: duplicateId, departmentId: otherDepartment._id, patientId: undefined, familyMemberId: undefined, appointmentId: undefined, status: "completed" });
    const bad = await inspectQueueMigration(); assert.ok(bad.issues.includes("duplicate_token_number"));
    await assert.rejects(applyQueueMigration(mongoose.connection, bad));
    assert.equal(await OpdToken.countDocuments({ queueKey: { $exists: true } }), 0);
    await OpdToken.collection.deleteOne({ _id: duplicateId });
    const plan = await inspectQueueMigration(); assert.equal(plan.issues.length, 0);
    const run = await applyQueueMigration(mongoose.connection, plan);
    await assert.doesNotReject(assertQueueIndexes());
    const migrated = await OpdToken.findById(tokenId).lean();
    assert.equal(migrated.serviceDate, "2026-10-09");
    assert.equal(migrated.personKey, patientKey(patient._id, patient.familyMembers[0]._id));
    assert.equal(String((await Appointment.findById(appointmentId)).opdTokenId), String(tokenId));
    await Hospital.updateOne({ _id: hospital._id }, { $set: { "settings.timezone": "America/New_York", "settings.queueSessionIds": ["new-session"] } });
    const reinspection = await inspectQueueMigration();
    assert.equal(reinspection.issues.length, 0);
    assert.equal(reinspection.tokens.find((row) => String(row._id) === String(tokenId)).queueKey, migrated.queueKey);
    assert.equal(reinspection.tokens.find((row) => String(row._id) === String(tokenId)).timezone, migrated.timezone);
    await OpdToken.collection.updateOne({ _id: tokenId }, { $set: { diagnosis: "Synthetic later edit" } });
    await assert.rejects(rollbackQueueMigration(mongoose.connection, run), /Data changed/);
    await OpdToken.collection.updateOne({ _id: tokenId }, { $unset: { diagnosis: "" } });
    await rollbackQueueMigration(mongoose.connection, run);
    assert.equal(await OpdToken.countDocuments({}), 2);
    assert.equal(await OpdToken.countDocuments({ queueKey: { $exists: true } }), 0);
    // A populated legacy database cannot use the automatic empty bootstrap.
    const bootstrapPath = fileURLToPath(new URL("../../scripts/bootstrapQueues.js", import.meta.url));
    const { execFileSync } = await import("node:child_process");
    assert.throws(() => execFileSync(process.execPath, [bootstrapPath], { env: { ...process.env, DATABASE_URL: rehearsal.href, API_PROBE_URL: `${origins[0]}/health/live` }, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 }));
    assert.equal(await OpdToken.countDocuments({}), 2);
    await mongoose.connection.dropDatabase();
    execFileSync(process.execPath, [bootstrapPath], { env: { ...process.env, DATABASE_URL: rehearsal.href, API_PROBE_URL: `${origins[0]}/health/live` }, stdio: ["ignore", "pipe", "pipe"], timeout: 60000 });
    await assert.doesNotReject(assertQueueIndexes());
    await mongoose.connection.dropDatabase();
  } finally { await mongoose.disconnect(); await mongoose.connect(mongo.href, { autoIndex: false, autoCreate: false }); assert.equal(mongoose.connection.name, original); }
});
