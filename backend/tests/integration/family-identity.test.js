import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { localTestTargets } from "../../util/testTargets.js";
import User from "../../model/user.js";
import Appointment from "../../model/appointment.js";
import OpdToken from "../../model/opdToken.js";
import { CareReservation } from "../../model/scheduling.js";
import { archivePatientFamily, addPatientFamily } from "../../services/familyProfiles.js";
import { lockPatientIdentity } from "../../services/patientIdentity.js";
import { moneyTransaction } from "../../services/moneyTransaction.js";
import { createQueueBooking } from "../../services/queueBooking.js";
import { queueContext, patientKey } from "../../services/queueContext.js";
import BookingOperation from "../../model/bookingOperation.js";
import Doctor from "../../model/doctor.js";
import { schedulingModels, CareSlot } from "../../model/scheduling.js";
import { createCareSession, holdCareSlot, confirmCareReservation } from "../../services/scheduling.js";
const uri = new URL(localTestTargets().mongo); uri.pathname = "/medipulse_test_family_" + crypto.randomBytes(6).toString("hex");
const oid = () => new mongoose.Types.ObjectId(), owner = async name => User.create({ firstName: "Synthetic", email: name + "@example.invalid", password: "fixture-password", gender: "other", familyMembers: [{ name: "Historical Synthetic Child", relation: "Child" }] });
const appointment = (user, extra = {}) => ({ user: user._id, familyMemberId: user.familyMembers[0]._id, doctor: oid(), roomId: "synthetic-room", status: "queued", ...extra });
before(async () => { await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 }); await User.createIndexes(); });
after(async () => { if (mongoose.connection.name === uri.pathname.slice(1) && mongoose.connection.readyState === 1) await mongoose.connection.dropDatabase(); await mongoose.disconnect(); });

