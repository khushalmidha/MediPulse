import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import User from "../../model/user.js";
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
import opdRouter from "../../routes/opd.js";
import labRouter from "../../routes/lab.js";
import pharmacyRouter from "../../routes/pharmacy.js";
import { releaseLabResults } from "../../services/labService.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_clinical_hospital_ordering_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id(), foreignHospitalId = id();
const clinicalDeptId = id(), labDeptId = id(), pharmacyDeptId = id(), emptyDeptId = id();
const patientId = id(), familyMemberId = id();
const doctorId = id(), otherDoctorId = id(), labTechId = id(), pharmacistId = id(), nurseId = id();
const testCatalogId = id();
const inventoryId = id();

const sessions = {};
let server, origin;

async function createStaffSession(staffId, role, hId = hospitalId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId: staffId, kind: "staff", csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ id: String(staffId), role: "staff", sid, type: "staff", hospitalId: String(hId) }, process.env.TOKEN_KEY);
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

async function createVisitToken({ status = "in_consultation", doc = doctorId, notes = "", revision = 0 } = {}) {
  const tokenId = id();
  const encounterId = id();
  const token = await OpdToken.create({
    _id: tokenId,
    hospitalId,
    departmentId: clinicalDeptId,
    doctorId: doc,
    patientId,
    familyMemberId,
    personKey: `urn:person:${patientId}:${familyMemberId}`,
    tokenNumber: Math.floor(Math.random() * 900) + 100,
    displayToken: "T101",
    date: new Date(),
    status,
    patientInfo: { name: "Family Patient", age: 10, gender: "female", isWalkIn: false },
    consultationNotes: notes,
    revision,
  });
  await EncounterJourney.create({
    _id: encounterId,
    hospitalId,
    departmentId: clinicalDeptId,
    tokenId,
    patientId,
    familyMemberId,
    personKey: `urn:person:${patientId}:${familyMemberId}`,
    ticketNumber: "T101",
    currentStage: "consultation",
  });
  return token;
}

