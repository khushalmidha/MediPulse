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
import { setLabCreationFault, createLabOrder } from "../../services/labService.js";
import { setPharmacyCreationFault, createPrescription } from "../../services/pharmacyService.js";
import { transitionVisit } from "../../services/visitTransitions.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_clinical_order_creation_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
const hospital = id(), foreignHospital = id();
const department = id(), otherDepartment = id();
const serviceDepartmentLab = id(), serviceDepartmentRx = id();
const patient = id(), foreignPatient = id(), family = id();
const clinician = id(), otherClinician = id(), labTech = id(), pharmacist = id();
const catalogA = id(), catalogB = id(), inactiveCatalog = id(), foreignCatalog = id();
const inventoryA = id(), inventoryB = id(), foreignInventory = id();

const sessions = {};
let server, origin;

async function session(principalId, kind, hospitalId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId, kind, csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ id: String(principalId), role: kind, sid, ...(kind === "staff" ? { type: "staff", hospitalId: String(hospitalId) } : {}) }, process.env.TOKEN_KEY);
}

async function http(path, actor, body, method = body ? "POST" : "GET", key) {
  const response = await fetch(origin + path, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      ...(key ? { "Idempotency-Key": key } : {}),
      ...(actor ? { Authorization: "Bearer " + sessions[actor] } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

async function createVisitFixture({ status = "in_consultation", docId = clinician, deptId = department } = {}) {
  const tokenId = id();
  const encounterId = id();
  const pKey = "synthetic-person-" + tokenId;
  const visit = {
    hospitalId: hospital,
    departmentId: deptId,
    doctorId: docId,
    patientId: patient,
    familyMemberId: family,
    personKey: pKey,
    patientInfo: { name: "Synthetic Family Member", age: 24, gender: "female" },
    status,
    date: new Date(),
    serviceDate: "2026-10-21",
    sessionId: "day",
    timezone: "Asia/Kolkata",
    createdAt: new Date(),
  };
  const token = await OpdToken.create({
    _id: tokenId,
    ...visit,
    tokenNumber: Math.floor(Math.random() * 1000) + 1,
    queueKey: `queue:${hospital}:${deptId}:${tokenId}`,
    practiceKey: `practice:${hospital}`,
  });
  const encounter = await EncounterJourney.create({
    _id: encounterId,
    ...visit,
    tokenId,
    ticketNumber: "TK-" + crypto.randomBytes(4).toString("hex").toUpperCase(),
    currentStage: status === "completed" ? "completed" : "consultation",
  });
  return { token, encounter };
}

before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
  await Promise.all([LabOrder, Prescription, OpdToken, EncounterJourney, HospitalStaff, Department, User, AuthSession, LabTestCatalog, PharmacyInventory].map(M => M.createIndexes()));

  await User.collection.insertMany([
    { _id: patient, email: "patient-" + patient + "@example.invalid", firstName: "Synthetic Account", authVersion: 0, familyMembers: [{ _id: family, name: "Synthetic Family Member", archivedAt: null }] },
    { _id: foreignPatient, email: "foreign-" + foreignPatient + "@example.invalid", firstName: "Foreign Account", authVersion: 0 },
  ]);

  await Hospital.collection.insertMany([
    { _id: hospital, name: "Test Hospital", slug: String(hospital), status: "active" },
    { _id: foreignHospital, name: "Foreign Hospital", slug: String(foreignHospital), status: "active" },
  ]);

  await Department.collection.insertMany([
    { _id: department, hospitalId: hospital, status: "active", name: "OPD Department", code: "OPD", slug: "opd", opd: { consultationFee: 100, isAvailable: true } },
    { _id: otherDepartment, hospitalId: hospital, status: "active", name: "Other Department", code: "OTH", slug: "oth", opd: { consultationFee: 100, isAvailable: true } },
    { _id: serviceDepartmentLab, hospitalId: hospital, status: "active", name: "Central Pathology Lab", code: "LAB", slug: "lab", opd: { consultationFee: 0, isAvailable: true } },
    { _id: serviceDepartmentRx, hospitalId: hospital, status: "active", name: "Central Pharmacy", code: "PHARM", slug: "pharm", opd: { consultationFee: 0, isAvailable: true } },
  ]);

  const staff = [
    ["clinician", clinician, "DOCTOR", department],
    ["otherClinician", otherClinician, "DOCTOR", otherDepartment],
    ["labTech", labTech, "LAB_TECH", serviceDepartmentLab],
    ["pharmacist", pharmacist, "PHARMACIST", serviceDepartmentRx],
  ];
  await HospitalStaff.collection.insertMany(staff.map(([label, _id, role, dept]) => ({
    _id,
    role,
    hospitalId: hospital,
    email: `${label}-${_id}@example.invalid`,
    departmentIds: [dept],
    name: "Staff " + role,
    isActive: true,
    inviteStatus: "accepted",
    authVersion: 0,
  })));

  await LabTestCatalog.create([
    { _id: catalogA, hospitalId: hospital, code: "CBC", name: "Complete Blood Count", parameters: [{ code: "WBC", name: "WBC Count", valueType: "number" }], priceMinor: 2500, isActive: true },
    { _id: catalogB, hospitalId: hospital, code: "LFT", name: "Liver Function Test", parameters: [{ code: "ALT", name: "ALT", valueType: "number" }], priceMinor: 4000, isActive: true },
    { _id: inactiveCatalog, hospitalId: hospital, code: "INACT", name: "Inactive Test", parameters: [{ code: "X", name: "Param X", valueType: "number" }], priceMinor: 1000, isActive: false },
    { _id: foreignCatalog, hospitalId: foreignHospital, code: "FORG", name: "Foreign Test", parameters: [{ code: "F", name: "Param F", valueType: "number" }], priceMinor: 1000, isActive: true },
  ]);

  await PharmacyInventory.create([
    { _id: inventoryA, hospitalId: hospital, medicationCode: "PARA-500", medicationName: "Paracetamol 500mg", unitPriceMinor: 150, isActive: true },
    { _id: inventoryB, hospitalId: hospital, medicationCode: "AMOX-250", medicationName: "Amoxicillin 250mg", unitPriceMinor: 350, isActive: true },
    { _id: foreignInventory, hospitalId: foreignHospital, medicationCode: "FORG-MED", medicationName: "Foreign Med", unitPriceMinor: 200, isActive: true },
  ]);

  for (const [label, principalId, _role, _dept] of staff) {
    sessions[label] = await session(principalId, "staff", hospital);
  }

  const app = express();
  app.use(express.json());
  app.use("/labs", labRouter);
  app.use("/pharmacy", pharmacyRouter);
  app.use((error, _req, res, _next) => {
    res.status(error.status || 500).json({ message: error.status ? error.message : "Internal error" });
  });

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = "http://127.0.0.1:" + server.address().port;
});

after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  if (mongoose.connection.name === uri.pathname.slice(1)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await closeRedis();
});