test("archival preserves historical patient identity and complete visit records, and replays safely", async () => {
  const user = await owner("historical"), family = user.familyMembers[0]._id;
  const visit = await Appointment.create(appointment(user, { status: "completed", doctorNotes: "Synthetic saved note" }));
  const before = await Appointment.findById(visit._id).lean();
  const result = await archivePatientFamily(String(user._id), String(family));
  assert.equal(result.items.length, 0); assert.equal(result.archivedItems[0].name, "Historical Synthetic Child"); assert.ok(result.archivedItems[0].archivedAt);
  assert.deepEqual(await Appointment.findById(visit._id).lean(), before);
  const replay = await archivePatientFamily(String(user._id), String(family)); assert.equal(replay.replay, true); assert.equal(replay.archivedItems.length, 1);
  await assert.rejects(moneyTransaction(session => lockPatientIdentity(String(user._id), String(family), session)), error => error.status === 403);
  const added = await addPatientFamily(String(user._id), { name: "Synthetic New Profile", relation: "Parent" }); assert.equal(added.items.length, 1); assert.equal(added.archivedItems.length, 1);
});
test("active visits and holds block archival, and another owner cannot target the profile", async () => {
  const user = await owner("active"), other = await owner("foreign"), family = user.familyMembers[0]._id;
  await assert.rejects(archivePatientFamily(String(other._id), String(family)), error => error.status === 404);
  const visit = await Appointment.create(appointment(user));
  await assert.rejects(archivePatientFamily(String(user._id), String(family)), error => error.status === 409);
  await Appointment.updateOne({ _id: visit._id }, { $set: { status: "completed" } });
  const token = await OpdToken.create({ hospitalId: oid(), departmentId: oid(), doctorId: oid(), patientId: user._id, familyMemberId: family, tokenNumber: 1, date: new Date(), status: "reserved" });
  await assert.rejects(archivePatientFamily(String(user._id), String(family)), error => error.status === 409);
  await OpdToken.updateOne({ _id: token._id }, { $set: { status: "completed" } });
  const held = await CareReservation.create({ user: user._id, familyMemberId: family, session: oid(), slot: oid(), personKey: "synthetic-held", state: "held", expiresAt: new Date(Date.now() + 60000) });
  await assert.rejects(archivePatientFamily(String(user._id), String(family)), error => error.status === 409);
  await CareReservation.updateOne({ _id: held._id }, { $set: { state: "cancelled" } });
  assert.equal((await archivePatientFamily(String(user._id), String(family))).archivedItems.length, 1);
});
test("competing archival and transactional booking serialize on the owner without orphan records", async () => {
  for (let round = 0; round < 8; round++) {
    const user = await owner("race" + round), family = String(user.familyMembers[0]._id);
    const book = () => moneyTransaction(async session => { await lockPatientIdentity(String(user._id), family, session); await Appointment.create([appointment(user)], { session }); });
    const results = await Promise.allSettled(round % 2 ? [book(), archivePatientFamily(String(user._id), family)] : [archivePatientFamily(String(user._id), family), book()]);
    assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
    const current = await User.findById(user._id).lean(), visits = await Appointment.countDocuments({ user: user._id });
    assert.equal(visits, current.familyMembers[0].archivedAt ? 0 : 1); assert.equal(current.familyMembers.length, 1);
  }
});
test("queue recovery refuses an archived family before creating a visit and records a definitive unpaid failure", async () => {
  const user = await owner("archived-recovery"), family = user.familyMembers[0]._id, doctorId = oid();
  await archivePatientFamily(String(user._id), String(family));
  const context = queueContext({ doctorId }), person = patientKey(user._id, family), request = { actorKey: "patient:" + user._id, kind: "appointment", requestKey: crypto.randomUUID(), fingerprint: crypto.randomUUID() };
  await assert.rejects(createQueueBooking({ request, context, personKey: person, payerId: user._id, receiverId: doctorId, fee: 0, appointmentData: { ...appointment(user), ...context, personKey: person } }), error => error.status === 403);
  const operation = await BookingOperation.findOne({ requestKey: request.requestKey }); assert.equal(operation.state, "failed"); assert.equal(operation.responseStatus, 403); assert.equal(await Appointment.countDocuments({ user: user._id }), 0);
});
test("completed scheduling replay remains owned and readable after archival while new holds are refused", async () => {
  await Promise.all(schedulingModels.map(Model => Model.createIndexes()));
  const user = await owner("historical-schedule"), family = String(user.familyMembers[0]._id), doctor = await Doctor.create({ firstName: "Synthetic", email: "family-doctor@example.invalid", password: "fixture-password", gender: "other", consultationFee: 0, experience: { years: 0, expertise: "General Medicine" } });
  const start = new Date(Date.now() + 2 * 86400000); start.setUTCHours(6, 0, 0, 0);
  const care = await createCareSession({ auth: { id: String(doctor._id), role: "doctor" }, body: { doctorId: String(doctor._id), appointmentType: "scheduled_online", startsAt: start.toISOString(), endsAt: new Date(start.getTime() + 3600000).toISOString() } });
  const slot = await CareSlot.findOne({ session: care._id });
  const request = (body, params = {}) => ({ auth: { id: String(user._id), role: "user" }, body, params, headers: { "idempotency-key": crypto.randomUUID() } });
  const holdReq = request({ slotId: String(slot._id), familyMemberId: family }), held = await holdCareSlot(holdReq);
  const confirmReq = request({}, { reservationId: String(held.reservation._id) }), confirmed = await confirmCareReservation(confirmReq);
  await Appointment.updateOne({ _id: confirmed.appointment._id }, { $set: { status: "completed" } });
  await archivePatientFamily(String(user._id), family);
  assert.equal((await holdCareSlot(holdReq)).replay, true); assert.equal((await confirmCareReservation(confirmReq)).replay, true);
  await assert.rejects(holdCareSlot(request({ slotId: String(slot._id), familyMemberId: family })), error => error.status === 403);
});