before(async () => {
  await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  await Promise.all([
    User, Hospital, Department, HospitalStaff, AuthSession, OpdToken,
    EncounterJourney, LabOrder, LabTestCatalog, Prescription, PharmacyInventory,
  ].map((Model) => Model.createIndexes()));

  await Hospital.collection.insertMany([
    { _id: hospitalId, email: "ag07@example.invalid", name: "AG07 Hospital", slug: "ag07-hospital", status: "active", settings: { timezone: "UTC" } },
    { _id: foreignHospitalId, email: "foreign@example.invalid", name: "Foreign Hospital", slug: "foreign-hospital", status: "active", settings: { timezone: "UTC" } },
  ]);

  await Department.collection.insertMany([
    { _id: clinicalDeptId, hospitalId, name: "Cardiology", code: "CARD", status: "active" },
    { _id: labDeptId, hospitalId, name: "Pathology Laboratory", code: "LAB", status: "active" },
    { _id: pharmacyDeptId, hospitalId, name: "Central Pharmacy", code: "PHARM", status: "active" },
    { _id: emptyDeptId, hospitalId, name: "Unstaffed Dept", code: "EMPTY", status: "active" },
  ]);

  await User.collection.insertMany([
    {
      _id: patientId,
      firstName: "Parent",
      lastName: "Patient",
      email: "parent@example.invalid",
      gender: "male",
      authVersion: 0,
      familyMembers: [{ _id: familyMemberId, name: "Family Patient", relationship: "child", gender: "female", archivedAt: null }],
    },
  ]);

  await HospitalStaff.collection.insertMany([
    { _id: doctorId, hospitalId, name: "Dr. Assigned", email: "doc@example.invalid", role: "DOCTOR", departmentIds: [clinicalDeptId], isActive: true, inviteStatus: "accepted", authVersion: 0 },
    { _id: otherDoctorId, hospitalId, name: "Dr. Other", email: "otherdoc@example.invalid", role: "DOCTOR", departmentIds: [clinicalDeptId], isActive: true, inviteStatus: "accepted", authVersion: 0 },
    { _id: labTechId, hospitalId, name: "Tech Lab", email: "labtech@example.invalid", role: "LAB_TECH", departmentIds: [labDeptId], isActive: true, inviteStatus: "accepted", labReviewApproval: { enabled: true }, authVersion: 0 },
    { _id: pharmacistId, hospitalId, name: "Pharm Specialist", email: "pharm@example.invalid", role: "PHARMACIST", departmentIds: [pharmacyDeptId], isActive: true, inviteStatus: "accepted", authVersion: 0 },
    { _id: nurseId, hospitalId, name: "Nurse Jane", email: "nurse@example.invalid", role: "NURSE", departmentIds: [clinicalDeptId], isActive: true, inviteStatus: "accepted", authVersion: 0 },
  ]);

  await LabTestCatalog.create({
    _id: testCatalogId,
    hospitalId,
    code: "CBC",
    name: "Complete Blood Count",
    category: "Hematology",
    specimenType: "Whole Blood",
    parameters: [
      { code: "WBC", name: "White Blood Cells", unit: "10^3/uL", valueType: "number", refMin: 4.0, refMax: 11.0, criticalLow: 2.0, criticalHigh: 30.0 },
      { code: "HGB", name: "Hemoglobin", unit: "g/dL", valueType: "number", refMin: 12.0, refMax: 16.0, criticalLow: 6.0, criticalHigh: 20.0 },
    ],
    priceMinor: 25000,
    isActive: true,
  });

  await PharmacyInventory.create({
    _id: inventoryId,
    hospitalId,
    medicationCode: "AMOX500",
    medicationName: "Amoxicillin 500mg",
    genericName: "Amoxicillin",
    dosageForm: "capsule",
    strength: "500mg",
    unitPriceMinor: 1500,
    isActive: true,
    batches: [{ batchNumber: "B1", expiryDate: new Date("2028-01-01"), quantityAvailable: 100, quantityReserved: 0, quantityQuarantined: 0 }],
    totalStock: 100,
  });

  sessions.doctor = await createStaffSession(doctorId, "DOCTOR");
  sessions.otherDoctor = await createStaffSession(otherDoctorId, "DOCTOR");
  sessions.labTech = await createStaffSession(labTechId, "LAB_TECH");
  sessions.pharmacist = await createStaffSession(pharmacistId, "PHARMACIST");
  sessions.nurse = await createStaffSession(nurseId, "NURSE");

  const app = express();
  app.use(express.json());
  app.use("/api/opd", opdRouter);
  app.use("/api/labs", labRouter);
  app.use("/api/pharmacy", pharmacyRouter);
  app.use((err, _req, res, _next) => {
    res.status(err.status || 500).json({ message: err.status ? err.message : "Error" });
  });

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = "http://127.0.0.1:" + server.address().port;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.name === uri.pathname.slice(1)) await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await closeRedis();
});

test("service departments endpoint filters active departments by LAB_TECH and PHARMACIST roles", async () => {
  const res = await http(`/api/opd/${hospitalId}/service-departments`, "doctor");
  assert.equal(res.status, 200);
  assert.ok(res.body.serviceDepartments);
  const labDepts = res.body.serviceDepartments.lab;
  const pharmacyDepts = res.body.serviceDepartments.pharmacy;

  assert.equal(labDepts.length, 1);
  assert.equal(labDepts[0]._id, String(labDeptId));
  assert.equal(pharmacyDepts.length, 1);
  assert.equal(pharmacyDepts[0]._id, String(pharmacyDeptId));
  // Empty department has no staff assigned, so must NOT appear in service departments
  assert.ok(!labDepts.some((d) => String(d._id) === String(emptyDeptId)));
  assert.ok(!pharmacyDepts.some((d) => String(d._id) === String(emptyDeptId)));
});

