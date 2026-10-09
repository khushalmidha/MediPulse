import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import { createServer } from "node:http";
import { once } from "node:events";
import { createRequire } from "node:module";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { localTestTargets } from "../../util/testTargets.js";
import { sessionToken } from "../fixtures/sessionToken.js";
import { initSocket } from "../../socket.js";
import routes from "../../routes/appointment.js";
import { enqueueJob, claimJob, runOutboxBatch } from "../../services/outbox.js";
import { deliverOutboxJob } from "../../services/outboxDelivery.js";
import { createQueueBooking } from "../../services/queueBooking.js";
import { transitionVisit } from "../../services/visitTransitions.js";
import { refundAppointment } from "../../services/appointmentRefund.js";
import { queueContext, patientKey } from "../../services/queueContext.js";
import { queueBookingOtp, verifyBookingOtp, proofId } from "../../services/bookingAuthorization.js";
import { importLegacyReviewJobs } from "../../services/reviewRequestWorker.js";
import { processDueConsultationDeadlines, processDueAutoRefunds } from "../../controller/appointment.js";
import { getRedis, closeRedis } from "../../services/redis.js";
import { applyDurableSchema, inspectDurableSchema } from "../../services/durableSchema.js";
import OutboxJob from "../../model/outboxJob.js";
import QueueRevision from "../../model/queueRevision.js";
import BookingChallenge from "../../model/bookingChallenge.js";
import AuthSession from "../../model/authSession.js";
import AuthChallenge from "../../model/authChallenge.js";
import Appointment from "../../model/appointment.js";
import BookingOperation from "../../model/bookingOperation.js";
import OpdToken from "../../model/opdToken.js";
import OpdSequence from "../../model/opdSequence.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import Hospital from "../../model/hospital.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import Wallet from "../../model/wallet.js";
import VirtualTransaction from "../../model/virtualTransaction.js";
import VirtualRefund from "../../model/virtualRefund.js";
import PaymentNotification from "../../model/paymentNotification.js";
const { io: client } = createRequire(new URL("../../../frontend/package.json", import.meta.url))("socket.io-client");
const targets = localTestTargets(), suffix = crypto.randomBytes(6).toString("hex"), uri = new URL(targets.mongo);
uri.pathname = `/medipulse_test_p06_${suffix}`;
process.env.DATABASE_URL = uri.href; process.env.USE_REAL_REDIS = "false";
let patient, doctor, outsider, server, io, origin;
const clients = [], key = () => crypto.randomUUID(), exec = promisify(execFile);
const book = async (fee = 0) => {
  const context = queueContext({ doctorId: doctor._id, doctor: { queueSessionIds: ["day"] } });
  await Appointment.updateMany({ status: { $in: ["queued", "active", "refund_pending"] } }, { $set: { status: "completed" } });
  return createQueueBooking({ request: { actorKey: `patient:${patient._id}`, kind: "appointment", requestKey: key(), fingerprint: key() }, context,
    personKey: patientKey(patient._id), fee, payerId: patient._id, receiverId: doctor._id,
    appointmentData: { user: patient._id, doctor: doctor._id, roomId: key(), visitMode: "online" } });
};
const http = async (path, record = patient, role = "user", body) => {
  const response = await fetch(origin + path, { method: body ? "POST" : "GET", headers: { "Content-Type": "application/json",
    Authorization: `Bearer ${await sessionToken(record, role)}` }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
};
const connect = async (record, role) => {
  const socket = client(origin, { transports: ["websocket"], reconnection: false, auth: { token: await sessionToken(record, role) },
    extraHeaders: { Origin: "https://medipulse.live" } }); clients.push(socket);
  await new Promise((resolve, reject) => { socket.once("connect", resolve); socket.once("connect_error", reject); });
  return socket;
};
const call = (socket, event, payload) => new Promise((resolve, reject) => socket.timeout(4000).emit(event, payload, (error, result) => error ? reject(error) : resolve(result)));
before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  await Promise.all([AuthSession, AuthChallenge, Appointment, BookingOperation, OpdToken, OpdSequence, User, Doctor, HospitalStaff, Hospital, Wallet, VirtualTransaction, VirtualRefund, PaymentNotification].map(Model => Model.createIndexes()));
  await applyDurableSchema();
  patient = await User.create({ firstName: "Synthetic Patient", email: `${key()}@example.invalid`, password: "synthetic-password", gender: "other", familyMembers: [{ name: "Synthetic child", relation: "child" }] });
  outsider = await User.create({ firstName: "Synthetic Outsider", email: `${key()}@example.invalid`, password: "synthetic-password", gender: "other" });
  doctor = await Doctor.create({ firstName: "Synthetic Doctor", email: `${key()}@example.invalid`, password: "synthetic-password", gender: "other", experience: { years: 1, expertise: "Fixture" }, consultationFee: 0 });
  const app = express(); app.use(express.json(), cookieParser()); app.use("/appointment", routes);
  app.use((error, req, res, next) => res.status(error.status || 500).json({ message: "Fixture failed" }));
  server = createServer(app); io = initSocket(server); server.listen(0, "127.0.0.1"); await once(server, "listening"); origin = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(async () => { for (const socket of clients.splice(0)) socket.disconnect(); await OutboxJob.deleteMany({}); await BookingChallenge.deleteMany({}); delete process.env.CONSULTATION_DURATION_MINUTES; });
after(async () => {
  for (const socket of clients) socket.disconnect(); if (io) await new Promise(resolve => io.close(resolve));
  if (mongoose.connection.name === uri.pathname.slice(1)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); await closeRedis();
});

test("deduplicated jobs share the Mongo workflow transaction and rollback together", async () => {
  await Promise.all(Array.from({ length: 10 }, () => enqueueJob({ id: "same", kind: "fixture", payload: { demo: true } })));
  assert.equal(await OutboxJob.countDocuments({ _id: "same" }), 1);
  const session = await mongoose.startSession();
  try { await assert.rejects(session.withTransaction(async () => { await enqueueJob({ id: "rollback", kind: "fixture" }, session); throw new Error("rollback"); })); }
  finally { await session.endSession(); }
  assert.equal(await OutboxJob.countDocuments({ _id: "rollback" }), 0);
});
test("only one parallel worker claims a job and a crashed lease is recovered after reconnect", async () => {
  const now = new Date(); await enqueueJob({ id: "lease", kind: "fixture", availableAt: now });
  const claims = await Promise.all(Array.from({ length: 12 }, () => claimJob({ now, leaseMs: 1000 })));
  const old = claims.find(Boolean); assert.equal(claims.filter(Boolean).length, 1);
  await mongoose.disconnect(); await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false });
  assert.equal(await claimJob({ now: new Date(now.getTime() + 500) }), null);
  const recovered = await claimJob({ now: new Date(now.getTime() + 1001) });
  assert.notEqual(recovered.leaseToken, old.leaseToken); assert.equal(recovered.attempts, 2);
  const stale = await OutboxJob.updateOne({ _id: old._id, leaseToken: old.leaseToken }, { $set: { state: "delivered" } }); assert.equal(stale.modifiedCount, 0);
});
test("provider failure backs off, becomes visible as failed, and fences a successor lease", async () => {
  await enqueueJob({ id: "retry", kind: "fixture" });
  let now = new Date(Date.now() + 10);
  let result = await runOutboxBatch(async () => { throw new Error("synthetic-private-otp-provider-error"); }, { now: () => now, maxAttempts: 2 });
  assert.equal(result.retried, 1); const pending = await OutboxJob.findById("retry").lean();
  assert.equal(pending.state, "pending"); assert.ok(pending.availableAt > now); assert.equal(pending.lastError, "delivery_failed");
  now = new Date(pending.availableAt.getTime() + 1); result = await runOutboxBatch(async () => { throw new Error("failure"); }, { now: () => now, maxAttempts: 2 });
  assert.equal(result.failed, 1); assert.equal((await OutboxJob.findById("retry")).state, "failed");
  await enqueueJob({ id: "fenced", kind: "fixture" });
  await runOutboxBatch(async job => { await OutboxJob.updateOne({ _id: job._id }, { $set: { leaseToken: "successor" } }); }, { limit: 1 });
  assert.equal((await OutboxJob.findById("fenced")).state, "processing");
});
test("booking survives mail outage with one durable confirmation and replay adds no jobs", async () => {
  const booking = await book(); const id = String(booking.appointment._id);
  assert.ok(await OutboxJob.exists({ kind: "visit.mail", "payload.appointmentId": id }));
  await OutboxJob.updateMany({ kind: "visit.notification" }, { $set: { state: "delivered" } });
  const result = await runOutboxBatch(job => deliverOutboxJob(job, io)); assert.equal(result.retried, 1);
  assert.equal((await Appointment.findById(id)).status, "queued");
  const { resumeQueueBooking } = await import("../../services/queueBooking.js"); await resumeQueueBooking(booking.operation._id);
  assert.equal(await OutboxJob.countDocuments({ kind: "visit.mail", "payload.appointmentId": id }), 1);
});
test("booking OTP success confirms encrypted durable enqueue; wrong guesses keep a fixed expiry", async () => {
  process.env.SMTP_HOST = "fixture.invalid"; process.env.SMTP_PORT = "465"; process.env.SMTP_USER = "fixture@example.invalid"; process.env.SMTP_PASS = "synthetic";
  const oldDelivery = process.env.MAIL_DELIVERY; process.env.MAIL_DELIVERY = "enabled";
  try {
    const result = await http(`/appointment/otp/send/${doctor._id}`, patient, "user", { familyMemberId: String(patient.familyMembers[0]._id) });
    assert.equal(result.status, 200); assert.equal(result.body.deliveryStatus, "queued");
    const job = await OutboxJob.findOne({ kind: "booking.otp" }).lean(); assert.equal(job.secret, undefined);
    assert.equal(job.payload.otp, undefined); assert.equal(job.payload.email, undefined);
  } finally { process.env.MAIL_DELIVERY = oldDelivery; for (const key of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"]) delete process.env[key]; }
  await queueBookingOtp({ userId: patient._id, doctorId: doctor._id, to: patient.email, otp: "123456" });
  const challenge = await BookingChallenge.findOne({ userId: patient._id, familyMemberId: "" }).lean(), expiry = challenge.expiresAt.getTime();
  await Promise.allSettled(Array.from({ length: 12 }, () => verifyBookingOtp({ userId: patient._id, doctorId: doctor._id, otp: "999999" })));
  const after = await BookingChallenge.findById(challenge._id); assert.equal(after.attempts, 5); assert.equal(after.expiresAt.getTime(), expiry);
});
test("OTP verification is consumed once under racing requests and stale jobs are skipped", async () => {
  await queueBookingOtp({ userId: patient._id, doctorId: doctor._id, to: patient.email, otp: "123456" });
  const results = await Promise.allSettled(Array.from({ length: 8 }, () => verifyBookingOtp({ userId: patient._id, doctorId: doctor._id, otp: "123456" })));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const delivery = await runOutboxBatch(job => deliverOutboxJob(job, io)); assert.equal(delivery.skipped, 1);
  assert.equal((await OutboxJob.findOne({ kind: "booking.otp" }).select("+secret")).secret, undefined);
});
test("a verified proof is consumed by the booking transaction and cannot authorize a second visit", async () => {
  await queueBookingOtp({ userId: patient._id, doctorId: doctor._id, to: patient.email, otp: "123456" });
  const token = await verifyBookingOtp({ userId: patient._id, doctorId: doctor._id, otp: "123456" });
  await Appointment.updateMany({ status: { $in: ["queued", "active"] } }, { $set: { status: "completed" } });
  const context = queueContext({ doctorId: doctor._id, doctor: { queueSessionIds: ["day"] } });
  const input = { request: { actorKey: `patient:${patient._id}`, kind: "appointment", requestKey: key(), fingerprint: key() }, context,
    personKey: patientKey(patient._id), fee: 0, payerId: patient._id, receiverId: doctor._id, bookingProofId: proofId(token),
    appointmentData: { user: patient._id, doctor: doctor._id, roomId: key(), visitMode: "online" } };
  const first = await createQueueBooking(input); assert.equal(first.operation.state, "completed");
  assert.ok((await BookingChallenge.findById(proofId(token))).consumedAt);
  await Appointment.updateOne({ _id: first.appointment._id }, { $set: { status: "completed" } });
  await assert.rejects(createQueueBooking({ ...input, request: { ...input.request, requestKey: key() } }), error => error.status === 401);
});
test("outbox write failure rolls back clinical and payment writes before durable recovery", async t => {
  const before = await Wallet.findOne({ userId: patient._id }).lean();
  const update = t.mock.method(OutboxJob, "updateOne", async () => { throw new Error("Synthetic durable write failure"); });
  const pending = await book(20); assert.equal(pending.operation.state, "reconciliation_required");
  assert.equal(pending.appointment, null);
  assert.equal(await VirtualTransaction.countDocuments({ referenceId: `BOOKING-${pending.operation._id}` }), 0);
  const after = await Wallet.findOne({ userId: patient._id }).lean(); assert.equal(after?.balanceMinor, before?.balanceMinor);
  update.mock.restore(); const { resumeQueueBooking } = await import("../../services/queueBooking.js");
  const recovered = await resumeQueueBooking(pending.operation._id); assert.equal(recovered.operation.state, "completed");
  assert.ok(await OutboxJob.exists({ kind: "visit.mail", "payload.appointmentId": String(recovered.appointment._id) }));
});
test("refund notifications and visit revisions commit with their transitions", async () => {
  const booking = await book(20); await refundAppointment({ appointmentId: booking.appointment._id });
  assert.equal((await Appointment.findById(booking.appointment._id)).status, "cancelled");
  assert.ok(await OutboxJob.exists({ kind: "visit.mail", "payload.action": "cancel", "payload.appointmentId": String(booking.appointment._id) }));
  const visit = await book(); await transitionVisit({ appointmentId: visit.appointment._id, action: "start" });
  const snapshot = await http("/appointment/doctor/queue", doctor, "doctor");
  assert.equal(snapshot.status, 200); assert.ok(snapshot.body.queueRevision > 0); assert.equal(snapshot.body.activeAppointment.endsAt, null);
  const readyMail = await OutboxJob.findOne({ kind: "visit.mail", "payload.action": "start", "payload.appointmentId": String(visit.appointment._id) }); assert.ok(readyMail);
  await Appointment.updateOne({ _id: visit.appointment._id }, { $set: { status: "completed" } });
  assert.equal((await deliverOutboxJob(readyMail, io)).skipped, true);
  assert.equal((await http("/appointment/doctor/queue", patient)).status, 403);
});
test("persisted consultation/refund deadlines survive reconnect; manual visits remain active", async () => {
  process.env.CONSULTATION_DURATION_MINUTES = "30";
  const visit = await book(); const started = await transitionVisit({ appointmentId: visit.appointment._id, action: "start" });
  assert.ok(started.appointment.consultationDeadline instanceof Date);
  await Appointment.updateOne({ _id: visit.appointment._id }, { $set: { consultationDeadline: new Date(Date.now() - 1000) } });
  await mongoose.disconnect(); await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false });
  await processDueConsultationDeadlines(); assert.equal((await Appointment.findById(visit.appointment._id)).status, "completed");
  delete process.env.CONSULTATION_DURATION_MINUTES;
  const manual = await book(); await transitionVisit({ appointmentId: manual.appointment._id, action: "start" });
  await processDueConsultationDeadlines(new Date(Date.now() + 3600000)); assert.equal((await Appointment.findById(manual.appointment._id)).status, "active");
  const paid = await book(20); await Appointment.updateOne({ _id: paid.appointment._id }, { $set: { refundDueAt: new Date(Date.now() - 1000) } });
  await processDueAutoRefunds(); assert.equal((await Appointment.findById(paid.appointment._id)).status, "cancelled");
});
test("legacy review jobs survive delivery outage after transfer from Redis", async () => {
  const tokenId = new mongoose.Types.ObjectId(), hospitalId = new mongoose.Types.ObjectId();
  await Hospital.collection.insertOne({ _id: hospitalId, name: "Synthetic Hospital" });
  await OpdToken.collection.insertOne({ _id: tokenId, hospitalId, patientId: patient._id, status: "completed", displayToken: "T001" });
  const raw = JSON.stringify({ tokenId: String(tokenId), patientId: String(patient._id), hospitalId: String(hospitalId) });
  await getRedis().zadd("review:request:queue", Date.now() - 1, raw); await importLegacyReviewJobs();
  assert.equal((await getRedis().zrangebyscore("review:request:queue", 0, Date.now())).length, 0);
  const result = await runOutboxBatch(job => deliverOutboxJob(job, io)); assert.equal(result.retried, 1);
  assert.equal((await OutboxJob.findById(`review:${tokenId}`)).state, "pending");
});
test("actual socket participants recover presence; disconnect and patient end preserve the visit", async () => {
  const visit = await book(); await transitionVisit({ appointmentId: visit.appointment._id, action: "start" }); const appointmentId = String(visit.appointment._id);
  const doc = await connect(doctor, "doctor"), user = await connect(patient, "user"), stranger = await connect(outsider, "user");
  assert.equal((await call(stranger, "joinAppointmentRoom", { appointmentId })).ok, false);
  assert.equal((await call(doc, "joinAppointmentRoom", { appointmentId })).ready, false);
  assert.equal((await call(user, "joinAppointmentRoom", { appointmentId })).ready, true);
  assert.equal((await call(user, "appointment:end", { appointmentId })).ok, false);
  const departure = new Promise(resolve => user.once("appointment:presence", resolve)); doc.disconnect();
  assert.equal((await departure).doctorJoined, false); assert.equal((await Appointment.findById(appointmentId)).status, "active");
  const rejoined = await connect(doctor, "doctor"); assert.equal((await call(rejoined, "joinAppointmentRoom", { appointmentId })).ready, true);
  assert.equal((await http(`/appointment/${appointmentId}/call-credentials`, outsider)).status, 403);
  assert.equal((await http(`/appointment/${appointmentId}/call-credentials`, patient)).status, 200);
  await Appointment.updateOne({ _id: appointmentId }, { $set: { status: "completed" } });
  assert.equal((await http(`/appointment/${appointmentId}/call-credentials`, patient)).status, 409);
  assert.equal((await call(user, "joinAppointmentRoom", { appointmentId })).ok, false);
});
test("changed staff permissions invalidate old socket rooms before another packet", async () => {
  const staff = await HospitalStaff.create({ hospitalId: new mongoose.Types.ObjectId(), name: "Synthetic Doctor", email: `${key()}@example.invalid`, role: "DOCTOR", inviteStatus: "accepted" });
  const socket = await connect(staff, "staff");
  await HospitalStaff.updateOne({ _id: staff._id }, { $set: { role: "NURSE" } });
  const departed = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Permission refresh did not disconnect")), 8000);
    socket.once("disconnect", reason => { clearTimeout(timer); resolve(reason); });
  });
  socket.emit("staff:joinHospital", { hospitalId: String(staff.hospitalId) });
  await departed; assert.equal(socket.connected, false);
});
test("schema and legacy deadline CLI rehearse dry-run/apply/rollback with a private backup", async () => {
  assert.equal((await inspectDurableSchema()).ready, true);
  const dir = await mkdtemp(join(tmpdir(), "medipulse-p06-")), env = { ...process.env, DATABASE_URL: uri.href }, backup = join(dir, "deadlines.json");
  const script = file => fileURLToPath(new URL(`../../scripts/${file}`, import.meta.url));
  try {
    const dry = await exec(process.execPath, [script("initDurableSchema.js")], { env }); assert.match(dry.stdout, /"ready":true/);
    const schemaBackup = join(dir, "schema.json");
    await OutboxJob.collection.dropIndex("p06_outbox_claim");
    const unready = await exec(process.execPath, [script("initDurableSchema.js")], { env }); assert.match(unready.stdout, /"ready":false/);
    await exec(process.execPath, [script("initDurableSchema.js"), "--apply", "--writers-paused", "--backup", schemaBackup], { env });
    assert.equal((await inspectDurableSchema()).ready, true);
    await exec(process.execPath, [script("initDurableSchema.js"), "--rollback", "--writers-paused", "--backup", schemaBackup], { env });
    assert.equal((await inspectDurableSchema()).ready, false); await applyDurableSchema();
    await unlink(schemaBackup);
    await BookingChallenge.collection.dropIndex("p06_booking_expiry");
    await BookingChallenge.collection.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 120, name: "p06_booking_expiry" });
    assert.ok((await inspectDurableSchema()).collections.some(item => item.conflicts.includes("p06_booking_expiry")));
    await assert.rejects(exec(process.execPath, [script("initDurableSchema.js"), "--apply", "--writers-paused", "--backup", schemaBackup], { env }));
    await BookingChallenge.collection.dropIndex("p06_booking_expiry"); await applyDurableSchema();
    await enqueueJob({ id: "operator-fixture", kind: "fixture", secret: { otp: "private-fixture-otp", email: "private-fixture@example.invalid" } });
    await OutboxJob.updateOne({ _id: "operator-fixture" }, { $set: { state: "failed", lastError: "delivery_failed" } });
    const jobs = await exec(process.execPath, [script("outboxJobs.js")], { env });
    assert.match(jobs.stdout, /operator-fixture/); assert.doesNotMatch(jobs.stdout, /private-fixture/);
    const retry = await exec(process.execPath, [script("outboxJobs.js"), "--retry", "--id", "operator-fixture"], { env }); assert.match(retry.stdout, /"retried":1/);
    const visit = await book(20); await Appointment.updateOne({ _id: visit.appointment._id }, { $unset: { refundDueAt: "" } });
    const preview = await exec(process.execPath, [script("migrateVisitDeadlines.js")], { env }); assert.match(preview.stdout, /"eligibleLegacyOnlineRefunds":1/);
    assert.equal((await Appointment.findById(visit.appointment._id)).refundDueAt, undefined);
    await exec(process.execPath, [script("migrateVisitDeadlines.js"), "--apply", "--writers-paused", "--backup", backup], { env });
    assert.ok((await Appointment.findById(visit.appointment._id)).refundDueAt);
    await exec(process.execPath, [script("migrateVisitDeadlines.js"), "--rollback", "--writers-paused", "--backup", backup], { env });
    assert.equal((await Appointment.findById(visit.appointment._id)).refundDueAt, undefined);
  } finally { await unlink(backup).catch(() => {}); await unlink(join(dir, "schema.json")).catch(() => {}); await rmdir(dir); }
});
