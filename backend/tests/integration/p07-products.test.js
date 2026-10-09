import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import { mkdtemp, unlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { localTestTargets } from "../../util/testTargets.js";
import { makeDomainControllers } from "../../controller/hospitalWebsite.js";
import { hospitalForHost, resolveHospitalHost } from "../../services/productHosts.js";
import { inspectProductMigration, applyProductMigration } from "../../services/productMigration.js";
import { getDoctorQueue } from "../../controller/appointment.js";
import { createQueueBooking } from "../../services/queueBooking.js";
import { queueContext, patientKey } from "../../services/queueContext.js";
import Hospital from "../../model/hospital.js";
import Domain from "../../model/hospitalDomain.js";
import Staff from "../../model/hospitalStaff.js";
import Doctor from "../../model/doctor.js";
import User from "../../model/user.js";
import Appointment from "../../model/appointment.js";
import Token from "../../model/opdToken.js";
import Sequence from "../../model/opdSequence.js";
import Operation from "../../model/bookingOperation.js";
import Revision from "../../model/queueRevision.js";
import Outbox from "../../model/outboxJob.js";
const targets = localTestTargets(), suffix = crypto.randomBytes(6).toString("hex"), uri = new URL(targets.mongo);
uri.pathname = `/medipulse_test_p07_${suffix}`;
process.env.USE_REAL_REDIS = "false";
let hospitals, doctor, user, members, visits, temp;
const invoke = async (fn, req) => {
  const result = { status: 200 };
  const res = { status(code) { result.status = code; return this; }, json(body) { result.body = JSON.parse(JSON.stringify(body)); return this; }, set() { return this; } };
  try { await fn(req, res); } catch (error) { result.status = error.status || 500; result.body = { message: error.message }; }
  return result;
};
const admin = (hospital, domain) => ({ params: { id: String(hospital._id) }, staff: { hospitalId: hospital._id, role: "HOSPITAL_ADMIN" }, body: { domain } });
const registered = new Set();
let ownership = false, configured = true, unavailable = false;
const provider = async (path, options = {}) => {
  if (unavailable) throw new Error("synthetic provider outage");
  if (path.endsWith("/config")) return { misconfigured: !configured, configuredBy: "fixture", privateProviderField: "must not leak" };
  if (options.method === "POST" && !path.endsWith("/verify")) { registered.add(JSON.parse(options.body).name); return { verification: [{ type: "TXT", domain: "_vercel.care.example.test", value: "fixture-verification" }] }; }
  const domain = decodeURIComponent(path.split("/").at(-1));
  if (options.method === "DELETE") { registered.delete(domain); return {}; }
  if (!options.method && !registered.has(domain)) throw Object.assign(new Error("Not provisioned"), { providerStatus: 404 });
  return { verified: ownership, verification: [] };
};
let txtOwnership = true;
const domains = makeDomainControllers(provider, async host => txtOwnership ? [[(await Domain.findById(host.replace(/^_medipulse\./, "")))?.challenge || "wrong"]] : [["wrong-owner"]]);
before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  await Promise.all([Hospital, Domain, Staff, Doctor, User, Appointment, Token, Sequence, Operation, Revision, Outbox].map(Model => Model.createIndexes()));
  hospitals = await Hospital.create([1, 2].map(n => ({ name: `Synthetic Hospital ${n}`, slug: `fixture-${n}`, registrationNumber: `fixture-${n}`, type: "clinic", email: `hospital${n}@example.invalid`, address: { city: "Fixture", state: "Fixture" }, status: "active" })));
  doctor = await Doctor.create({ firstName: "Fixture", lastName: "Doctor", email: "doctor@example.invalid", password: "fixture-password", gender: "other", experience: { years: 1, expertise: "General medicine" }, consultationFee: 0 });
  user = await User.create({ firstName: "Fixture", lastName: "Patient", email: "patient@example.invalid", password: "fixture-password", gender: "other" });
  members = await Staff.create(hospitals.map(hospital => ({ hospitalId: hospital._id, doctorId: doctor._id, name: "Fixture Doctor", email: "doctor@example.invalid", role: "DOCTOR", inviteStatus: "accepted", isActive: true })));
  temp = await mkdtemp(join(tmpdir(), "medipulse-p07-"));
});
after(async () => { await mongoose.connection.dropDatabase(); await mongoose.disconnect(); if (temp) { for (const file of ["products.ejson"]) await unlink(join(temp, file)).catch(() => {}); await rmdir(temp); } });
test("hospital host resolution reserves names, checks active state and permits path-only sites", async () => {
  assert.equal(String((await hospitalForHost("FIXTURE-1.MEDIPULSE.LIVE.:443"))._id), String(hospitals[0]._id));
  assert.equal(await hospitalForHost("app.medipulse.live"), null);
  assert.equal(await hospitalForHost("unknown.medipulse.live"), null);
  const dto = await invoke(resolveHospitalHost, { query: { host: "fixture-1.medipulse.live" } });
  assert.deepEqual(Object.keys(dto.body.hospital).sort(), ["_id", "name", "slug"]);
  await Hospital.updateOne({ _id: hospitals[0]._id }, { $set: { "websiteConfig.subdomainEnabled": false } });
  assert.equal(await hospitalForHost("fixture-1.medipulse.live"), null);
  assert.ok(await Hospital.findOne({ slug: "fixture-1", status: "active" }));
  await Hospital.updateOne({ _id: hospitals[0]._id }, { $set: { "websiteConfig.subdomainEnabled": true } });
});
test("custom domain administration rejects other hospitals and platform domains", async () => {
  assert.equal((await invoke(domains.addCustomDomain, { ...admin(hospitals[0], "care.example.test"), staff: { hospitalId: hospitals[1]._id, role: "HOSPITAL_ADMIN" } })).status, 403);
  for (const domain of ["connect.medipulse.live", "fixture-1.medipulse.live", "care.example.test:443", "https://care.example.test"]) assert.equal((await invoke(domains.addCustomDomain, admin(hospitals[0], domain))).status, 400);
});
test("concurrent custom claims have one durable owner and safe retry", async () => {
  const results = await Promise.all(hospitals.map(hospital => invoke(domains.addCustomDomain, admin(hospital, "care.example.test"))));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const claim = await Domain.findById("care.example.test");
  const winner = hospitals.find(hospital => String(hospital._id) === String(claim.hospitalId));
  assert.equal((await invoke(domains.addCustomDomain, admin(winner, "care.example.test"))).status, 200);
  assert.equal(await hospitalForHost("care.example.test"), null);
});
test("DNS routing alone cannot verify ownership; verified domains resolve only their active owner", async () => {
  const claim = await Domain.findById("care.example.test"), hospital = hospitals.find(item => String(item._id) === String(claim.hospitalId));
  let result = await invoke(domains.verifyCustomDomain, admin(hospital));
  assert.equal(result.body.verified, false); assert.equal(result.body.privateProviderField, undefined);
  assert.equal(await hospitalForHost("care.example.test"), null);
  ownership = true; txtOwnership = false;
  result = await invoke(domains.verifyCustomDomain, admin(hospital)); assert.equal(result.body.verified, false);
  assert.equal(await hospitalForHost("care.example.test"), null);
  txtOwnership = true;
  result = await invoke(domains.verifyCustomDomain, admin(hospital)); assert.equal(result.body.verified, true);
  assert.equal(String((await hospitalForHost("CARE.EXAMPLE.TEST."))._id), String(hospital._id));
  await Hospital.updateOne({ _id: hospital._id }, { $set: { status: "pending" } });
  assert.equal(await hospitalForHost("care.example.test"), null);
  await Hospital.updateOne({ _id: hospital._id }, { $set: { status: "active" } });
});
test("failed verification and removal withdraw routing and permit controlled retry", async () => {
  const claim = await Domain.findById("care.example.test"), hospital = hospitals.find(item => String(item._id) === String(claim.hospitalId));
  unavailable = true;
  assert.equal((await invoke(domains.verifyCustomDomain, admin(hospital))).status, 502);
  assert.equal(await hospitalForHost("care.example.test"), null);
  assert.equal((await invoke(domains.removeCustomDomain, admin(hospital))).status, 502);
  assert.equal((await Domain.findById("care.example.test")).state, "removing");
  unavailable = false;
  assert.equal((await invoke(domains.verifyCustomDomain, admin(hospital))).status, 409);
  assert.equal((await invoke(domains.removeCustomDomain, admin(hospital))).status, 200);
  assert.equal(await Domain.findById("care.example.test"), null);
});
test("stale verification cannot overwrite a removed and recreated reservation", async () => {
  const hospital = hospitals[0];
  assert.equal((await invoke(domains.addCustomDomain, admin(hospital, "care.example.test"))).status, 200);
  let release, entered;
  const paused = new Promise(resolve => { release = resolve; });
  const observed = new Promise(resolve => { entered = resolve; });
  const delayed = makeDomainControllers(async (path, options) => {
    if (path.endsWith("/verify")) { entered(); await paused; }
    return provider(path, options);
  }, async host => [[(await Domain.findById(host.replace(/^_medipulse\./, ""))).challenge]]);
  const verifying = invoke(delayed.verifyCustomDomain, admin(hospital));
  await observed;
  assert.equal((await invoke(domains.removeCustomDomain, admin(hospital))).status, 200);
  assert.equal((await invoke(domains.addCustomDomain, admin(hospital, "care.example.test"))).status, 200);
  release(); assert.equal((await verifying).status, 409);
  assert.equal((await Domain.findById("care.example.test")).verified, false);
  assert.equal(await hospitalForHost("care.example.test"), null);
  assert.equal((await invoke(domains.removeCustomDomain, admin(hospital))).status, 200);
});
test("one doctor can book independent and two hospital sessions without merging records", async () => {
  visits = [];
  const contexts = [queueContext({ doctorId: doctor._id, doctor }), ...hospitals.map((hospital, n) => queueContext({ hospital, doctorId: members[n]._id }))];
  for (const context of contexts) {
    const result = await createQueueBooking({ request: { actorKey: `patient:${user._id}`, kind: "appointment", requestKey: crypto.randomUUID(), fingerprint: crypto.randomUUID() }, context, personKey: patientKey(user._id), fee: 0,
      appointmentData: { doctor: doctor._id, user: user._id, roomId: crypto.randomUUID(), visitMode: context.visitMode } });
    visits.push(result.appointment);
  }
  assert.equal(new Set(visits.map(visit => visit.queueKey)).size, 3);
  assert.deepEqual(visits.map(visit => visit.practiceType), ["independent", "hospital", "hospital"]);
  assert.equal(String(visits[1].hospitalId), String(hospitals[0]._id));
  const defaultQueue = await invoke(getDoctorQueue, { auth: { id: String(doctor._id), role: "doctor" }, query: {} });
  assert.equal(defaultQueue.status, 200); assert.equal(defaultQueue.body.queueKey, contexts[0].queueKey); assert.equal(defaultQueue.body.queue.length, 1); assert.equal(defaultQueue.body.queues.length, 3);
  const selected = await invoke(getDoctorQueue, { auth: { id: String(doctor._id), role: "doctor" }, query: { queueKey: contexts[1].queueKey } });
  assert.equal(selected.body.reservations.length, 1); assert.equal(selected.body.reservations[0]._id, String(visits[1]._id));
  assert.equal((await invoke(getDoctorQueue, { auth: { id: String(doctor._id), role: "doctor" }, query: { queueKey: "hospital:unrelated" } })).status, 403);
});
test("revoked hospital membership removes only that hospital queue", async () => {
  await Staff.updateOne({ _id: members[0]._id }, { $set: { isActive: false } });
  const req = { auth: { id: String(doctor._id), role: "doctor" }, query: { queueKey: visits[1].queueKey } };
  assert.equal((await invoke(getDoctorQueue, req)).status, 403);
  req.query.queueKey = visits[2].queueKey; assert.equal((await invoke(getDoctorQueue, req)).status, 200);
  await Staff.updateOne({ _id: members[0]._id }, { $set: { isActive: true } });
});
test("inactive hospitals are excluded while the doctor's other practices remain available", async () => {
  await Hospital.updateOne({ _id: hospitals[0]._id }, { $set: { status: "pending" } });
  const req = { auth: { id: String(doctor._id), role: "doctor" }, query: { queueKey: visits[1].queueKey } };
  assert.equal((await invoke(getDoctorQueue, req)).status, 403);
  req.query = {}; assert.equal((await invoke(getDoctorQueue, req)).body.queues.length, 2);
  await Hospital.updateOne({ _id: hospitals[0]._id }, { $set: { status: "active" } });
});
test("legacy metadata/domain migration dry run, apply and rollback preserve queue identities", async () => {
  await Appointment.collection.updateMany({}, { $unset: { practiceType: "", hospitalId: "" } });
  await Hospital.collection.updateOne({ _id: hospitals[0]._id }, { $set: { "websiteConfig.customDomain": "legacy.example.test", "websiteConfig.customDomainVerified": true } });
  const plan = await inspectProductMigration(); assert.equal(plan.issues.length, 0); assert.equal(plan.rows.length, 5);
  const keys = (await Appointment.find({}).sort({ _id: 1 })).map(row => row.queueKey);
  await applyProductMigration(plan);
  assert.deepEqual((await Appointment.find({}).sort({ _id: 1 })).map(row => row.queueKey), keys);
  assert.equal(await hospitalForHost("legacy.example.test"), null);
  assert.equal((await Domain.findById("legacy.example.test")).verified, false);
  const current = await Appointment.findById(visits[0]._id);
  await Appointment.collection.updateOne({ _id: current._id }, { $set: { revision: 99 } });
  await assert.rejects(applyProductMigration(plan, true), /Data changed/);
  await Appointment.collection.updateOne({ _id: current._id }, { $set: { revision: current.revision } });
  await applyProductMigration(plan, true);
  assert.equal((await Hospital.findById(hospitals[0]._id)).websiteConfig.customDomainVerified, true);
  assert.equal(await Domain.findById("legacy.example.test"), null);
});
test("migration rejects duplicate domains and stale plans", async () => {
  await Hospital.collection.updateOne({ _id: hospitals[1]._id }, { $set: { "websiteConfig.customDomain": "legacy.example.test" } });
  const conflict = await inspectProductMigration(); assert.ok(conflict.issues.includes("invalid_or_duplicate_legacy_domain"));
  await assert.rejects(applyProductMigration(conflict));
  await Hospital.collection.updateOne({ _id: hospitals[1]._id }, { $unset: { "websiteConfig.customDomain": "" } });
  const plan = await inspectProductMigration(); await Appointment.collection.updateOne({ _id: visits[0]._id }, { $set: { revision: 4 } });
  await assert.rejects(applyProductMigration(plan), /Data changed/);
});
test("migration CLI rehearses apply/rollback with an explicit private backup", async () => {
  const exec = promisify(execFile), script = fileURLToPath(new URL("../../scripts/migrateProducts.js", import.meta.url));
  const options = { env: { ...process.env, NODE_ENV: "test", DATABASE_URL: uri.href }, timeout: 90000 };
  const backup = join(temp, "products.ejson");
  const dry = await exec(process.execPath, [script], options); assert.match(dry.stdout, /"issues":\[\]/);
  await exec(process.execPath, [script, "--apply", "--writers-paused", "--backup", backup], options);
  await exec(process.execPath, [script, "--rollback", "--writers-paused", "--backup", backup], options);
});
