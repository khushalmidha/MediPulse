import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import AuthSession from "../../model/authSession.js";
import OpdToken from "../../model/opdToken.js";
import EncounterJourney from "../../model/encounterJourney.js";
import LabOrder from "../../model/labOrder.js";
import LabTestCatalog from "../../model/labTestCatalog.js";
import Prescription from "../../model/prescription.js";
import PharmacyInventory from "../../model/pharmacyInventory.js";
import labRouter from "../../routes/lab.js";
import pharmacyRouter from "../../routes/pharmacy.js";
import { collectSample } from "../../services/labService.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_clinical_" + crypto.randomBytes(6).toString("hex");
const id = () => new mongoose.Types.ObjectId();
const hospital = id(), foreignHospital = id(), department = id(), otherDepartment = id(), serviceDepartment = id(), wrongServiceDepartment = id();
const patient = id(), stranger = id(), family = id(), independentDoctor = id();
const clinician = id(), otherClinician = id(), nurse = id(), wrongNurse = id(), labTech = id(), wrongLabTech = id();
const pharmacist = id(), wrongPharmacist = id(), admin = id(), receptionist = id(), foreignAdmin = id();
const token = id(), otherToken = id(), encounter = id(), otherEncounter = id();
const catalog = id(), foreignCatalog = id(), inactiveCatalog = id(), inventory = id(), foreignInventory = id();
const sessions = {};
let server, origin, labOrder, prescription;
async function session(principalId, kind, hospitalId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId, kind, csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ id: String(principalId), role: kind, sid, ...(kind === "staff" ? { type: "staff", hospitalId: String(hospitalId) } : {}) }, process.env.TOKEN_KEY);
}
async function http(path, actor, body, method = body ? "POST" : "GET") {
  const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", ...(actor ? { Authorization: "Bearer " + sessions[actor] } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
const labInput = (extra = {}) => ({ tokenId: String(token), serviceDepartmentId: String(serviceDepartment), tests: [{ catalogId: String(catalog) }], ...extra });
const rxInput = (extra = {}) => ({ tokenId: String(token), serviceDepartmentId: String(serviceDepartment),
  items: [{ inventoryId: String(inventory), directions: "Synthetic clinician instructions", durationDays: 3, quantityPrescribed: 6 }], ...extra });

before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, serverSelectionTimeoutMS: 3000 });
  await User.collection.insertMany([{ _id: patient, firstName: "Synthetic Account", authVersion: 0,
    familyMembers: [{ _id: family, name: "Synthetic Family Member", archivedAt: new Date() }] }, { _id: stranger, firstName: "Synthetic Stranger", authVersion: 0 }]);
  await Doctor.collection.insertOne({ _id: independentDoctor, firstName: "Synthetic Independent Doctor", authVersion: 0 });
  await Hospital.collection.insertMany([hospital, foreignHospital].map(_id => ({ _id, name: "Synthetic Hospital", slug: String(_id), status: "active" })));
  await Department.collection.insertMany([department, otherDepartment, serviceDepartment, wrongServiceDepartment].map(_id => ({ _id, hospitalId: hospital, status: "active", name: "Synthetic Department" })));
  const staff = [
    ["clinician", clinician, "DOCTOR", department], ["otherClinician", otherClinician, "DOCTOR", otherDepartment],
    ["nurse", nurse, "NURSE", department], ["wrongNurse", wrongNurse, "NURSE", otherDepartment],
    ["labTech", labTech, "LAB_TECH", serviceDepartment], ["wrongLabTech", wrongLabTech, "LAB_TECH", wrongServiceDepartment],
    ["pharmacist", pharmacist, "PHARMACIST", serviceDepartment], ["wrongPharmacist", wrongPharmacist, "PHARMACIST", wrongServiceDepartment],
    ["admin", admin, "HOSPITAL_ADMIN", department], ["receptionist", receptionist, "RECEPTIONIST", department],
    ["foreignAdmin", foreignAdmin, "HOSPITAL_ADMIN", department, foreignHospital],
  ];
  await HospitalStaff.collection.insertMany(staff.map(([, _id, role, dept, tenant]) => ({ _id, role, hospitalId: tenant || hospital,
    departmentIds: [dept], name: "Synthetic Staff", isActive: true, inviteStatus: "accepted", authVersion: 0,
    adminAccess: _id === wrongNurse })));
  const visit = { hospitalId: hospital, departmentId: department, doctorId: clinician, patientId: patient, familyMemberId: family,
    personKey: "synthetic-family-person", patientInfo: { name: "Synthetic Family Member", age: 23, gender: "other" },
    status: "in_consultation", serviceDate: "2026-10-11", createdAt: new Date() };
  await OpdToken.collection.insertMany([{ _id: token, ...visit, tokenNumber: 1 },
    { _id: otherToken, ...visit, departmentId: otherDepartment, doctorId: otherClinician, tokenNumber: 2 }]);
  await EncounterJourney.create([{ _id: encounter, ...visit, tokenId: token, ticketNumber: "SYN-1" },
    { _id: otherEncounter, ...visit, tokenId: otherToken, departmentId: otherDepartment, ticketNumber: "SYN-2" }]);
  await LabTestCatalog.create([{ _id: catalog, hospitalId: hospital, code: "SYN", name: "Synthetic Test", priceMinor: 4500 },
    { _id: foreignCatalog, hospitalId: foreignHospital, code: "FOREIGN", name: "Synthetic Foreign Test", priceMinor: 100 },
    { _id: inactiveCatalog, hospitalId: hospital, code: "INACTIVE", name: "Synthetic Inactive Test", isActive: false }]);
  await PharmacyInventory.create([{ _id: inventory, hospitalId: hospital, medicationCode: "SYN", medicationName: "Synthetic Medication", unitPriceMinor: 200 },
    { _id: foreignInventory, hospitalId: foreignHospital, medicationCode: "FOREIGN", medicationName: "Synthetic Foreign Medication" }]);
  for (const [label, principalId, _role, _dept, tenant] of staff) sessions[label] = await session(principalId, "staff", tenant || hospital);
  for (const [label, principalId, kind] of [["patient", patient, "user"], ["stranger", stranger, "user"], ["doctor", independentDoctor, "doctor"]]) sessions[label] = await session(principalId, kind);
  const app = express(); app.use(express.json()); app.use("/labs", labRouter); app.use("/pharmacy", pharmacyRouter);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.status ? error.message : "Isolated request failed" }));
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); origin = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.name === uri.pathname.slice(1)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); await closeRedis();
});

