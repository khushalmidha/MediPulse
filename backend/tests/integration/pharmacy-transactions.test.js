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
import { setPharmacyTransactionFault } from "../../services/pharmacyFulfillment.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_pharmacy_" + crypto.randomBytes(6).toString("hex");
const id = () => new mongoose.Types.ObjectId();
const hospital = id(), foreignHospital = id(), department = id(), otherDepartment = id(), serviceDepartment = id(), wrongServiceDepartment = id();
const patient = id(), stranger = id(), family = id(), independentDoctor = id();
const clinician = id(), otherClinician = id(), nurse = id(), wrongNurse = id(), labTech = id(), wrongLabTech = id();
const pharmacist = id(), wrongPharmacist = id(), admin = id(), receptionist = id(), foreignAdmin = id();
const token = id(), otherToken = id(), encounter = id(), otherEncounter = id();
const catalog = id(), foreignCatalog = id(), inactiveCatalog = id(), inventory = id(), foreignInventory = id();
const secondPharmacist = id();
const sessions = {};
let server, origin;
async function session(principalId, kind, hospitalId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId, kind, csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ id: String(principalId), role: kind, sid, ...(kind === "staff" ? { type: "staff", hospitalId: String(hospitalId) } : {}) }, process.env.TOKEN_KEY);
}
async function http(path, actor, body, method = body ? "POST" : "GET", key) {
  const response = await fetch(origin + path, { method, signal: AbortSignal.timeout(10000),
    headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}), ...(actor ? { Authorization: "Bearer " + sessions[actor] } : {}) },
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
    ["pharmacist", pharmacist, "PHARMACIST", serviceDepartment], ["secondPharmacist", secondPharmacist, "PHARMACIST", serviceDepartment], ["wrongPharmacist", wrongPharmacist, "PHARMACIST", wrongServiceDepartment],
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
  const app = express(); app.use(express.json(), cookieParser()); app.use("/labs", labRouter); app.use("/pharmacy", pharmacyRouter);
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ message: error.status ? error.message : "Isolated request failed" }));
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); origin = "http://127.0.0.1:" + server.address().port;
});
after(async () => {
  setPharmacyTransactionFault(null);
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.name === uri.pathname.slice(1)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect(); await closeRedis();
});


async function stock(quantity = 10, batches) {
  const row = await PharmacyInventory.create({ hospitalId: hospital, medicationCode: "SYN-" + crypto.randomBytes(6).toString("hex"),
    medicationName: "Synthetic Medication", unitPriceMinor: 100,
    batches: batches || [{ batchNumber: "BATCH-A", expiryDate: new Date("2099-01-01"), quantityAvailable: quantity }],
    totalStock: batches ? batches.reduce((sum, batch) => sum + batch.quantityAvailable, 0) : quantity });
  return row;
}
async function rxFor(rows) {
  return Prescription.create({ hospitalId: hospital, tokenId: token, departmentId: department, serviceDepartmentId: serviceDepartment,
    patientId: patient, familyMemberId: family, personKey: "synthetic-family-person", patientInfo: { name: "Synthetic Family Member" },
    prescribingDoctorId: clinician, prescribingDoctorName: "Synthetic Staff", fulfillmentLedgerVersion: 1,
    items: rows.map(([inventory, qty]) => ({ inventoryId: inventory._id, medicationCode: inventory.medicationCode,
      medicationName: inventory.medicationName, directions: "Synthetic directions", quantityPrescribed: qty, unitPriceMinor: 100 })) });
}
const fillRows = (rx, qty, batchNumber) => [{ itemId: String(rx.items[0]._id), quantityToDispense: qty, ...(batchNumber ? { batchNumber } : {}) }];
const execute = (rx, kind, items, options = {}) => http("/pharmacy/prescriptions/" + rx._id + "/" + kind,
  options.actor || "pharmacist", { items, expectedRevision: options.revision ?? rx.fulfillmentRevision ?? 0, reason: options.reason || "Synthetic audited return" }, "POST", options.key || crypto.randomUUID());