test("concurrent create with same idempotency key yields exactly one lab order and replays safely", async () => {
  const { token, encounter } = await createVisitFixture();
  const idempotencyKey = "key-lab-concurrent-" + crypto.randomBytes(6).toString("hex");

  const payload = {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(catalogA) }],
    clinicalNotes: "Patient has persistent low-grade fever",
  };

  const [res1, res2] = await Promise.all([
    http("/labs/orders", "clinician", payload, "POST", idempotencyKey),
    http("/labs/orders", "clinician", payload, "POST", idempotencyKey),
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [200, 201]);

  const winner = res1.status === 201 ? res1 : res2;
  const replayed = res1.status === 200 ? res1 : res2;

  assert.equal(winner.body.replayed, false);
  assert.equal(replayed.body.replayed, true);
  assert.equal(winner.body.order._id, replayed.body.order._id);

  const totalInDb = await LabOrder.countDocuments({ hospitalId: hospital, creationKey: idempotencyKey });
  assert.equal(totalInDb, 1);
});

test("concurrent create with same idempotency key yields exactly one prescription and replays safely", async () => {
  const { token, encounter } = await createVisitFixture();
  const idempotencyKey = "key-rx-concurrent-" + crypto.randomBytes(6).toString("hex");

  const payload = {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentRx),
    diagnosis: "Bacterial Pharyngitis",
    items: [
      { inventoryId: String(inventoryA), directions: "1 tab twice daily after meals", durationDays: 5, quantityPrescribed: 10 },
    ],
  };

  const [res1, res2] = await Promise.all([
    http("/pharmacy/prescriptions", "clinician", payload, "POST", idempotencyKey),
    http("/pharmacy/prescriptions", "clinician", payload, "POST", idempotencyKey),
  ]);

  const statuses = [res1.status, res2.status].sort();
  assert.deepEqual(statuses, [200, 201]);

  const winner = res1.status === 201 ? res1 : res2;
  const replayed = res1.status === 200 ? res1 : res2;

  assert.equal(winner.body.replayed, false);
  assert.equal(replayed.body.replayed, true);
  assert.equal(winner.body.prescription._id, replayed.body.prescription._id);

  const totalInDb = await Prescription.countDocuments({ hospitalId: hospital, creationKey: idempotencyKey });
  assert.equal(totalInDb, 1);
});