test("creation derives family snapshot, actor and catalog values from the assigned visit", async () => {
  const lab = await http("/labs/orders", "clinician", labInput({ encounterJourneyId: String(encounter),
    patientInfo: { name: "Forged patient" }, orderingDoctorName: "Forged doctor", hospitalId: String(foreignHospital),
    tests: [{ catalogId: String(catalog), testName: "Forged test", priceMinor: 0 }] }));
  assert.equal(lab.status, 201, JSON.stringify(lab.body)); labOrder = lab.body.order;
  assert.equal(labOrder.patientInfo.name, "Synthetic Family Member"); assert.equal(labOrder.familyMemberId, String(family));
  assert.equal(labOrder.patientId, String(patient)); assert.equal(labOrder.hospitalId, String(hospital));
  assert.equal(labOrder.orderingDoctorId, String(clinician)); assert.equal(labOrder.orderingDoctorName, "Synthetic Staff");
  assert.equal(labOrder.tests[0].testName, "Synthetic Test"); assert.equal(labOrder.tests[0].priceMinor, 4500);
  const rx = await http("/pharmacy/prescriptions", "clinician", rxInput({ encounterJourneyId: String(encounter), patientInfo: { name: "Forged" } }));
  assert.equal(rx.status, 201, JSON.stringify(rx.body)); prescription = rx.body.prescription;
  assert.equal(prescription.familyMemberId, String(family)); assert.equal(prescription.items[0].unitPriceMinor, 200);
});

