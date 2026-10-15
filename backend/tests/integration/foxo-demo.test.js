import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import "../../model/department.js";
import "../../model/hospitalStaff.js";
import "../../model/doctor.js";
import { localTestTargets } from "../../util/testTargets.js";
import { inspectFoxoDemo, applyFoxoDemo, FOXO_ACCOUNTS, foxoHash } from "../../services/foxoDemo.js";
import { getHealthTimeline } from "../../controller/patientPortal.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_foxo_" + crypto.randomBytes(6).toString("hex");
const id = () => new mongoose.Types.ObjectId();
const patient = id(), doctor = id(), staff = id(), hospital = id(), department = id(), originalFamily = id();
let db, client;
const approved = { approved: true, writersPaused: true, backupVerified: true };
const date = "2026-10-15";
before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false });
  db = mongoose.connection.db; client = mongoose.connection.getClient();
});
after(async () => { await db?.dropDatabase(); await mongoose.disconnect(); });
beforeEach(async () => {
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) await db.collection(collection.name).deleteMany({});
  await db.collection("users").insertOne({ _id: patient, email: FOXO_ACCOUNTS.patient, firstName: "Synthetic Owner", password: "untouched-credential", careIdentityRevision: 4,
    medicalHistory: { primaryCondition: "Existing data retained" }, familyMembers: [{ _id: originalFamily, name: "Existing Family", relation: "parent" }] });
  await db.collection("doctors").insertOne({ _id: doctor, email: FOXO_ACCOUNTS.doctor, firstName: "Synthetic Clinician", isPublished: false, credentialVerification: { status: "pending" } });
  await db.collection("hospitalstaffs").insertOne({ _id: staff, email: FOXO_ACCOUNTS.doctor, doctorId: doctor, hospitalId: hospital, departmentIds: [department], role: "DOCTOR", isActive: true, inviteStatus: "accepted" });
  await db.collection("hospitals").insertOne({ _id: hospital, name: "Synthetic Hospital", slug: "synthetic-foxo", status: "active", settings: { timezone: "Asia/Kolkata", queueSessionIds: ["day"] } });
  await db.collection("departments").insertOne({ _id: department, hospitalId: hospital, name: "Paediatrics", status: "active" });
  await db.collection("wallets").insertOne({ _id: id(), userId: patient, balanceMinor: 12345 });
  await db.collection("virtualtransactions").insertOne({ _id: id(), amountMinor: 123, status: "SUCCESS" });
  for (const collection of ["opdtokens", "appointments", "encounterjourneys"]) await db.collection(collection).insertOne({ _id: id(), retained: "Original record" });
  await db.collection("opdtokens").createIndex({ queueKey: 1, tokenNumber: 1 }, { unique: true, partialFilterExpression: { queueKey: { $type: "string" } } });
});
const snapshot = async () => {
  const result = {};
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) result[collection.name] = await db.collection(collection.name).find({}).sort({ _id: 1 }).toArray();
  return result;
};
test("plan is read-only and links confirmed roles without publishing or verifying doctors", async () => {
  const before = await snapshot(), plan = await inspectFoxoDemo(db, date);
  assert.deepEqual(await snapshot(), before);
  assert.equal(plan.rows.length, 9); assert.equal(plan.source.patient.email, FOXO_ACCOUNTS.patient);
  assert.equal(plan.source.staff.doctorId.toString(), doctor.toString());
  assert.equal(plan.rows.filter(row => row.collection === "appointments").length, 3);
  for (const row of plan.rows) assert.equal(row.document.status || row.document.currentStage, "completed");
});
test("atomic apply preserves originals/credentials/financial data and patient timeline deduplicates three linked family visits", async () => {
  const before = await snapshot();
  const { EJSON } = mongoose.mongo.BSON;
  const plan = EJSON.parse(EJSON.stringify(await inspectFoxoDemo(db, date), { relaxed: false }), { relaxed: false });
  assert.equal((await applyFoxoDemo(db, client, plan, approved)).addedVisits, 3);
  const after = await snapshot();
  for (const collection of ["wallets", "virtualtransactions", "doctors", "hospitalstaffs", "hospitals", "departments"]) assert.deepEqual(after[collection], before[collection]);
  for (const collection of ["opdtokens", "appointments", "encounterjourneys"]) assert.deepEqual(after[collection].find(item => item.retained), before[collection][0]);
  const user = await db.collection("users").findOne({ _id: patient });
  const expected = { ...before.users[0], familyMembers: [...before.users[0].familyMembers, plan.family], careIdentityRevision: 5 };
  assert.deepEqual(user, expected);
  let body, status;
  await getHealthTimeline({ auth: { id: String(patient), role: "user" } }, { status(code) { status = code; return this; }, json(value) { body = value; } });
  assert.equal(status, 200, body?.message); assert.equal(body.items.length, 3);
  for (const item of body.items) { assert.equal(String(item.familyMemberId), String(plan.family._id)); assert.match(item.doctorNotes, /SYNTHETIC FOXO DEMO/); assert.equal(item.patientBrief, null); }
  assert.equal((await db.collection("appointments").findOne({ _id: plan.rows.find(row => row.collection === "appointments").document._id })).soapNote, undefined);
});
test("replay never duplicates history; later clinical edits are retained and refused", async () => {
  const plan = await inspectFoxoDemo(db, date);
  await applyFoxoDemo(db, client, plan, approved);
  const before = await snapshot();
  assert.equal((await applyFoxoDemo(db, client, plan, approved)).replay, true);
  assert.deepEqual(await snapshot(), before);
  const row = plan.rows.find(item => item.collection === "opdtokens");
  await db.collection(row.collection).updateOne({ _id: row.document._id }, { $set: { consultationNotes: "A later reviewed edit" } });
  await assert.rejects(applyFoxoDemo(db, client, plan, approved), /history changed/);
  assert.equal((await db.collection(row.collection).findOne({ _id: row.document._id })).consultationNotes, "A later reviewed edit");
});
test("source changes and plan tampering fail without partial additions", async () => {
  const plan = await inspectFoxoDemo(db, date), damaged = { ...plan, date: "2026-10-16" };
  await assert.rejects(applyFoxoDemo(db, client, damaged, approved), /integrity/);
  await db.collection("users").updateOne({ _id: patient }, { $inc: { careIdentityRevision: 1 } });
  const before = await snapshot();
  await assert.rejects(applyFoxoDemo(db, client, plan, approved), /Source data changed/);
  assert.deepEqual(await snapshot(), before);
});
test("failure after all inserts rolls back family, identity revision and visits", async () => {
  const plan = await inspectFoxoDemo(db, date), before = await snapshot();
  await assert.rejects(applyFoxoDemo(db, client, plan, { ...approved, fault() { throw new Error("synthetic failure"); } }), /synthetic failure/);
  const after = await snapshot();
  for (const [collection, documents] of Object.entries(before)) assert.deepEqual(after[collection], documents);
  assert.equal(await db.collection("demofixtureruns").countDocuments({}), 0);
});
test("missing approval, ambiguous staff, invalid dates and token collisions are refused", async () => {
  const plan = await inspectFoxoDemo(db, date);
  await assert.rejects(applyFoxoDemo(db, client, plan, {}), /approved plan/);
  await assert.rejects(inspectFoxoDemo(db, "2026-02-30"), /valid rehearsal date/);
  const token = plan.rows.find(row => row.collection === "opdtokens").document;
  await db.collection("opdtokens").insertOne({ _id: id(), queueKey: token.queueKey, tokenNumber: token.tokenNumber });
  await assert.rejects(inspectFoxoDemo(db, date), /token number is occupied/);
  await db.collection("hospitalstaffs").insertOne({ ...plan.source.staff, _id: id(), email: FOXO_ACCOUNTS.doctor });
  await assert.rejects(inspectFoxoDemo(db, date), /Exactly one/);
});
test("an archived synthetic family is never silently recreated or unarchived", async () => {
  const plan = await inspectFoxoDemo(db, date);
  await applyFoxoDemo(db, client, plan, approved);
  await db.collection("users").updateOne({ _id: patient, "familyMembers._id": plan.family._id }, { $set: { "familyMembers.$.archivedAt": new Date() } });
  const before = foxoHash(await snapshot());
  await assert.rejects(applyFoxoDemo(db, client, plan, approved), /family changed/);
  await assert.rejects(inspectFoxoDemo(db, "2026-10-16"), /reviewed reuse/);
  assert.equal(foxoHash(await snapshot()), before);
});

test("concurrent applies commit one graph and replay the other without duplicates", async () => {
  const plan = await inspectFoxoDemo(db, date);
  const results = await Promise.all([applyFoxoDemo(db, client, plan, approved), applyFoxoDemo(db, client, plan, approved)]);
  assert.equal(results.filter(result => result.replay).length, 1);
  assert.equal(await db.collection("demofixtureruns").countDocuments({}), 1);
  for (const collection of ["opdtokens", "appointments", "encounterjourneys"]) assert.equal(await db.collection(collection).countDocuments({ retained: { $exists: false } }), 3);
  assert.equal((await db.collection("users").findOne({ _id: patient })).familyMembers.length, 2);
});