test("hospital token notes require assigned doctor, valid revision and update clinical snapshot", async () => {
  const token = await createVisitToken({ notes: "Baseline notes", revision: 0 });

  // Wrong actor: nurse cannot save notes
  const nurseRes = await http(`/api/opd/tokens/${token._id}/notes`, "nurse", { doctorNotes: "Nurse note", revision: 0 }, "PATCH");
  assert.equal(nurseRes.status, 403);

  // Wrong doctor cannot save notes for assigned doctor's token
  const wrongDocRes = await http(`/api/opd/tokens/${token._id}/notes`, "otherDoctor", { doctorNotes: "Unauthorized", revision: 0 }, "PATCH");
  assert.equal(wrongDocRes.status, 403);

  // Stale revision is rejected with 409
  const staleRes = await http(`/api/opd/tokens/${token._id}/notes`, "doctor", { doctorNotes: "New note", revision: 5 }, "PATCH");
  assert.equal(staleRes.status, 409);

  // Oversized notes rejected with 400
  const oversizedRes = await http(`/api/opd/tokens/${token._id}/notes`, "doctor", { doctorNotes: "x".repeat(12001), revision: 0 }, "PATCH");
  assert.equal(oversizedRes.status, 400);

  // Valid note save succeeds, increments revision, preserves previous snapshot in clinicalHistory
  const validRes = await http(`/api/opd/tokens/${token._id}/notes`, "doctor", { doctorNotes: "Updated consultation note", revision: 0 }, "PATCH");
  assert.equal(validRes.status, 200);
  assert.equal(validRes.body.revision, 1);
  assert.equal(validRes.body.consultationNotes, "Updated consultation note");

  const saved = await OpdToken.findById(token._id);
  assert.equal(saved.revision, 1);
  assert.equal(saved.consultationNotes, "Updated consultation note");
  assert.equal(saved.clinicalHistory.length, 1);
  assert.equal(saved.clinicalHistory[0].consultationNotes, "Baseline notes");
  assert.equal(String(saved.clinicalHistory[0].actorId), String(doctorId));
});

test("parallel hospital note saves yield one winner and preserve revision serializability", async () => {
  const token = await createVisitToken({ notes: "Initial", revision: 0 });
  const [resA, resB] = await Promise.all([
    http(`/api/opd/tokens/${token._id}/notes`, "doctor", { doctorNotes: "Edit from Tab A", revision: 0 }, "PATCH"),
    http(`/api/opd/tokens/${token._id}/notes`, "doctor", { doctorNotes: "Edit from Tab B", revision: 0 }, "PATCH"),
  ]);

  const statuses = [resA.status, resB.status].sort();
  assert.deepEqual(statuses, [200, 409]);

  const updated = await OpdToken.findById(token._id);
  assert.equal(updated.revision, 1);
  assert.equal(updated.clinicalHistory.length, 1);
});

test("hospital SOAP draft generation, versioning, note invalidation and version-bound approval", async () => {
  const token = await createVisitToken({ notes: "Patient presents with persistent cough", revision: 0 });

  // Generate SOAP draft
  const draftRes = await http(`/api/opd/tokens/${token._id}/generate-soap`, "doctor", { revision: 0 });
  assert.equal(draftRes.status, 200);
  assert.equal(draftRes.body.revision, 1);
  assert.ok(draftRes.body.soapNote);
  assert.equal(draftRes.body.soapNote.version, 1);
  assert.equal(draftRes.body.soapNote.isDraft, true);
  assert.equal(draftRes.body.soapNote.clinicianApproved, false);

  // Invalid note version on approval returns 409
  const badVersionRes = await http(`/api/opd/tokens/${token._id}/soap-note/approve`, "doctor", { revision: 1, noteVersion: 99 });
  assert.equal(badVersionRes.status, 409);

  // Stale revision on approval returns 409
  const staleApproveRes = await http(`/api/opd/tokens/${token._id}/soap-note/approve`, "doctor", { revision: 0, noteVersion: 1 });
  assert.equal(staleApproveRes.status, 409);

  // Valid approval succeeds
  const approvedRes = await http(`/api/opd/tokens/${token._id}/soap-note/approve`, "doctor", { revision: 1, noteVersion: 1 });
  assert.equal(approvedRes.status, 200);
  assert.equal(approvedRes.body.revision, 2);
  assert.equal(approvedRes.body.soapNote.clinicianApproved, true);
  assert.equal(approvedRes.body.soapNote.isDraft, false);

  // Subsequent note edit invalidates SOAP approval
  const editRes = await http(`/api/opd/tokens/${token._id}/notes`, "doctor", { doctorNotes: "Altered complaint after examination", revision: 2 }, "PATCH");
  assert.equal(editRes.status, 200);
  assert.equal(editRes.body.revision, 3);
  assert.equal(editRes.body.soapNote.clinicianApproved, false);
  assert.equal(editRes.body.soapNote.isDraft, true);

  // Old SOAP version 1 cannot be approved against altered notes
  const oldVersionApprove = await http(`/api/opd/tokens/${token._id}/soap-note/approve`, "doctor", { revision: 3, noteVersion: 1 });
  assert.equal(oldVersionApprove.status, 409);
});