const snapshot = async (rx, inventory) => ({ rx: await Prescription.findById(rx._id).lean(), inventory: await PharmacyInventory.findById(inventory._id).lean() });

 test("partial fills derive status from every item and retain exact immutable batch allocations", async () => {
  const a = await stock(), b = await stock(), rx = await rxFor([[a, 6], [b, 2]]);
  const first = await execute(rx, "dispense", fillRows(rx, 3));
  assert.equal(first.status, 200, JSON.stringify(first.body)); assert.equal(first.body.prescription.status, "partially_dispensed");
  assert.equal(first.body.prescription.items[1].quantityDispensed, 0);
  const original = first.body.prescription.fulfillmentOperations[0];
  const second = await execute(first.body.prescription, "dispense", fillRows(rx, 3));
  assert.equal(second.status, 200); assert.equal(second.body.prescription.status, "partially_dispensed");
  assert.deepEqual(second.body.prescription.fulfillmentOperations[0], original);
  const third = await execute(second.body.prescription, "dispense", [{ itemId: String(rx.items[1]._id), quantityToDispense: 2 }]);
  assert.equal(third.status, 200); assert.equal(third.body.prescription.status, "dispensed");
  assert.equal(third.body.prescription.fulfillmentRevision, 3); assert.equal((await PharmacyInventory.findById(a._id)).totalStock, 4);
 });

 test("FEFO splits fills across batches, excludes expiry and reservations, and preserves all partial history", async () => {
  const inventory = await stock(0, [
    { batchNumber: "EXPIRED", expiryDate: new Date("2001-01-01"), quantityAvailable: 20 },
    { batchNumber: "EARLY", expiryDate: new Date("2090-01-01"), quantityAvailable: 3, quantityReserved: 1 },
    { batchNumber: "LATE", expiryDate: new Date("2099-01-01"), quantityAvailable: 10 },
  ]);
  const rx = await rxFor([[inventory, 8]]), first = await execute(rx, "dispense", fillRows(rx, 4));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.deepEqual(first.body.prescription.fulfillmentOperations[0].allocations.map(row => [row.batchNumber, row.quantity]), [["EARLY", 2], ["LATE", 2]]);
  const second = await execute(first.body.prescription, "dispense", fillRows(rx, 4));
  assert.equal(second.status, 200); assert.equal(second.body.prescription.fulfillmentOperations[1].allocations[0].batchNumber, "LATE");
  const saved = await PharmacyInventory.findById(inventory._id);
  assert.equal(saved.batches[0].quantityAvailable, 20); assert.equal(saved.batches[1].quantityAvailable, 1); assert.equal(saved.batches[1].quantityReserved, 1);
 });

 test("simultaneous duplicate retries produce one fill and replay without another stock deduction", async () => {
  const inventory = await stock(), rx = await rxFor([[inventory, 4]]), key = crypto.randomUUID();
  const replies = await Promise.all([execute(rx, "dispense", fillRows(rx, 4), { key }), execute(rx, "dispense", fillRows(rx, 4), { key })]);
  assert.deepEqual(replies.map(row => row.status), [200,200]); assert.equal(replies.filter(row => row.body.replayed).length, 1);
  assert.equal((await PharmacyInventory.findById(inventory._id)).totalStock, 6);
  assert.equal((await Prescription.findById(rx._id)).fulfillmentOperations.length, 1);
  const conflict = await execute(rx, "dispense", fillRows(rx, 3), { key }); assert.equal(conflict.status, 409);
 });

 test("two prescriptions competing for stock cannot oversell", async () => {
  const inventory = await stock(5), a = await rxFor([[inventory, 4]]), b = await rxFor([[inventory, 4]]);
  const replies = await Promise.all([execute(a, "dispense", fillRows(a, 4)), execute(b, "dispense", fillRows(b, 4), { actor: "secondPharmacist" })]);
  assert.deepEqual(replies.map(row => row.status).sort(), [200,409]);
  assert.equal((await PharmacyInventory.findById(inventory._id)).totalStock, 1);
  assert.equal((await Prescription.findById(replies[0].status === 409 ? a._id : b._id)).fulfillmentOperations.length, 0);
 });

 test("different commands from a stale prescription revision cannot both commit", async () => {
  const inventory = await stock(), rx = await rxFor([[inventory, 6]]);
  const replies = await Promise.all([execute(rx, "dispense", fillRows(rx, 2)), execute(rx, "dispense", fillRows(rx, 2), { actor: "secondPharmacist" })]);
  assert.deepEqual(replies.map(row => row.status).sort(), [200,409]); assert.equal((await PharmacyInventory.findById(inventory._id)).totalStock, 8);
 });

 test("invalid quantities, duplicate items, unknown items, missing keys and revisions leave all records intact", async () => {
  const inventory = await stock(), rx = await rxFor([[inventory, 4]]), before = await snapshot(rx, inventory);
  for (const qty of [0,-1,1.5,"2",null]) assert.equal((await execute(rx, "dispense", fillRows(rx, qty))).status, 400);
  assert.equal((await execute(rx, "dispense", fillRows(rx, 5))).status, 409);
  assert.equal((await execute(rx, "dispense", [...fillRows(rx, 1), ...fillRows(rx, 1)])).status, 400);
  assert.equal((await execute(rx, "dispense", [{ itemId: String(id()), quantityToDispense: 1 }])).status, 400);
  assert.equal((await http("/pharmacy/prescriptions/" + rx._id + "/dispense", "pharmacist", { items: fillRows(rx, 1), expectedRevision: 0 })).status, 428);
  assert.equal((await http("/pharmacy/prescriptions/" + rx._id + "/dispense", "pharmacist", { items: fillRows(rx, 1) }, "POST", crypto.randomUUID())).status, 428);
  assert.equal((await execute(rx, "dispense", fillRows(rx, 1), { key: "bad" })).status, 400);
  assert.deepEqual(await snapshot(rx, inventory), before);
 });

 test("an explicit missing or expired batch never falls back; insufficient stock and foreign inventory do not fabricate fills", async () => {
  const inventory = await stock(0, [{ batchNumber: "EXPIRED", expiryDate: new Date("2001-01-01"), quantityAvailable: 10 }, { batchNumber: "VALID", expiryDate: new Date("2099-01-01"), quantityAvailable: 2 }]);
  const rx = await rxFor([[inventory, 4]]), before = await snapshot(rx, inventory);
  for (const name of ["MISSING", "EXPIRED"]) assert.equal((await execute(rx, "dispense", fillRows(rx, 1, name))).status, 409);
  assert.equal((await execute(rx, "dispense", fillRows(rx, 4))).status, 409); assert.deepEqual(await snapshot(rx, inventory), before);
  const foreign = await PharmacyInventory.create({ hospitalId: foreignHospital, medicationCode: "FOREIGN-STOCK", medicationName: "Synthetic Foreign", batches: [], totalStock: 0 });
  const badRx = await rxFor([[foreign, 1]]); assert.equal((await execute(badRx, "dispense", fillRows(badRx, 1))).status, 409);
 });

 test("failure after inventory saves or before prescription save rolls back every document", async () => {
  for (const phase of ["afterInventorySave", "beforePrescriptionSave"]) {
    const a = await stock(), b = await stock(), rx = await rxFor([[a, 2],[b, 2]]), beforeA = await snapshot(rx, a), beforeB = await snapshot(rx, b);
    setPharmacyTransactionFault(at => { if (at === phase) throw new Error("Synthetic transaction crash"); });
    try { assert.equal((await execute(rx, "dispense", rx.items.map(row => ({ itemId: String(row._id), quantityToDispense: 2 })))).status, 500); }
    finally { setPharmacyTransactionFault(null); }
    assert.deepEqual(await snapshot(rx, a), beforeA); assert.deepEqual(await snapshot(rx, b), beforeB);
  }
 });

 test("a second item with insufficient stock rolls back an earlier item fill in the same command", async () => {
  const a = await stock(), b = await stock(0), rx = await rxFor([[a, 2], [b, 2]]), before = await snapshot(rx, a);
  assert.equal((await execute(rx, "dispense", rx.items.map(row => ({ itemId: String(row._id), quantityToDispense: 2 })))).status, 409);
  assert.deepEqual(await snapshot(rx, a), before);
 });

 test("partial multi-batch returns reference original allocations and quarantine rather than increase available stock", async () => {
  const inventory = await stock(0, [{ batchNumber: "EARLY", expiryDate: new Date("2090-01-01"), quantityAvailable: 2 }, { batchNumber: "LATE", expiryDate: new Date("2099-01-01"), quantityAvailable: 8 }]);
  const rx = await rxFor([[inventory, 6]]), filled = await execute(rx, "dispense", fillRows(rx, 6)), original = filled.body.prescription.fulfillmentOperations[0];
  const key = crypto.randomUUID(), allocation = original.allocations[0];
  const back = await execute(filled.body.prescription, "return", [{ allocationId: allocation._id, quantity: 1 }], { key });
  assert.equal(back.status, 200, JSON.stringify(back.body)); assert.equal(back.body.prescription.items[0].quantityDispensed, 5);
  assert.equal(back.body.prescription.items[0].quantityFulfilled, 6); assert.equal(back.body.prescription.items[0].quantityReturned, 1);
  assert.deepEqual(back.body.prescription.fulfillmentOperations[0], original);
  const saved = await PharmacyInventory.findById(inventory._id);
  assert.equal(saved.totalStock, 4); assert.equal(saved.batches[0].quantityAvailable, 0); assert.equal(saved.batches[0].quantityQuarantined, 1);
  const replay = await execute(filled.body.prescription, "return", [{ allocationId: allocation._id, quantity: 1 }], { key }); assert.equal(replay.status, 200); assert.equal(replay.body.replayed, true);
  assert.equal((await PharmacyInventory.findById(inventory._id)).batches[0].quantityQuarantined, 1);
  assert.equal((await execute(back.body.prescription, "dispense", fillRows(rx, 1))).status, 409);
  const allBack = await execute(back.body.prescription, "return", [{ allocationId: allocation._id, quantity: 1 }, { allocationId: original.allocations[1]._id, quantity: 4 }]);
  assert.equal(allBack.status, 200); assert.equal(allBack.body.prescription.status, "returned"); assert.equal(allBack.body.prescription.items[0].quantityDispensed, 0);
 });

 test("negative, excessive, duplicate and unknown returns do not change allocations or stock", async () => {
  const inventory = await stock(), rx = await rxFor([[inventory, 3]]), filled = await execute(rx, "dispense", fillRows(rx, 3));
  const current = filled.body.prescription, allocationId = current.fulfillmentOperations[0].allocations[0]._id, before = await snapshot(rx, inventory);
  for (const quantity of [0,-1,1.5,"1"]) assert.equal((await execute(current, "return", [{ allocationId, quantity }])).status, 400);
  assert.equal((await execute(current, "return", [{ allocationId, quantity: 4 }])).status, 409);
  assert.equal((await execute(current, "return", [{ allocationId, quantity: 1 }, { allocationId, quantity: 1 }])).status, 400);
  assert.equal((await execute(current, "return", [{ allocationId: String(id()), quantity: 1 }])).status, 400);
  assert.equal((await execute(current, "return", [{ itemId: String(rx.items[0]._id), quantity: 1 }])).status, 400);
  for (const reason of ["", {}, 7, "x".repeat(1001)]) {
    assert.equal((await http("/pharmacy/prescriptions/" + current._id + "/return", "pharmacist", { items: [{ allocationId, quantity: 1 }], expectedRevision: current.fulfillmentRevision, reason }, "POST", crypto.randomUUID())).status, 400);
  }
  assert.deepEqual(await snapshot(rx, inventory), before);
 });

 test("two returns cannot claim the same outstanding allocation twice", async () => {
  const inventory = await stock(), rx = await rxFor([[inventory, 2]]), filled = await execute(rx, "dispense", fillRows(rx, 2));
  const current = filled.body.prescription, allocationId = current.fulfillmentOperations[0].allocations[0]._id;
  const replies = await Promise.all([execute(current, "return", [{ allocationId, quantity: 2 }]), execute(current, "return", [{ allocationId, quantity: 2 }])]);
  assert.deepEqual(replies.map(row => row.status).sort(), [200,409]); assert.equal((await PharmacyInventory.findById(inventory._id)).batches[0].quantityQuarantined, 2);
 });

 test("a crash during return rolls back quarantined stock and prescription totals", async () => {
  const inventory = await stock(), rx = await rxFor([[inventory, 2]]), filled = await execute(rx, "dispense", fillRows(rx, 2)), before = await snapshot(rx, inventory);
  setPharmacyTransactionFault(at => { if (at === "afterInventorySave") throw new Error("Synthetic return crash"); });
  try { assert.equal((await execute(filled.body.prescription, "return", [{ allocationId: filled.body.prescription.fulfillmentOperations[0].allocations[0]._id, quantity: 1 }])).status, 500); }
  finally { setPharmacyTransactionFault(null); }
  assert.deepEqual(await snapshot(rx, inventory), before);
 });

 test("historical fills without allocations and corrupted totals are preserved for reviewed repair", async () => {
  const inventory = await stock(), rx = await rxFor([[inventory, 5]]);
  await Prescription.updateOne({ _id: rx._id }, { $unset: { fulfillmentLedgerVersion: "" }, $set: { "items.0.quantityDispensed": 2, status: "partially_dispensed" } });
  const before = await snapshot(rx, inventory); assert.equal((await execute(rx, "dispense", fillRows(rx, 1))).status, 409); assert.deepEqual(await snapshot(rx, inventory), before);
  const virgin = await rxFor([[inventory, 2]]); await Prescription.updateOne({ _id: virgin._id }, { $unset: { fulfillmentLedgerVersion: "" } });
  const fill = await execute(virgin, "dispense", fillRows(virgin, 1)); assert.equal(fill.status, 200); assert.equal(fill.body.prescription.fulfillmentLedgerVersion, 1);
  await Prescription.updateOne({ _id: virgin._id }, { $set: { "items.0.quantityDispensed": 0 } });
  const corrupt = await snapshot(virgin, inventory); assert.equal((await execute(fill.body.prescription, "dispense", fillRows(virgin, 1))).status, 409); assert.deepEqual(await snapshot(virgin, inventory), corrupt);
 });

 test("batch receipts are retry safe, reject invalid quantities/dates and preserve dispensing across replay", async () => {
  const inventory = await stock(0), key = crypto.randomUUID(), path = "/pharmacy/inventory/" + inventory._id + "/batches";
  const body = { batchNumber: "RECEIVED", expiryDate: "2099-12-01", quantity: 5 };
  const receipt = await http(path, "pharmacist", body, "POST", key); assert.equal(receipt.status, 201);
  const rx = await rxFor([[inventory, 2]]); assert.equal((await execute(rx, "dispense", fillRows(rx, 2, "RECEIVED"))).status, 200);
  assert.equal((await http(path, "pharmacist", body, "POST", key)).status, 201); assert.equal((await PharmacyInventory.findById(inventory._id)).totalStock, 3);
  assert.equal((await http(path, "pharmacist", { ...body, quantity: 6 }, "POST", key)).status, 409);
  assert.equal((await http(path, "pharmacist", body, "POST", crypto.randomUUID())).status, 409);
  for (const extra of [{ quantity: -1 }, { quantity: 1.5 }, { quantity: "5" }, { expiryDate: "2099-02-31" }, { expiryDate: "2001-01-01" }]) {
    assert.equal((await http(path, "pharmacist", { ...body, batchNumber: "NEW", ...extra }, "POST", crypto.randomUUID())).status, 400);
  }
 });

 test("competing batch receipts and simultaneous receipt/dispense do not lose stock", async () => {
  const inventory = await stock(5), path = "/pharmacy/inventory/" + inventory._id + "/batches", body = { batchNumber: "NEW", expiryDate: "2099-12-01", quantity: 5 };
  const replies = await Promise.all([http(path, "pharmacist", body, "POST", crypto.randomUUID()), http(path, "pharmacist", body, "POST", crypto.randomUUID())]);
  assert.deepEqual(replies.map(row => row.status).sort(), [201,409]);
  const rx = await rxFor([[inventory, 2]]);
  const race = await Promise.all([execute(rx, "dispense", fillRows(rx, 2)), http(path, "pharmacist", { ...body, batchNumber: "ANOTHER", quantity: 3 }, "POST", crypto.randomUUID())]);
  assert.deepEqual(race.map(row => row.status), [200,201]); assert.equal((await PharmacyInventory.findById(inventory._id)).totalStock, 11);
 });

 test("real browser-cookie pharmacy mutations require the staff session CSRF token", async () => {
  const inventory = await stock(), rx = await rxFor([[inventory, 2]]), before = await snapshot(rx, inventory);
  const path = origin + "/pharmacy/prescriptions/" + rx._id + "/dispense", key = crypto.randomUUID();
  const send = async csrf => fetch(path, { method: "POST", headers: { Cookie: "staffToken=" + sessions.pharmacist,
    Origin: "http://127.0.0.1:15173", "Content-Type": "application/json", "Idempotency-Key": key,
    ...(csrf ? { "X-CSRF-Token": csrf } : {}) }, body: JSON.stringify({ items: fillRows(rx, 2), expectedRevision: 0 }) });
  assert.equal((await send()).status, 403); assert.equal((await send("wrong-account-csrf")).status, 403);
  assert.deepEqual(await snapshot(rx, inventory), before);
  const valid = await send("isolated-csrf"); assert.equal(valid.status, 200, JSON.stringify(await valid.json()));
  assert.equal((await PharmacyInventory.findById(inventory._id)).totalStock, 8);
 });