test("foreign doctor, nonclinical staff and another visit cannot create orders", async () => {
  const count = await LabOrder.countDocuments();
  for (const actor of ["otherClinician", "admin", "receptionist", "nurse", "wrongNurse", "labTech", "foreignAdmin", "doctor", "patient"]) {
    assert.ok([401,403].includes((await http("/labs/orders", actor, labInput())).status), actor);
  }
  assert.equal((await http("/labs/orders", "clinician", labInput({ tokenId: String(otherToken) }))).status, 403);
  assert.equal(await LabOrder.countDocuments(), count);
});

test("contradictory patient, family, encounter and department references are rejected", async () => {
  for (const extra of [{ patientId: String(stranger) }, { familyMemberId: String(id()) }, { departmentId: String(otherDepartment) },
    { personKey: "forged-person" }, { encounterJourneyId: String(otherEncounter) }]) {
    assert.equal((await http("/labs/orders", "clinician", labInput(extra))).status, 403);
    assert.equal((await http("/pharmacy/prescriptions", "clinician", rxInput(extra))).status, 403);
  }
});

test("only active consultation and explicit assigned service department permit new orders", async () => {
  assert.equal((await http("/labs/orders", "clinician", labInput({ tokenId: "invalid" }))).status, 400);
  assert.equal((await http("/labs/orders", "clinician", labInput({ serviceDepartmentId: undefined }))).status, 400);
  assert.equal((await http("/labs/orders", "clinician", labInput({ serviceDepartmentId: String(department) }))).status, 403);
  await OpdToken.updateOne({ _id: token }, { $set: { status: "completed" } });
  assert.equal((await http("/labs/orders", "clinician", labInput())).status, 409);
  assert.equal((await http("/pharmacy/prescriptions", "clinician", rxInput())).status, 409);
  await OpdToken.updateOne({ _id: token }, { $set: { status: "in_consultation" } });
});

test("catalog items must be active, distinct and tenant scoped; prescribed amounts are explicit", async () => {
  for (const catalogId of [foreignCatalog, inactiveCatalog]) assert.equal((await http("/labs/orders", "clinician", labInput({ tests: [{ catalogId }] }))).status, 403);
  assert.equal((await http("/labs/orders", "clinician", labInput({ tests: [{ catalogId: catalog }, { catalogId: catalog }] }))).status, 400);
  assert.equal((await http("/pharmacy/prescriptions", "clinician", rxInput({ items: [{ ...rxInput().items[0], inventoryId: foreignInventory }] }))).status, 403);
  for (const extra of [{ quantityPrescribed: -1 }, { quantityPrescribed: 1.5 }, { quantityPrescribed: "6" }, { durationDays: 0 }, { directions: "" }]) {
    assert.equal((await http("/pharmacy/prescriptions", "clinician", rxInput({ items: [{ ...rxInput().items[0], ...extra }] }))).status, 400);
  }
});

test("clinical details require assigned clinician, clinical department or correct service department", async () => {
  for (const [path, allowed, denied] of [
    ["/labs/orders/" + labOrder._id, ["clinician", "nurse", "labTech"], ["otherClinician", "wrongNurse", "wrongLabTech", "pharmacist", "admin", "receptionist", "foreignAdmin"]],
    ["/pharmacy/prescriptions/" + prescription._id, ["clinician", "nurse", "pharmacist"], ["otherClinician", "wrongNurse", "wrongPharmacist", "labTech", "admin", "receptionist", "foreignAdmin"]],
  ]) {
    assert.equal((await http(path)).status, 401);
    for (const actor of allowed) assert.equal((await http(path, actor)).status, 200, actor);
    for (const actor of denied) assert.ok([403,404].includes((await http(path, actor)).status), actor);
  }
  assert.equal((await http("/labs/orders/invalid", "labTech")).status, 400);
});