test("terminal hospital token status rejects note and SOAP edits", async () => {
  for (const terminalStatus of ["completed", "cancelled", "no_show"]) {
    const token = await createVisitToken({ status: terminalStatus, notes: "Final", revision: 0 });
    const noteRes = await http(`/api/opd/tokens/${token._id}/notes`, "doctor", { doctorNotes: "Late note", revision: 0 }, "PATCH");
    assert.equal(noteRes.status, 409);
    const soapRes = await http(`/api/opd/tokens/${token._id}/generate-soap`, "doctor", { revision: 0 });
    assert.equal(soapRes.status, 409);
  }
});

test("connected clinician ordering: hospital doctor orders for family patient and service worklist receives it once", async () => {
  const token = await createVisitToken({ status: "in_consultation", revision: 0 });
  const labKey = "lab-order-cmd-" + crypto.randomUUID();
  const rxKey = "rx-order-cmd-" + crypto.randomUUID();

  // 1. Order lab test targeting lab service department
  const labPayload = {
    tokenId: token._id,
    serviceDepartmentId: labDeptId,
    tests: [{ catalogId: testCatalogId }],
    clinicalNotes: "Rule out anemia",
    creationKey: labKey,
  };

  const labCreateRes = await http("/api/labs/orders", "doctor", labPayload, "POST", labKey);
  assert.equal(labCreateRes.status, 201);
  assert.equal(labCreateRes.body.replayed, false);
  const orderId = labCreateRes.body.order._id;
  assert.ok(orderId);

  // Idempotent retry with SAME creation key returns 200 and replayed: true
  const labReplayRes = await http("/api/labs/orders", "doctor", labPayload, "POST", labKey);
  assert.equal(labReplayRes.status, 200);
  assert.equal(labReplayRes.body.replayed, true);
  assert.equal(labReplayRes.body.order._id, orderId);

  // Changed payload under SAME key returns 409 conflict
  const labConflictRes = await http("/api/labs/orders", "doctor", { ...labPayload, clinicalNotes: "Different notes" }, "POST", labKey);
  assert.equal(labConflictRes.status, 409);

  // 2. Order prescription targeting pharmacy service department
  const rxPayload = {
    tokenId: token._id,
    serviceDepartmentId: pharmacyDeptId,
    diagnosis: "Bacterial infection",
    items: [{ inventoryId, quantityPrescribed: 10, directions: "1 cap tid", durationDays: 5 }],
    creationKey: rxKey,
  };

  const rxCreateRes = await http("/api/pharmacy/prescriptions", "doctor", rxPayload, "POST", rxKey);
  assert.equal(rxCreateRes.status, 201);
  assert.equal(rxCreateRes.body.replayed, false);
  const prescriptionId = rxCreateRes.body.prescription._id;
  assert.ok(prescriptionId);

  // Idempotent retry with SAME key returns 200 and replayed: true
  const rxReplayRes = await http("/api/pharmacy/prescriptions", "doctor", rxPayload, "POST", rxKey);
  assert.equal(rxReplayRes.status, 200);
  assert.equal(rxReplayRes.body.replayed, true);
  assert.equal(rxReplayRes.body.prescription._id, prescriptionId);

  // 3. Worklist retrieval: Token worklist filters return the placed orders
  const tokenLabList = await http(`/api/labs/orders?tokenId=${token._id}`, "doctor");
  assert.equal(tokenLabList.status, 200);
  assert.equal(tokenLabList.body.orders.length, 1);
  assert.equal(tokenLabList.body.orders[0]._id, orderId);

  const tokenRxList = await http(`/api/pharmacy/prescriptions?tokenId=${token._id}`, "doctor");
  assert.equal(tokenRxList.status, 200);
  assert.equal(tokenRxList.body.prescriptions.length, 1);
  assert.equal(tokenRxList.body.prescriptions[0]._id, prescriptionId);

  // 4. Denied target department: Ordering lab to clinical dept with no LAB_TECH rejects with 403
  const unassignedDeptRes = await http("/api/labs/orders", "doctor", {
    tokenId: token._id,
    serviceDepartmentId: clinicalDeptId,
    tests: [{ catalogId: testCatalogId }],
    creationKey: "other-key-" + crypto.randomUUID(),
  });
  assert.equal(unassignedDeptRes.status, 403);
});