test("replaying creation key with changed payload is rejected with 409 conflict", async () => {
  const { token, encounter } = await createVisitFixture();

  // Lab order key collision with changed contents
  const labKey = "key-lab-mismatch-" + crypto.randomBytes(6).toString("hex");
  const labInit = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(catalogA) }],
    clinicalNotes: "Initial note",
  }, "POST", labKey);
  assert.equal(labInit.status, 201);

  // Retry with different tests under the same key
  const labDiffTests = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(catalogB) }],
    clinicalNotes: "Initial note",
  }, "POST", labKey);
  assert.equal(labDiffTests.status, 409);
  assert.match(labDiffTests.body.message, /Creation key already used with different contents/);

  // Retry with different notes under the same key
  const labDiffNotes = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(catalogA) }],
    clinicalNotes: "Completely modified note",
  }, "POST", labKey);
  assert.equal(labDiffNotes.status, 409);
  assert.match(labDiffNotes.body.message, /Creation key already used with different contents/);

  // Prescription key collision with changed contents
  const rxKey = "key-rx-mismatch-" + crypto.randomBytes(6).toString("hex");
  const rxInit = await http("/pharmacy/prescriptions", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentRx),
    diagnosis: "Fever",
    items: [{ inventoryId: String(inventoryA), directions: "Daily", durationDays: 3, quantityPrescribed: 3 }],
  }, "POST", rxKey);
  assert.equal(rxInit.status, 201);

  // Retry with different diagnosis
  const rxDiffDiag = await http("/pharmacy/prescriptions", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentRx),
    diagnosis: "Different Diagnosis",
    items: [{ inventoryId: String(inventoryA), directions: "Daily", durationDays: 3, quantityPrescribed: 3 }],
  }, "POST", rxKey);
  assert.equal(rxDiffDiag.status, 409);
  assert.match(rxDiffDiag.body.message, /Creation key already used with different contents/);

  // Retry with different quantity
  const rxDiffQty = await http("/pharmacy/prescriptions", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentRx),
    diagnosis: "Fever",
    items: [{ inventoryId: String(inventoryA), directions: "Daily", durationDays: 3, quantityPrescribed: 99 }],
  }, "POST", rxKey);
  assert.equal(rxDiffQty.status, 409);
  assert.match(rxDiffQty.body.message, /Creation key already used with different contents/);
});

test("fault/crash during transaction rolls back cleanly without persisting orphan records, and retry succeeds", async () => {
  const { token, encounter } = await createVisitFixture();
  const labCrashKey = "key-lab-crash-" + crypto.randomBytes(6).toString("hex");

  // Inject fault before commit
  setLabCreationFault(async (phase) => {
    if (phase === "before_commit") {
      throw new Error("Simulated database crash before commit");
    }
  });

  const failedLab = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(catalogA) }],
  }, "POST", labCrashKey);

  assert.equal(failedLab.status, 500);

  // Confirm rollback: no record exists in DB
  const countAfterCrash = await LabOrder.countDocuments({ hospitalId: hospital, creationKey: labCrashKey });
  assert.equal(countAfterCrash, 0);

  // Remove fault and retry with the exact same key
  setLabCreationFault(null);
  const recoveredLab = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(catalogA) }],
  }, "POST", labCrashKey);

  assert.equal(recoveredLab.status, 201);
  assert.equal(await LabOrder.countDocuments({ hospitalId: hospital, creationKey: labCrashKey }), 1);

  // Repeat for Pharmacy
  const rxCrashKey = "key-rx-crash-" + crypto.randomBytes(6).toString("hex");
  setPharmacyCreationFault(async (phase) => {
    if (phase === "before_commit") {
      throw new Error("Simulated pharmacy crash before commit");
    }
  });

  const failedRx = await http("/pharmacy/prescriptions", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentRx),
    diagnosis: "Acute Bronchitis",
    items: [{ inventoryId: String(inventoryA), directions: "1 tab daily", durationDays: 3, quantityPrescribed: 3 }],
  }, "POST", rxCrashKey);

  assert.equal(failedRx.status, 500);
  assert.equal(await Prescription.countDocuments({ hospitalId: hospital, creationKey: rxCrashKey }), 0);

  setPharmacyCreationFault(null);
  const recoveredRx = await http("/pharmacy/prescriptions", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentRx),
    diagnosis: "Acute Bronchitis",
    items: [{ inventoryId: String(inventoryA), directions: "1 tab daily", durationDays: 3, quantityPrescribed: 3 }],
  }, "POST", rxCrashKey);

  assert.equal(recoveredRx.status, 201);
  assert.equal(await Prescription.countDocuments({ hospitalId: hospital, creationKey: rxCrashKey }), 1);
});