test("worklists do not leak other assignments and adminAccess does not grant clinical authority", async () => {
  for (const [path, field, allowed, excluded] of [
    ["/labs/orders", "orders", "labTech", ["wrongLabTech", "wrongNurse", "otherClinician"]],
    ["/pharmacy/prescriptions", "prescriptions", "pharmacist", ["wrongPharmacist", "wrongNurse", "otherClinician"]],
  ]) {
    assert.equal((await http(path, allowed)).body[field].length, 1);
    for (const actor of excluded) assert.deepEqual((await http(path, actor)).body[field], []);
    for (const actor of ["admin", "receptionist"]) assert.equal((await http(path, actor)).status, 403);
  }
});

test("collection and critical acknowledgement enforce task assignment in router and domain service", async () => {
  const original = await LabOrder.findById(labOrder._id).lean();
  for (const actor of ["wrongLabTech", "wrongNurse", "admin"]) assert.equal((await http("/labs/orders/" + labOrder._id + "/collect", actor, {}, "PATCH")).status, 403);
  await assert.rejects(collectSample({ orderId: labOrder._id, hospitalId: hospital, actor: { id: wrongLabTech, role: "LAB_TECH" } }), error => error.status === 403);
  assert.deepEqual(await LabOrder.findById(labOrder._id).lean(), original);
  assert.equal((await http("/labs/orders/" + labOrder._id + "/acknowledge-critical", "otherClinician", {})).status, 403);
  const collected = await http("/labs/orders/" + labOrder._id + "/collect", "labTech", {}, "PATCH");
  assert.equal(collected.status, 200); assert.equal(collected.body.order.collectedBy, String(labTech));
});

test("billing response contains operational status without clinical notes or results", async () => {
  const order = await LabOrder.create({ ...labOrder, _id: id(), orderStatus: "ordered", clinicalNotes: "Internal clinical note", results: [] });
  const response = await http("/labs/orders/" + order._id + "/billing", "receptionist", {}, "PATCH");
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.body.order).sort(), ["_id", "createdAt", "orderStatus", "updatedAt"]);
  await LabOrder.deleteOne({ _id: order._id });
});

test("patients see owned released results and archived-family history through explicit projections", async () => {
  assert.deepEqual((await http("/labs/patient-results", "patient")).body.results, []);
  await LabOrder.updateOne({ _id: labOrder._id }, { $set: { orderStatus: "released", releasedAt: new Date(), clinicalNotes: "Internal note",
    reportCorrections: [{ version: 1, correctedBy: "Internal staff", reason: "Internal reason" }],
    results: [{ parameterCode: "SYN", parameterName: "Synthetic Parameter", value: 1, unit: "synthetic" }] } });
  const lab = await http("/labs/patient-results", "patient");
  assert.equal(lab.status, 200); assert.equal(lab.body.results.length, 1);
  assert.equal(lab.body.results[0].familyMemberId, String(family)); assert.equal(lab.body.results[0].results[0].value, 1);
  assert.doesNotMatch(JSON.stringify(lab.body), /auditHistory|clinicalNotes|reportCorrections|actorId|verifiedById|personKey|patientId/);
  const rx = await http("/pharmacy/patient-prescriptions", "patient");
  assert.equal(rx.body.prescriptions.length, 1); assert.equal(rx.body.prescriptions[0].items[0].directions, "Synthetic clinician instructions");
  assert.doesNotMatch(JSON.stringify(rx.body), /verificationToken|auditHistory|batchNumber|actorId|personKey|patientId/);
  assert.deepEqual((await http("/labs/patient-results", "stranger")).body.results, []);
  assert.deepEqual((await http("/pharmacy/patient-prescriptions", "stranger")).body.prescriptions, []);
  for (const path of ["/labs/patient-results", "/pharmacy/patient-prescriptions"]) assert.equal((await http(path, "doctor")).status, 403);
});

