import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import Hospital from "../../model/hospital.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import Department from "../../model/department.js";
import OpdToken from "../../model/opdToken.js";
import EncounterJourney from "../../model/encounterJourney.js";
import AuthSession from "../../model/authSession.js";
import encounterRouter from "../../routes/encounter.js";
import opdRouter from "../../routes/opd.js";
import saasRouter from "../../routes/saasOperations.js";
import labRouter from "../../routes/lab.js";
import LabOrder from "../../model/labOrder.js";
import { closeRedis } from "../../services/redis.js";

const target = localTestTargets(), uri = new URL(target.mongo);
uri.pathname = "/medipulse_test_astra_" + crypto.randomBytes(6).toString("hex");
let server, origin;
const id = () => new mongoose.Types.ObjectId();
const owner = id(), other = id(), doctor = id(), operator = id(), hospital = id(), foreignHospital = id(), department = id(), otherDepartment = id();
const clinician = id(), nurse = id(), wrongNurse = id(), foreignStaff = id(), admin = id(), tokenId = id(), encounterId = id();
const tokens = {};
const labTech = id();
async function session(principalId, kind, hospitalId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId, kind, csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ sid, id: String(principalId), role: kind, ...(kind === "staff" ? { type: "staff", hospitalId: String(hospitalId) } : {}) }, process.env.TOKEN_KEY);
}
async function http(path, actor, body, method = body ? "POST" : "GET", key) {
  const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(10000), headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}), ...(actor ? { Authorization: "Bearer " + tokens[actor] } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
before(async () => {
  await mongoose.connect(uri.href, { serverSelectionTimeoutMS: 3000, autoIndex: false });
  await User.collection.insertMany([owner, other, operator].map(_id => ({ _id, firstName: "Synthetic Patient", authVersion: 0 })));
  await Doctor.collection.insertOne({ _id: doctor, firstName: "Synthetic Doctor", authVersion: 0 });
  await Hospital.collection.insertMany([hospital, foreignHospital].map(_id => ({ _id, name: "Synthetic Hospital", slug: String(_id), status: "active" })));
  await Department.collection.insertMany([department, otherDepartment].map(_id => ({ _id, hospitalId: hospital, status: "active", name: "Synthetic Department" })));
  await HospitalStaff.collection.insertMany([
    { _id: clinician, role: "DOCTOR", departmentIds: [department] }, { _id: nurse, role: "NURSE", departmentIds: [department] },
    { _id: wrongNurse, role: "NURSE", departmentIds: [otherDepartment] }, { _id: foreignStaff, role: "HOSPITAL_ADMIN", hospitalId: foreignHospital },
    { _id: admin, role: "HOSPITAL_ADMIN" }, { _id: labTech, role: "LAB_TECH", departmentIds: [department] },
  ].map(row => ({ hospitalId: hospital, name: "Synthetic Staff", isActive: true, inviteStatus: "accepted", authVersion: 0, ...row })));
  await OpdToken.collection.insertOne({ _id: tokenId, hospitalId: hospital, departmentId: department, doctorId: clinician, patientId: owner, patientInfo: { name: "Synthetic Patient" }, tokenNumber: 1, displayToken: "T001", status: "waiting", serviceDate: "2026-10-11", queueKey: "synthetic-astra-queue", createdAt: new Date() });
  await EncounterJourney.create({ _id: encounterId, hospitalId: hospital, departmentId: department, tokenId, patientId: owner, ticketNumber: "Synthetic ticket", currentDestination: { name: "Synthetic Reception" }, physicalFile: { hasPhysicalFile: true, currentHolderName: "Internal Staff Identity", locationName: "Records desk" } });
  for (const [label, principalId, kind, tenant] of [["owner",owner,"user"],["other",other,"user"],["doctor",doctor,"doctor"],["operator",operator,"user"],["nurse",nurse,"staff",hospital],["wrongNurse",wrongNurse,"staff",hospital],["admin",admin,"staff",hospital],["foreign",foreignStaff,"staff",foreignHospital]]) tokens[label] = await session(principalId, kind, tenant);
  tokens.labTech = await session(labTech, "staff", hospital);
  process.env.PLATFORM_ADMIN_IDS = String(operator) + "," + String(doctor);
  const app = express(); app.use(express.json(), cookieParser());
  app.use("/api/encounters", encounterRouter); app.use("/api/opd", opdRouter); app.use("/api/saas", saasRouter);
  app.use("/api/labs", labRouter);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.status ? error.message : "Isolated request failed" }));
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); origin = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.name === uri.pathname.slice(1)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); await closeRedis(); delete process.env.PLATFORM_ADMIN_IDS;
});
test("mounted encounter routes reject anonymous, foreign patient and foreign tenant reads", async () => {
  for (const suffix of ["guidance", "ticket"]) {
    assert.equal((await http("/api/encounters/" + encounterId + "/" + suffix)).status, 401);
    for (const actor of ["other", "doctor", "foreign", "wrongNurse"]) assert.ok([403,404].includes((await http("/api/encounters/" + encounterId + "/" + suffix, actor)).status), actor);
    assert.equal((await http("/api/encounters/" + encounterId + "/" + suffix, "owner")).status, 200);
    assert.equal((await http("/api/encounters/" + encounterId + "/" + suffix, "nurse")).status, 200);
  }
});
test("owned token lookup resolves the same encounter and patient guidance omits custody identities", async () => {
  const response = await http("/api/encounters/" + tokenId + "/guidance", "owner");
  assert.equal(response.status, 200); assert.equal(response.body.guidance.ticketNumber, "Synthetic ticket");
  assert.doesNotMatch(JSON.stringify(response.body), /Internal Staff Identity|holderRole|qrPayload/);
});
test("unlinked or contradictory encounter identity fails closed", async () => {
  await EncounterJourney.updateOne({ _id: encounterId }, { $unset: { patientId: "" } });
  assert.equal((await http("/api/encounters/" + encounterId + "/guidance", "owner")).status, 403);
  await EncounterJourney.updateOne({ _id: encounterId }, { $set: { patientId: owner } });
});
test("unsafe encounter commands return unavailable and preserve original records", async () => {
  const original = await EncounterJourney.findById(encounterId).lean();
  for (const action of ["transition", "handoff", "refuse"]) assert.equal((await http("/api/encounters/" + encounterId + "/" + action, "admin", { toStage: "completed", toActorId: foreignStaff })).status, 503);
  assert.equal((await http("/api/encounters/" + encounterId + "/link-account", "other", { phone: "1234567890" })).status, 503);
  assert.deepEqual(await EncounterJourney.findById(encounterId).lean(), original);
  assert.equal(String((await OpdToken.findById(tokenId)).patientId), String(owner));
});
test("timeline checks department access through real staff policy", async () => {
  const path = "/api/opd/tokens/" + tokenId + "/live-timeline";
  for (const actor of ["other","doctor","wrongNurse","foreign"]) assert.ok([403,404].includes((await http(path,actor)).status),actor);
  assert.equal((await http(path,"owner")).status,200); assert.equal((await http(path,"nurse")).status,200);
});
test("SaaS global management requires a real allowlisted patient-account operator", async () => {
  assert.equal((await http("/api/saas/tenants")).status,401);
  for (const actor of ["owner","doctor","admin"]) assert.ok([401,403].includes((await http("/api/saas/tenants",actor)).status));
  assert.equal((await http("/api/saas/tenants","operator")).status,200);
});
test("tenant admin details reject a foreign tenant and permit their own tenant", async () => {
  assert.equal((await http("/api/saas/tenants/" + hospital,"foreign")).status,403);
  assert.equal((await http("/api/saas/tenants/" + hospital,"admin")).status,200);
});
test("the actual LAB_TECH role can collect only tenant-scoped samples and records its real actor", async () => {
  const fields = { workflowVersion: 1, tokenId, departmentId: department, serviceDepartmentId: department, patientId: owner, patientInfo: { name: "Synthetic Patient" }, orderingDoctorId: clinician, orderStatus: "billing_cleared", tests: [{ testCode: "SYN", testName: "Synthetic Test" }] };
  const order = await LabOrder.create({ hospitalId: hospital, ...fields });
  const foreignOrder = await LabOrder.create({ hospitalId: foreignHospital, ...fields });
  assert.equal((await http("/api/labs/orders/" + foreignOrder._id + "/collect", "labTech", {}, "PATCH")).status, 404);
  assert.equal((await http("/api/labs/orders/" + order._id + "/collect", "admin", {}, "PATCH")).status, 403);
  const collected = await http("/api/labs/orders/" + order._id + "/collect", "labTech", { expectedRevision: 0 }, "PATCH", crypto.randomUUID());
  assert.equal(collected.status, 200);
  const stored = await LabOrder.findById(order._id);
  assert.equal(stored.orderStatus, "collected"); assert.equal(String(stored.collectedBy), String(labTech));
  assert.equal((await LabOrder.findById(foreignOrder._id)).orderStatus, "billing_cleared");
});