test("ordering care on a completed consultation is rejected with 409 and no order appears", async () => {
  const { token, encounter } = await createVisitFixture({ status: "completed" });

  const labRes = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(catalogA) }],
  }, "POST", "key-completed-lab-" + crypto.randomBytes(4).toString("hex"));

  assert.equal(labRes.status, 409);
  assert.match(labRes.body.message, /Orders require an active consultation/);

  const rxRes = await http("/pharmacy/prescriptions", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentRx),
    diagnosis: "Post consultation check",
    items: [{ inventoryId: String(inventoryA), directions: "1 tab daily", durationDays: 3, quantityPrescribed: 3 }],
  }, "POST", "key-completed-rx-" + crypto.randomBytes(4).toString("hex"));

  assert.equal(rxRes.status, 409);
  assert.match(rxRes.body.message, /Orders require an active consultation/);

  assert.equal(await LabOrder.countDocuments({ tokenId: token._id }), 0);
  assert.equal(await Prescription.countDocuments({ tokenId: token._id }), 0);
});

test("foreign family, catalog, and unassigned doctor remain blocked", async () => {
  const { token, encounter } = await createVisitFixture();

  // Foreign family member
  const foreignFamilyRes = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    familyMemberId: String(id()),
    tests: [{ catalogId: String(catalogA) }],
  });
  assert.equal(foreignFamilyRes.status, 403);

  // Inactive catalog item
  const inactiveCatalogRes = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(inactiveCatalog) }],
  });
  assert.equal(inactiveCatalogRes.status, 403);

  // Foreign hospital catalog item
  const foreignCatalogRes = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(foreignCatalog) }],
  });
  assert.equal(foreignCatalogRes.status, 403);

  // Foreign hospital pharmacy inventory
  const foreignInventoryRes = await http("/pharmacy/prescriptions", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentRx),
    diagnosis: "Test",
    items: [{ inventoryId: String(foreignInventory), directions: "Daily", durationDays: 1, quantityPrescribed: 1 }],
  });
  assert.equal(foreignInventoryRes.status, 403);

  // Unassigned doctor
  const unassignedDoctorRes = await http("/labs/orders", "otherClinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(catalogA) }],
  });
  assert.equal(unassignedDoctorRes.status, 403);

  // Invalid key format (too short / special chars)
  const invalidKeyRes = await http("/labs/orders", "clinician", {
    tokenId: String(token._id),
    encounterJourneyId: String(encounter._id),
    serviceDepartmentId: String(serviceDepartmentLab),
    tests: [{ catalogId: String(catalogA) }],
  }, "POST", "short");
  assert.equal(invalidKeyRes.status, 400);
});

test("create-versus-complete concurrent race serializes safely with no order on completed consultation", async () => {
  const { token, encounter } = await createVisitFixture();

  // Run complete and create concurrently
  const completeAction = transitionVisit({
    tokenId: token._id,
    action: "complete",
    expectedRevision: token.revision || 0,
    actor: { id: clinician, role: "DOCTOR" },
  });

  const orderAction = createLabOrder({
    hospitalId: hospital,
    tokenId: token._id,
    encounterJourneyId: encounter._id,
    serviceDepartmentId: serviceDepartmentLab,
    tests: [{ catalogId: catalogA }],
    actor: { id: clinician, name: "Staff DOCTOR", role: "DOCTOR" },
  });

  const results = await Promise.allSettled([completeAction, orderAction]);
  const [completeRes, orderRes] = results;

  // The visit must be completed now
  const updatedToken = await OpdToken.findById(token._id).lean();
  assert.equal(updatedToken.status, "completed");

  const totalOrders = await LabOrder.countDocuments({ tokenId: token._id });
  if (orderRes.status === "fulfilled") {
    // Order was serialized BEFORE completion
    assert.equal(totalOrders, 1);
  } else {
    // Order was serialized AFTER completion and got 409
    assert.equal(totalOrders, 0);
    assert.equal(orderRes.reason.status, 409);
    assert.match(orderRes.reason.message, /Orders require an active consultation/);
  }

  // Any subsequent attempt to create an order or prescription on the completed token MUST fail
  await assert.rejects(
    createLabOrder({
      hospitalId: hospital,
      tokenId: token._id,
      encounterJourneyId: encounter._id,
      serviceDepartmentId: serviceDepartmentLab,
      tests: [{ catalogId: catalogA }],
      actor: { id: clinician, name: "Staff DOCTOR", role: "DOCTOR" },
    }),
    (err) => err.status === 409 && /Orders require an active consultation/.test(err.message)
  );

  await assert.rejects(
    createPrescription({
      hospitalId: hospital,
      tokenId: token._id,
      encounterJourneyId: encounter._id,
      serviceDepartmentId: serviceDepartmentRx,
      items: [{ inventoryId: inventoryA, directions: "Daily", durationDays: 3, quantityPrescribed: 3 }],
      actor: { id: clinician, name: "Staff DOCTOR", role: "DOCTOR" },
    }),
    (err) => err.status === 409 && /Orders require an active consultation/.test(err.message)
  );

  // Still no new orders can appear
  assert.equal(await LabOrder.countDocuments({ tokenId: token._id }), totalOrders);
});