test("version-bound critical lab acknowledgement task in consultation", async () => {
  const token = await createVisitToken({ status: "in_consultation", revision: 0 });
  const key = "crit-test-" + crypto.randomUUID();

  // Create order
  const orderRes = await http("/api/labs/orders", "doctor", {
    tokenId: token._id,
    serviceDepartmentId: labDeptId,
    tests: [{ catalogId: testCatalogId }],
    creationKey: key,
  }, "POST", key);
  assert.equal(orderRes.status, 201);
  const orderId = orderRes.body.order._id;

  const now = new Date();
  await LabOrder.updateOne(
    { _id: orderId },
    {
      $set: {
        orderStatus: "released",
        reportVersion: 1,
        workflowRevision: 1,
        results: [
          { testCode: "CBC", parameterCode: "WBC", parameterName: "White Blood Cells", value: 35.0, unit: "10^3/uL", flag: "critical_high", isCritical: true },
        ],
        criticalValueAlert: { isCritical: true },
        reportVersions: [
          {
            version: 1,
            authorId: labTechId,
            authorName: "Tech Lab",
            enteredAt: now,
            verifiedAt: now,
            verifiedById: otherDoctorId,
            verifiedByName: "Dr. Other",
            releasedAt: now,
            releasedById: labTechId,
            releasedByName: "Tech Lab",
            results: [
              { testCode: "CBC", parameterCode: "WBC", parameterName: "White Blood Cells", value: 35.0, unit: "10^3/uL", flag: "critical_high", isCritical: true },
            ],
            criticalTask: {
              assignedDoctorId: doctorId,
              createdAt: now,
            },
          },
        ],
      },
    }
  );

  // Doctor queries pending critical tasks
  const pendingCritical = await http(`/api/labs/orders?critical=pending`, "doctor");
  assert.equal(pendingCritical.status, 200);
  assert.ok(pendingCritical.body.orders.some((o) => o._id === orderId));

  const orderDoc = await LabOrder.findById(orderId);
  const currentRevision = orderDoc.workflowRevision;

  // Doctor acknowledges critical alert
  const ackRes = await http(`/api/labs/orders/${orderId}/acknowledge-critical`, "doctor", {
    expectedRevision: currentRevision,
    reportVersion: 1,
  }, "POST", "ack-" + crypto.randomUUID());
  assert.equal(ackRes.status, 200);

  // Verify critical task is now acknowledged
  const acknowledgedOrder = await LabOrder.findById(orderId);
  const criticalTask = acknowledgedOrder.reportVersions[0].criticalTask;
  assert.ok(criticalTask.acknowledgedAt);
  assert.equal(String(criticalTask.acknowledgedById), String(doctorId));

  // Query pending critical tasks again -> order is no longer in pending list
  const refreshedCritical = await http(`/api/labs/orders?critical=pending`, "doctor");
  assert.equal(refreshedCritical.status, 200);
  assert.ok(!refreshedCritical.body.orders.some((o) => o._id === orderId));
});