test("legacy unlinked and contradictory clinical records fail closed without alteration", async () => {
  const legacy = await LabOrder.create({ hospitalId: hospital, patientId: patient, patientInfo: { name: "Legacy Synthetic" }, tests: [], orderStatus: "released" });
  const original = await LabOrder.findById(legacy._id).lean();
  assert.equal((await http("/labs/orders/" + legacy._id, "labTech")).status, 403);
  assert.equal((await http("/labs/orders/" + legacy._id + "/collect", "labTech", {}, "PATCH")).status, 403);
  assert.equal((await http("/labs/patient-results", "patient")).body.results.length, 1);
  assert.deepEqual(await LabOrder.findById(legacy._id).lean(), original);
  await LabOrder.updateOne({ _id: labOrder._id }, { $set: { familyMemberId: id() } });
  assert.equal((await http("/labs/orders/" + labOrder._id, "clinician")).status, 403);
  assert.deepEqual((await http("/labs/patient-results", "patient")).body.results, []);
  await LabOrder.updateOne({ _id: labOrder._id }, { $set: { familyMemberId: family } });
  await LabOrder.updateOne({ _id: labOrder._id }, { $set: { "patientInfo.name": "Mismatched synthetic person" } });
  assert.equal((await http("/labs/orders/" + labOrder._id, "clinician")).status, 403);
  assert.deepEqual((await http("/labs/patient-results", "patient")).body.results, []);
  await LabOrder.updateOne({ _id: labOrder._id }, { $set: { "patientInfo.name": "Synthetic Family Member" } });
});

test("unimplemented clinical verification and unsafe stock actions fail explicitly without writes", async () => {
  const beforeLab = await LabOrder.findById(labOrder._id).lean(), beforeRx = await Prescription.findById(prescription._id).lean();
  const beforeStock = await PharmacyInventory.findById(inventory).lean();
  for (const action of ["verify", "release", "correct"]) {
    assert.equal((await http("/labs/orders/" + labOrder._id + "/" + action, "labTech", { reason: "Synthetic reason", results: [{ parameterCode: "SYN", value: 1 }] }, action === "correct" ? "POST" : "PATCH")).status, 503);
    assert.equal((await http("/labs/orders/" + labOrder._id + "/" + action, "wrongLabTech", { reason: "Synthetic reason", results: [{ parameterCode: "SYN", value: 1 }] }, action === "correct" ? "POST" : "PATCH")).status, 403);
  }
  for (const action of ["dispense", "return"]) {
    const body = { items: [{ itemId: prescription.items[0]._id, quantityToDispense: 1, quantity: 1 }], reason: "Synthetic reason" };
    assert.equal((await http("/pharmacy/prescriptions/" + prescription._id + "/" + action, "pharmacist", body)).status, 503);
    assert.equal((await http("/pharmacy/prescriptions/" + prescription._id + "/" + action, "wrongPharmacist", body)).status, 403);
  }
  assert.deepEqual(await LabOrder.findById(labOrder._id).lean(), beforeLab);
  assert.deepEqual(await Prescription.findById(prescription._id).lean(), beforeRx);
  assert.deepEqual(await PharmacyInventory.findById(inventory).lean(), beforeStock);
});

test("public QR discloses document status without patient, prescriber, medication or bearer-secret data", async () => {
  const legacy = await Prescription.create({ hospitalId: hospital, patientId: patient, patientInfo: { name: "Legacy Synthetic" }, verificationToken: "RX-0000000000000000", items: [] });
  assert.equal((await http("/pharmacy/verify-qr/" + legacy.verificationToken)).status, 403);
  const response = await http("/pharmacy/verify-qr/" + prescription.verificationToken);
  assert.equal(response.status, 200); assert.equal(response.body.verified, true);
  assert.deepEqual(Object.keys(response.body).sort(), ["hospitalName", "prescribedAt", "status", "verified"]);
  assert.equal((await http("/pharmacy/verify-qr/arbitrary")).status, 400);
  await Prescription.updateOne({ _id: prescription._id }, { $set: { status: "cancelled" } });
  assert.equal((await http("/pharmacy/verify-qr/" + prescription.verificationToken)).body.verified, false);
  assert.deepEqual((await http("/pharmacy/patient-prescriptions", "patient")).body.prescriptions, []);
});
