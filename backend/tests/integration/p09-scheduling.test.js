import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Redis from "ioredis";
import { fork } from "node:child_process";
import { once } from "node:events";
import { fileURLToPath } from "node:url";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { localTestTargets } from "../../util/testTargets.js";
import { sessionToken } from "../fixtures/sessionToken.js";
import { createCareSession, getAvailability, holdCareSlot, confirmCareReservation, cancelCareReservation, rescheduleCareReservation,
  admitCareReservation, getReservation, expireScheduleHolds, setDoctorAbsence, setCareSessionState } from "../../services/scheduling.js";
import { applySchedulingSchema, inspectSchedulingSchema, rollbackSchedulingSchema } from "../../services/schedulingSchema.js";
import { transitionVisit } from "../../services/visitTransitions.js";
import { refundAppointment } from "../../services/appointmentRefund.js";
import { getDoctorQueue } from "../../controller/appointment.js";
import { getDoctorQueue as getHospitalQueue } from "../../controller/opdToken.js";
import { schedulingModels, CareSlot, CareReservation, CareSession } from "../../model/scheduling.js";
import { queueModels } from "../../services/queueMigration.js";
import { moneyModels } from "../../services/moneyMigration.js";
import { durableModels } from "../../services/durableSchema.js";
import { authModels } from "../../services/authSchema.js";
import Doctor from "../../model/doctor.js";
import User from "../../model/user.js";
import Hospital from "../../model/hospital.js";
import Staff from "../../model/hospitalStaff.js";
import Department from "../../model/department.js";
import Appointment from "../../model/appointment.js";
import Token from "../../model/opdToken.js";
import Wallet from "../../model/wallet.js";
import Transaction from "../../model/virtualTransaction.js";
const targets = localTestTargets(), uri = new URL(targets.mongo); uri.pathname = "/medipulse_test_p09_" + crypto.randomBytes(6).toString("hex");
process.env.USE_REAL_REDIS = "false";
const redisPrefix = "medipulse-test:p09:" + uri.pathname.slice(1) + ":";
let doctor, users, hospital, department, staffDoctor, nurse, schemaSnapshot;
const children = [], origins = [];
const key = () => crypto.randomUUID(), id = value => String(value._id || value);
let day = 0;
const body = (extra = {}) => {
  const date = new Date(); date.setUTCDate(date.getUTCDate() + 2 + day++); date.setUTCHours(6, 0, 0, 0);
  return { doctorId: id(doctor), appointmentType: "scheduled_online", startsAt: date.toISOString(), endsAt: new Date(date.getTime() + 3600000).toISOString(), ...extra };
};
const doctorReq = input => ({ auth: { id: id(doctor), role: "doctor" }, body: input, params: {} });
const patientReq = (user = users[0], input = {}, reservation, requestKey = key()) => ({ auth: { id: id(user), role: "user" }, body: input, params: reservation ? { reservationId: id(reservation) } : {}, query: {}, headers: { "idempotency-key": requestKey } });
const slotsFor = session => CareSlot.find({ session: session._id }).sort({ startsAt: 1 }).lean();
const create = extra => createCareSession(doctorReq(body(extra)));
const hold = (slot, user = users[0], extra = {}, requestKey) => holdCareSlot(patientReq(user, { slotId: id(slot), ...extra }, null, requestKey));
const confirm = (held, user = users[0], requestKey) => confirmCareReservation(patientReq(user, {}, held.reservation, requestKey));
const balance = async user => (await Wallet.findOne({ userId: user._id })).balanceMinor;
const invoke = async (fn, req) => { let result; await fn(req, { status() { return this; }, json(value) { result = value; return this; } }); return result; };
before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  await Promise.all([...new Set([...queueModels, ...moneyModels, ...durableModels, ...authModels, Doctor, User, Hospital, Staff, Department])].map(Model => Model.createIndexes()));
  schemaSnapshot = { task: "P09", database: mongoose.connection.name, ...await inspectSchedulingSchema() }; await applySchedulingSchema();
  doctor = await Doctor.create({ firstName: "Synthetic", lastName: "Doctor", email: "doctor@example.invalid", password: "fixture-password", gender: "other", experience: { years: 1, expertise: "General" }, consultationFee: 10 });
  users = await User.create(Array.from({ length: 12 }, (_, n) => ({ firstName: "Synthetic", lastName: "Patient", email: `patient${n}@example.invalid`, password: "fixture-password", gender: "other", familyMembers: [{ name: "Synthetic family", relation: "child" }] })));
  await Wallet.create([...users.map(user => ({ userId: user._id, userRole: "user", balance: 1000, initialCreditApplied: true })), { userId: doctor._id, userRole: "doctor", balance: 0, initialCreditApplied: true }]);
  hospital = await Hospital.create({ name: "Synthetic Hospital", slug: "p09-fixture", registrationNumber: "p09-fixture", email: "hospital@example.invalid", type: "clinic", status: "active", address: { city: "Fixture", state: "Fixture" } });
  department = await Department.create({ hospitalId: hospital._id, name: "Synthetic OPD", code: "GEN", status: "active", opd: { consultationFee: 10 } });
  staffDoctor = await Staff.create({ hospitalId: hospital._id, doctorId: doctor._id, departmentIds: [department._id], name: "Synthetic Doctor", email: "staff@example.invalid", role: "DOCTOR", isActive: true, inviteStatus: "accepted" });
  nurse = { id: id(new mongoose.Types.ObjectId()), hospitalId: id(hospital), role: "NURSE", departmentIds: [id(department)] };
});
after(async () => {
  for (const child of children) if (child.exitCode === null) { const ended = once(child, "exit"); child.send("stop"); await ended; }
  if (mongoose.connection.readyState === 1 && mongoose.connection.name === uri.pathname.slice(1)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  const redis = new Redis(targets.redis); try { const keys = await redis.keys(redisPrefix + "*"); if (keys.length) await redis.del(...keys); } finally { await redis.quit(); }
});
test("additive schema initialization, empty rollback and reapply preserve legacy schema", async () => {
  assert.equal((await inspectSchedulingSchema()).ready, true); await rollbackSchedulingSchema(schemaSnapshot);
  assert.equal((await inspectSchedulingSchema()).ready, false); await applySchedulingSchema(); assert.equal((await inspectSchedulingSchema()).ready, true);
});
test("availability is empty until a real session is configured and excludes breaks", async () => {
  const data = body(); const date = new Date(data.startsAt); const from = date.toISOString().slice(0, 10);
  assert.equal((await getAvailability({ doctorId: id(doctor), from, to: from })).sessions.length, 0);
  data.breaks = [{ startsAt: new Date(date.getTime() + 900000).toISOString(), endsAt: new Date(date.getTime() + 1800000).toISOString() }];
  const care = await createCareSession(doctorReq(data));
  const availability = await getAvailability({ doctorId: id(doctor), from, to: from }); assert.equal(availability.sessions[0].slots.length, 3); assert.equal(availability.sessions[0].slots[0].remaining, 1);
  assert.equal(care.appointmentType, "scheduled_online");
});
test("concurrent overlapping independent and hospital sessions admit only one writer", async () => {
  const data = body();
  const results = await Promise.allSettled([createCareSession(doctorReq(data)), createCareSession({ staff: { id: id(staffDoctor), hospitalId: id(hospital), role: "DOCTOR" }, body: { ...data, doctorId: id(staffDoctor), hospitalId: id(hospital), departmentId: id(department), appointmentType: "hospital_in_person" } })]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1); assert.equal(results.find(row => row.status === "rejected").reason.status, 409);
});
test("session administration rejects patients, other doctors and other hospital staff", async () => {
  const data = body(); await assert.rejects(createCareSession(patientReq(users[0], data)), { status: 403 });
  await assert.rejects(createCareSession({ ...doctorReq(data), auth: { role: "doctor", id: id(users[0]) } }), { status: 403 });
  await assert.rejects(createCareSession({ staff: { role: "HOSPITAL_ADMIN", hospitalId: id(users[0]) }, body: { ...data, doctorId: id(staffDoctor), hospitalId: id(hospital), departmentId: id(department), appointmentType: "hospital_in_person" } }), { status: 403 });
});
test("competing holds never exceed slot capacity", async () => {
  const care = await create({ capacity: 2 }), [slot] = await slotsFor(care);
  const results = await Promise.allSettled(users.slice(0, 8).map(user => hold(slot, user)));
  assert.equal(results.filter(row => row.status === "fulfilled").length, 2); assert.ok(results.filter(row => row.status === "rejected").every(row => row.reason.status === 409));
  assert.equal((await CareSlot.findById(slot._id)).occupied, 2);
});
test("hold retries replay one reservation and reject changed request contents", async () => {
  const care = await create(), slots = await slotsFor(care), requestKey = key();
  const results = await Promise.all(Array.from({ length: 5 }, () => hold(slots[0], users[0], {}, requestKey)));
  assert.equal(new Set(results.map(row => id(row.reservation))).size, 1); assert.equal((await CareSlot.findById(slots[0]._id)).occupied, 1);
  await assert.rejects(hold(slots[1], users[0], {}, requestKey), { status: 409 });
});
test("expired holds release capacity and cannot be confirmed or revived by replay", async () => {
  const care = await create(), [slot] = await slotsFor(care), requestKey = key(), held = await hold(slot, users[0], {}, requestKey);
  const now = new Date(new Date(held.reservation.expiresAt).getTime() + 1);
  assert.ok(await expireScheduleHolds(now) >= 1); assert.equal((await CareSlot.findById(slot._id)).occupied, 0);
  await assert.rejects(confirmCareReservation(patientReq(users[0], {}, held.reservation), now), { status: 409 });
  assert.equal((await hold(slot, users[0], {}, requestKey)).reservation.state, "expired");
  assert.equal((await hold(slot, users[1])).reservation.state, "held");
});
test("confirmation retries debit once, snapshot fees and retain an unarrived reservation", async () => {
  const care = await create(), [slot] = await slotsFor(care), held = await hold(slot), requestKey = key(), prior = await balance(users[0]);
  await Doctor.updateOne({ _id: doctor._id }, { $set: { consultationFee: 12 } });
  const results = await Promise.all(Array.from({ length: 5 }, () => confirm(held, users[0], requestKey)));
  assert.equal(new Set(results.map(row => id(row.appointment))).size, 1); assert.equal(await balance(users[0]), prior - 1000);
  const appointment = await Appointment.findById(results[0].appointment._id); assert.equal(appointment.feeSnapshot.amountMinor, 1000); assert.equal(appointment.admissionState, "reserved"); assert.equal(appointment.refundDueAt, undefined);
  assert.equal(await Transaction.countDocuments({ referenceId: "SCHEDULE-" + id(held.reservation) }), 1);
  await Doctor.updateOne({ _id: doctor._id }, { $set: { consultationFee: 10 } });
  await assert.rejects(rollbackSchedulingSchema(schemaSnapshot), /recover forward/);
});
test("insufficient demo funds leave the hold intact and create no visit or debit", async () => {
  const care = await create(), [slot] = await slotsFor(care), held = await hold(slot, users[10]);
  await Wallet.updateOne({ userId: users[10]._id }, { $set: { balance: 0, balanceMinor: 0 } });
  await assert.rejects(confirm(held, users[10]), { status: 402 });
  assert.equal((await CareReservation.findById(held.reservation._id)).state, "held"); assert.equal(await Transaction.countDocuments({ referenceId: "SCHEDULE-" + id(held.reservation) }), 0);
});
test("patient/family ownership is bound on hold, confirmation and tracking", async () => {
  const care = await create({ capacity: 2 }), [slot] = await slotsFor(care);
  await assert.rejects(hold(slot, users[0], { patientId: id(users[1]) }), { status: 403 });
  await assert.rejects(hold(slot, users[0], { familyMemberId: id(users[1].familyMembers[0]) }), { status: 403 });
  const held = await hold(slot, users[0], { familyMemberId: id(users[0].familyMembers[0]) });
  await assert.rejects(confirm(held, users[1]), { status: 404 }); await assert.rejects(getReservation(patientReq(users[1]), held.reservation._id), { status: 404 });
  assert.equal((await confirm(held)).reservation.familyMemberId.toString(), id(users[0].familyMembers[0]));
});
test("same-patient overlapping holds are fenced while distinct family members remain separate", async () => {
  const care = await create({ capacity: 3 }), [slot] = await slotsFor(care);
  const held = await hold(slot); await assert.rejects(hold(slot), { status: 409 });
  const family = await hold(slot, users[0], { familyMemberId: id(users[0].familyMembers[0]) }); assert.notEqual(id(held.reservation), id(family.reservation));
});
test("cancel retries refund once and release capacity atomically", async () => {
  const care = await create(), [slot] = await slotsFor(care), held = await hold(slot), prior = await balance(users[0]), confirmed = await confirm(held), requestKey = key();
  const results = await Promise.all(Array.from({ length: 4 }, () => cancelCareReservation(patientReq(users[0], {}, confirmed.reservation, requestKey))));
  assert.ok(results.every(row => row.reservation.state === "cancelled")); assert.equal(await balance(users[0]), prior); assert.equal((await CareSlot.findById(slot._id)).occupied, 0);
  assert.equal((await Appointment.findById(confirmed.appointment._id)).payment.refundState, "completed");
});
test("competing reschedules preserve source bookings when target capacity loses", async () => {
  const care = await create(), slots = await slotsFor(care);
  const first = await confirm(await hold(slots[0], users[0]), users[0]), second = await confirm(await hold(slots[1], users[1]), users[1]);
  const prior = [await balance(users[0]), await balance(users[1])];
  const results = await Promise.allSettled([first, second].map((row, index) => rescheduleCareReservation(patientReq(users[index], { slotId: id(slots[2]), revision: row.reservation.revision }, row.reservation))));
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1); assert.equal(results.find(row => row.status === "rejected").reason.status, 409);
  assert.equal((await CareSlot.findById(slots[2]._id)).occupied, 1); assert.deepEqual([await balance(users[0]), await balance(users[1])], prior);
  assert.equal((await CareSlot.findById(slots[0]._id)).occupied + (await CareSlot.findById(slots[1]._id)).occupied, 1);
});
test("reschedule replay succeeds with its original revision and retains payment identity", async () => {
  const care = await create(), slots = await slotsFor(care), confirmed = await confirm(await hold(slots[0])), requestKey = key();
  const req = patientReq(users[0], { slotId: id(slots[1]), revision: confirmed.reservation.revision }, confirmed.reservation, requestKey);
  const moved = await rescheduleCareReservation(req), replay = await rescheduleCareReservation(req);
  assert.equal(replay.replay, true); assert.equal(id(moved.reservation.slotId), id(slots[1])); assert.equal(id(moved.appointment), id(confirmed.appointment));
  await assert.rejects(rescheduleCareReservation(patientReq(users[0], { slotId: id(slots[2]), revision: confirmed.reservation.revision }, confirmed.reservation)), { status: 409 });
});
test("cross-practice and changed-fee reschedules cannot move paid care or consume capacity", async () => {
  const care = await create(), [slot] = await slotsFor(care), confirmed = await confirm(await hold(slot));
  const hospitalCare = await createCareSession({ staff: { ...nurse, role: "HOSPITAL_ADMIN" }, body: { ...body(), hospitalId: id(hospital), departmentId: id(department), doctorId: id(staffDoctor), appointmentType: "hospital_in_person" } });
  const [hospitalSlot] = await slotsFor(hospitalCare);
  await assert.rejects(rescheduleCareReservation(patientReq(users[0], { slotId: id(hospitalSlot), revision: confirmed.reservation.revision }, confirmed.reservation)), { status: 409 });
  await Doctor.updateOne({ _id: doctor._id }, { $set: { consultationFee: 15 } });
  const changedFeeCare = await create(), [changedFeeSlot] = await slotsFor(changedFeeCare);
  await assert.rejects(rescheduleCareReservation(patientReq(users[0], { slotId: id(changedFeeSlot), revision: confirmed.reservation.revision }, confirmed.reservation)), { status: 409 });
  assert.equal((await CareSlot.findById(slot._id)).occupied, 1); assert.equal((await CareSlot.findById(hospitalSlot._id)).occupied, 0); assert.equal((await CareSlot.findById(changedFeeSlot._id)).occupied, 0);
  await Doctor.updateOne({ _id: doctor._id }, { $set: { consultationFee: 10 } });
});
test("rescheduling into another session updates the queue identity without charging again", async () => {
  const source = await create(), target = await create(), [first] = await slotsFor(source), [second] = await slotsFor(target);
  const confirmed = await confirm(await hold(first)), before = await balance(users[0]);
  const moved = await rescheduleCareReservation(patientReq(users[0], { slotId: id(second), revision: confirmed.reservation.revision }, confirmed.reservation));
  assert.equal(moved.session.queueKey, target.queueKey); assert.equal((await Appointment.findById(moved.appointment._id)).queueKey, target.queueKey); assert.equal(await balance(users[0]), before);
  assert.equal((await CareSlot.findById(first._id)).occupied, 0); assert.equal((await CareSlot.findById(second._id)).occupied, 1);
});
test("post-ledger visit write failure rolls back payment and allows a safe confirmation retry", async () => {
  const care = await create(), [slot] = await slotsFor(care), held = await hold(slot), prior = await balance(users[0]);
  // Inject a visit write failure after the ledger transfer inside the real Mongo transaction.
  const original = Appointment.create;
  Appointment.create = async () => { throw Object.assign(new Error("Synthetic post-ledger write failure"), { status: 503 }); };
  try { await assert.rejects(confirm(held), { status: 503 }); } finally { Appointment.create = original; }
  assert.equal(await balance(users[0]), prior); assert.equal(await Transaction.countDocuments({ referenceId: "SCHEDULE-" + id(held.reservation) }), 0);
  assert.equal((await CareReservation.findById(held.reservation._id)).state, "held");
  assert.equal((await confirm(held)).reservation.state, "confirmed");
});
test("doctor absence closes availability and confirmation without taking a payment", async () => {
  const care = await create(), [slot] = await slotsFor(care), held = await hold(slot), prior = await balance(users[0]);
  const leave = await setDoctorAbsence(doctorReq({ startsAt: care.startsAt.toISOString(), endsAt: care.endsAt.toISOString() }));
  await assert.rejects(confirm(held), { status: 409 }); assert.equal(await balance(users[0]), prior);
  const availability = await getAvailability({ doctorId: id(doctor), from: care.serviceDate, to: care.serviceDate }); assert.equal(availability.sessions[0].slots[0].bookable, false);
  assert.equal((await getReservation(patientReq(), held.reservation._id)).doctorUnavailable, true);
  await setDoctorAbsence({ ...doctorReq({}), params: { absenceId: id(leave) } }); assert.equal((await confirm(held)).reservation.state, "confirmed");
});
test("confirmed online visits require explicit check-in and do not appear as arrived queue entries", async () => {
  const care = await create(), [slot] = await slotsFor(care), confirmed = await confirm(await hold(slot));
  const queue = await invoke(getDoctorQueue, { auth: { role: "doctor", id: id(doctor) }, query: { queueKey: care.queueKey } });
  assert.equal(queue.pendingCount, 0); assert.equal(queue.reservations.length, 1);
  await assert.rejects(admitCareReservation(patientReq(users[0], {}, confirmed.reservation)), { status: 409 });
  await assert.rejects(transitionVisit({ appointmentId: confirmed.appointment._id, action: "start", now: slot.startsAt }), { status: 409 });
  const admitted = await admitCareReservation(patientReq(users[0], {}, confirmed.reservation), slot.startsAt); assert.equal(admitted.appointment.admissionState, "arrived");
  const started = await transitionVisit({ appointmentId: confirmed.appointment._id, action: "start", now: slot.startsAt }); assert.equal(started.appointment.status, "active");
  await assert.rejects(rescheduleCareReservation(patientReq(users[0], { slotId: id((await slotsFor(care))[1]), revision: confirmed.reservation.revision }, confirmed.reservation), slot.startsAt), { status: 409 });
  await transitionVisit({ appointmentId: confirmed.appointment._id, action: "complete", now: new Date(slot.startsAt.getTime() + 60000) }); assert.equal((await CareReservation.findById(confirmed.reservation._id)).state, "completed");
});
test("hospital booking stays reserved until authorized reception/nurse arrival and retains visit mode", async () => {
  const data = { ...body(), hospitalId: id(hospital), departmentId: id(department), doctorId: id(staffDoctor), appointmentType: "hospital_in_person" };
  const care = await createCareSession({ staff: { ...nurse, role: "HOSPITAL_ADMIN" }, body: data }), [slot] = await slotsFor(care), confirmed = await confirm(await hold(slot));
  const token = await Token.findById(confirmed.reservation.tokenId); assert.equal(token.status, "reserved"); assert.equal(token.visitMode, "in_person");
  await assert.rejects(admitCareReservation(patientReq(users[0], {}, confirmed.reservation), slot.startsAt), { status: 403 });
  const queue = await invoke(getHospitalQueue, { staff: nurse, params: { hospitalId: id(hospital), doctorId: id(staffDoctor) }, query: { sessionId: care.sessionId, serviceDate: care.serviceDate } }); assert.equal(queue.reservations.length, 1); assert.ok(queue.sessionIds.includes(care.sessionId));
  await transitionVisit({ tokenId: token._id, action: "check_in", now: slot.startsAt });
  assert.equal((await Appointment.findById(confirmed.appointment._id)).admissionState, "arrived");
  await transitionVisit({ tokenId: token._id, action: "vitals", now: slot.startsAt }); await transitionVisit({ tokenId: token._id, action: "start", now: slot.startsAt });
  assert.equal((await Appointment.findById(confirmed.appointment._id)).consultationDeadline, null);
});
test("legacy refund endpoint enforces schedule policy and releases linked capacity", async () => {
  const care = await create({ policy: { cancelBeforeMinutes: 60 } }), [slot] = await slotsFor(care), confirmed = await confirm(await hold(slot));
  await assert.rejects(refundAppointment({ appointmentId: confirmed.appointment._id, now: new Date(slot.startsAt.getTime() - 60000) }), { status: 409 });
  await refundAppointment({ appointmentId: confirmed.appointment._id }); assert.equal((await CareSlot.findById(slot._id)).occupied, 0); assert.equal((await CareReservation.findById(confirmed.reservation._id)).state, "cancelled");
});
test("paused/absent sessions permit cancellation after the normal cutoff and forbid admission", async () => {
  const care = await create(), [slot] = await slotsFor(care), confirmed = await confirm(await hold(slot));
  await setCareSessionState({ ...doctorReq({ state: "paused" }), params: { sessionId: id(care) } });
  await assert.rejects(admitCareReservation(patientReq(users[0], {}, confirmed.reservation), slot.startsAt), { status: 409 });
  const cancelled = await cancelCareReservation(patientReq(users[0], {}, confirmed.reservation), new Date(slot.startsAt.getTime() + 60000)); assert.equal(cancelled.reservation.state, "cancelled");
});
test("online OPD can accept real session capacity after its window opens", async () => {
  const care = await create({ appointmentType: "online_opd", capacity: 3 }), [slot] = await slotsFor(care), now = new Date(slot.startsAt.getTime() + 60000);
  const held = await holdCareSlot(patientReq(users[0], { slotId: id(slot) }), now), confirmed = await confirmCareReservation(patientReq(users[0], {}, held.reservation), now);
  assert.equal(confirmed.session.appointmentType, "online_opd"); assert.equal(confirmed.appointment.admissionState, "reserved");
  assert.equal((await admitCareReservation(patientReq(users[0], {}, confirmed.reservation), now)).appointment.admissionState, "arrived");
});
test("scheduled online queue positions follow arrival order and exclude future reservations", async () => {
  const care = await create({ appointmentType: "online_opd", capacity: 3 }), [slot] = await slotsFor(care), now = slot.startsAt;
  const first = await confirm(await hold(slot, users[0]), users[0]), second = await confirm(await hold(slot, users[1]), users[1]);
  assert.equal(first.queuePosition, null);
  const earlierArrival = await admitCareReservation(patientReq(users[1], {}, second.reservation), now);
  const laterArrival = await admitCareReservation(patientReq(users[0], {}, first.reservation), new Date(now.getTime() + 1000));
  assert.equal(earlierArrival.queuePosition, 1); assert.equal(laterArrival.queuePosition, 2);
  assert.equal((await getReservation(patientReq(users[1]), second.reservation._id, new Date(now.getTime() + 1000))).queuePosition, 1);
});
test("revoked hospital membership invalidates existing reservation check-in", async () => {
  const care = await createCareSession({ staff: { ...nurse, role: "HOSPITAL_ADMIN" }, body: { ...body(), hospitalId: id(hospital), departmentId: id(department), doctorId: id(staffDoctor), appointmentType: "hospital_in_person" } }), [slot] = await slotsFor(care), confirmed = await confirm(await hold(slot));
  await Staff.updateOne({ _id: staffDoctor._id }, { $set: { isActive: false } });
  await assert.rejects(transitionVisit({ tokenId: confirmed.reservation.tokenId, action: "check_in", now: slot.startsAt }), { status: 409 });
  assert.equal((await getReservation(patientReq(), confirmed.reservation._id)).doctorUnavailable, true);
  await Staff.updateOne({ _id: staffDoctor._id }, { $set: { isActive: true } });
});
const startAPI = async () => {
  const child = fork(fileURLToPath(new URL("../fixtures/p03-api.mjs", import.meta.url)), [], { execArgv: ["--import", new URL("../bootstrap.js", import.meta.url).href], stdio: ["ignore", "ignore", "ignore", "ipc"],
    env: { ...process.env, TEST_DATABASE_URL: uri.href, TEST_REDIS_URL: targets.redis, REDIS_KEY_PREFIX: redisPrefix } });
  children.push(child);
  const port = await new Promise((resolve, reject) => { const timer = setTimeout(() => { child.kill(); reject(new Error("Fixture startup timed out")); }, 120000); child.once("message", ({ port }) => { clearTimeout(timer); resolve(port); }); child.once("exit", () => { clearTimeout(timer); reject(new Error("Fixture startup failed")); }); });
  return "http://127.0.0.1:" + port;
};
const http = async (origin, path, user, input, requestKey = key()) => {
  const response = await fetch(origin + path, { method: input ? "POST" : "GET", headers: { "Content-Type": "application/json", "Idempotency-Key": requestKey, Authorization: "Bearer " + await sessionToken(user, "user") }, ...(input ? { body: JSON.stringify(input) } : {}), signal: AbortSignal.timeout(30000) });
  return { status: response.status, body: await response.json() };
};
test("two API processes share capacity and reject unauthorized tracking/check-in", async () => {
  origins.push(await startAPI(), await startAPI()); const care = await create(), [slot] = await slotsFor(care);
  const outcomes = await Promise.all(users.slice(3, 5).map((user, i) => http(origins[i], "/api/scheduling/holds", user, { slotId: id(slot) })));
  assert.deepEqual(outcomes.map(row => row.status).sort(), [201, 409]); const winner = outcomes.findIndex(row => row.status === 201), held = outcomes[winner].body;
  assert.equal((await http(origins[1 - winner], "/api/scheduling/reservations/" + id(held.reservation), users[4 - winner])).status, 404);
  const confirmation = await http(origins[winner], "/api/scheduling/reservations/" + id(held.reservation) + "/confirm", users[3 + winner], {}); assert.equal(confirmation.status, 200);
  assert.equal((await http(origins[winner], "/api/scheduling/reservations/" + id(held.reservation) + "/check-in", users[3 + winner], {})).status, 409);
});
test("schema CLI rehearses explicit-target dry run, guarded apply, rollback and refusal after use", async () => {
  const cliUri = new URL(uri.href); cliUri.pathname += "_cli";
  const folder = await mkdtemp(join(tmpdir(), "medipulse-p09-schema-")), backup = join(folder, "indexes.json"), second = join(folder, "reapply.json");
  const exec = promisify(execFile), script = fileURLToPath(new URL("../../scripts/initSchedulingSchema.js", import.meta.url));
  const cli = args => exec(process.execPath, [script, ...args], { env: { ...process.env, DATABASE_URL: cliUri.href }, timeout: 60000 });
  const connection = await mongoose.createConnection(cliUri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 }).asPromise();
  try {
    await assert.rejects(cli([]), error => error.code === 1);
    const dry = await cli(["--explicit-target"]); assert.match(dry.stdout, /"ready":false/);
    await assert.rejects(cli(["--explicit-target", "--apply", "--backup", backup]), error => error.code === 1);
    await cli(["--explicit-target", "--apply", "--writers-paused", "--backup", backup]);
    assert.match((await cli(["--explicit-target"])).stdout, /"ready":true/);
    await assert.rejects(cli(["--explicit-target", "--apply", "--writers-paused", "--backup", backup]), error => error.code === 1);
    await cli(["--explicit-target", "--rollback", "--writers-paused", "--backup", backup]);
    await cli(["--explicit-target", "--apply", "--writers-paused", "--backup", second]);
    await connection.db.collection("schedulelocks").insertOne({ _id: "synthetic-used-lock", revision: 1 });
    await assert.rejects(cli(["--explicit-target", "--rollback", "--writers-paused", "--backup", second]), error => error.code === 1);
  } finally {
    if (connection.name !== cliUri.pathname.slice(1) || !connection.name.startsWith("medipulse_test_p09_")) throw new Error("Unexpected CLI fixture target");
    await connection.dropDatabase(); await connection.close();
    await unlink(backup).catch(() => {}); await unlink(second).catch(() => {}); await rmdir(folder);
  }
});
