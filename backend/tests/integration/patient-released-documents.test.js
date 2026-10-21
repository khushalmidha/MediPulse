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
import Prescription from "../../model/prescription.js";
import patientPortalRouter from "../../routes/patientPortal.js";
import encounterRouter from "../../routes/encounter.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_patient_documents_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id(), foreignHospitalId = id();
const clinicalDeptId = id(), labDeptId = id(), pharmacyDeptId = id();
const patientId = id(), foreignPatientId = id(), familyMemberId = id();
const doctorId = id(), foreignStaffId = id(), receptionStaffId = id();

const sessions = {};
let server, origin;

async function createStaffSession(staffId, role, hId = hospitalId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId: staffId, kind: "staff", csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ id: String(staffId), role: "staff", sid, type: "staff", hospitalId: String(hId) }, process.env.TOKEN_KEY);
}

async function createPatientSession(userId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId: userId, kind: "user", csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ id: String(userId), role: "user", sid, type: "user" }, process.env.TOKEN_KEY);
}

async function http(path, actor, body, method = body ? "POST" : "GET") {
  const response = await fetch(origin + path, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      ...(actor ? { Authorization: "Bearer " + sessions[actor] } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}

before(async () => {
  await mongoose.connect(uri.toString(), { directConnection: true });

  await Hospital.create([
    {
      _id: hospitalId,
      name: "City General Hospital",
      slug: "city-general-" + crypto.randomBytes(4).toString("hex"),
      registrationNumber: "REG-HOSP-1",
      type: "clinic",
      email: "city@example.invalid",
      status: "active",
      address: { city: "Metropolis", state: "State1" },
    },
    {
      _id: foreignHospitalId,
      name: "Foreign Clinic",
      slug: "foreign-clinic-" + crypto.randomBytes(4).toString("hex"),
      registrationNumber: "REG-HOSP-2",
      type: "clinic",
      email: "foreign@example.invalid",
      status: "active",
      address: { city: "Gotham", state: "State2" },
    },
  ]);

  await Department.create([
    { _id: clinicalDeptId, hospitalId, name: "General Medicine", code: "GM", status: "active", opd: { consultationFee: 100 } },
    { _id: labDeptId, hospitalId, name: "Clinical Pathology", code: "PATH", status: "active", opd: { consultationFee: 0 } },
    { _id: pharmacyDeptId, hospitalId, name: "Main Pharmacy", code: "PHARM", status: "active", opd: { consultationFee: 0 } },
  ]);

  await HospitalStaff.create([
    { _id: doctorId, hospitalId, name: "Dr. Consultant", email: "doc@city.test", role: "DOCTOR", departmentIds: [clinicalDeptId], isActive: true, inviteStatus: "accepted" },
    { _id: receptionStaffId, hospitalId, name: "Receptionist Alice", email: "alice@city.test", role: "RECEPTIONIST", departmentIds: [clinicalDeptId], isActive: true, inviteStatus: "accepted" },
    { _id: foreignStaffId, hospitalId: foreignHospitalId, name: "Dr. Foreign", email: "foreign@clinic.test", role: "DOCTOR", departmentIds: [], isActive: true, inviteStatus: "accepted" },
  ]);

  await User.create([
    {
      _id: patientId,
      firstName: "Alice",
      lastName: "Owner",
      email: "alice@patient.test",
      password: "synthetic-password",
      gender: "other",
      familyMembers: [
        { _id: familyMemberId, name: "Bob Family", relation: "Child", dob: new Date("2015-05-15") },
      ],
    },
    {
      _id: foreignPatientId,
      firstName: "Eve",
      lastName: "Foreign",
      email: "eve@patient.test",
      password: "synthetic-password",
      gender: "other",
    },
  ]);

  sessions.patient = await createPatientSession(patientId);
  sessions.foreignPatient = await createPatientSession(foreignPatientId);
  sessions.receptionist = await createStaffSession(receptionStaffId, "RECEPTIONIST", hospitalId);
  sessions.foreignStaff = await createStaffSession(foreignStaffId, "DOCTOR", foreignHospitalId);

  const app = express();
  app.use(express.json());
  app.use("/api/patients", patientPortalRouter);
  app.use("/api/encounters", encounterRouter);

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  await closeRedis();
});

test("public bearer scan returns privacy-safe ticket verification with zero patient PII", async () => {
  const encId = id();
  const qrCode = "PUBLICSCAN" + crypto.randomBytes(6).toString("hex").toUpperCase();

  await EncounterJourney.create({
    _id: encId,
    hospitalId,
    departmentId: clinicalDeptId,
    ticketNumber: "T-PUB-01",
    qrPayload: qrCode,
    isWalkIn: true,
    currentStage: "checked_in",
    currentDestination: { name: "Triage Station 2" },
    patientInfo: { name: "Sensitive Patient Name", phone: "9876543210" },
  });

  const res = await http(`/api/encounters/scan/${qrCode}`, null);
  assert.equal(res.status, 200);
  assert.equal(res.body.verified, true);
  assert.equal(res.body.ticketNumber, "T-PUB-01");
  assert.equal(res.body.stage, "checked_in");
  assert.equal(res.body.destination, "Triage Station 2");
  assert.equal(res.body.isWalkIn, true);

  // STRICT PRIVACY GUARANTEE: Zero patient PII exposed on public bearer scan
  assert.equal(res.body.patientInfo, undefined);
  assert.equal(res.body.name, undefined);
  assert.equal(res.body.phone, undefined);
  assert.equal(res.body.patientId, undefined);
  assert.equal(res.body.clinicalNotes, undefined);
  assert.equal(res.body.vitals, undefined);
});

test("authenticated staff scanner resolves full encounter journey and rejects foreign hospital staff", async () => {
  const encId = id();
  const qrCode = "STAFFSCAN" + crypto.randomBytes(6).toString("hex").toUpperCase();

  await EncounterJourney.create({
    _id: encId,
    hospitalId,
    departmentId: clinicalDeptId,
    ticketNumber: "T-STAFF-02",
    qrPayload: qrCode,
    isWalkIn: false,
    currentStage: "vitals",
    currentDestination: { name: "Consultation Room 3", building: "Main Wing", floor: "2nd Floor" },
    physicalFile: { hasPhysicalFile: true, locationName: "Records Archive" },
    patientId,
  });

  // 1. Authorized hospital staff scans ticket
  const res = await http(`/api/encounters/scan/${qrCode}`, "receptionist");
  assert.equal(res.status, 200);
  assert.equal(res.body.verified, true);
  assert.equal(res.body.ticketNumber, "T-STAFF-02");
  assert.equal(res.body.stage, "vitals");
  assert.equal(res.body.destination.name, "Consultation Room 3");
  assert.equal(res.body.physicalFile.hasPhysicalFile, true);
  assert.equal(res.body.physicalFile.locationName, "Records Archive");

  // 2. Foreign hospital staff attempts to scan ticket
  const foreignRes = await http(`/api/encounters/scan/${qrCode}`, "foreignStaff");
  assert.equal(foreignRes.status, 403);
  assert.match(foreignRes.body.message, /another hospital/i);
});

test("authenticated patient scanner resolves owned ticket and rejects foreign patient access", async () => {
  const encId = id();
  const qrCode = "PATIENTSCAN" + crypto.randomBytes(6).toString("hex").toUpperCase();

  await EncounterJourney.create({
    _id: encId,
    hospitalId,
    departmentId: clinicalDeptId,
    ticketNumber: "T-PAT-03",
    qrPayload: qrCode,
    isWalkIn: false,
    currentStage: "consultation",
    patientId,
  });

  // 1. Owner patient scans ticket
  const res = await http(`/api/encounters/scan/${qrCode}`, "patient");
  assert.equal(res.status, 200);
  assert.equal(res.body.verified, true);
  assert.equal(res.body.ticketNumber, "T-PAT-03");

  // 2. Foreign patient attempts to scan ticket
  const foreignRes = await http(`/api/encounters/scan/${qrCode}`, "foreignPatient");
  assert.equal(foreignRes.status, 403);
  assert.match(foreignRes.body.message, /another patient/i);
});

test("patient visit packet returns released lab reports, approved prescriptions, and approved SOAP summary", async () => {
  const tokenId = id();
  const encounterId = id();

  await OpdToken.create({
    _id: tokenId,
    hospitalId,
    departmentId: clinicalDeptId,
    doctorId,
    patientId,
    tokenNumber: 101,
    status: "completed",
    displayToken: "T101",
    date: new Date(),
    patientInfo: { name: "Alice Owner", age: 30, gender: "female" },
    consultationNotes: "Patient treated for seasonal viral infection.",
    vitals: { bp: "120/80", pulse: 72, temperature: 98.6 },
    soapNote: {
      subjective: "Persistent cough for 3 days",
      objective: "Chest clear, temp normal",
      assessment: "Acute Bronchitis",
      plan: "Amoxicillin and cough syrup",
      version: 1,
      approvedAt: new Date("2026-10-21T10:00:00Z"),
      approvedByName: "Dr. Consultant",
    },
  });

  await EncounterJourney.create({
    _id: encounterId,
    hospitalId,
    departmentId: clinicalDeptId,
    tokenId,
    patientId,
    ticketNumber: "T101",
    qrPayload: "QRPACKET001",
    currentStage: "completed",
    currentDestination: { name: "Pharmacy Counter" },
    physicalFile: { hasPhysicalFile: false },
  });

  // Released Lab Order
  await LabOrder.create({
    _id: id(),
    hospitalId,
    departmentId: clinicalDeptId,
    serviceDepartmentId: labDeptId,
    tokenId,
    encounterJourneyId: encounterId,
    patientId,
    patientInfo: { name: "Alice Owner" },
    orderingDoctorId: doctorId,
    orderingDoctorName: "Dr. Consultant",
    orderStatus: "released",
    reportVersion: 1,
    releasedAt: new Date("2026-10-21T11:00:00Z"),
    verifiedByName: "Dr. Pathologist",
    tests: [{ testCode: "CBC", testName: "Complete Blood Count", category: "Hematology" }],
    reportVersions: [{
      version: 1,
      authorId: doctorId,
      releasedAt: new Date("2026-10-21T11:00:00Z"),
      verifiedByName: "Dr. Pathologist",
      results: [
        { testCode: "CBC", parameterCode: "WBC", parameterName: "White Blood Cells", value: 6.8, unit: "10^3/uL", referenceRangeText: "4.5 - 11.0", flag: "normal" },
        { testCode: "CBC", parameterCode: "PLT", parameterName: "Platelets", value: 45, unit: "10^3/uL", referenceRangeText: "150 - 450", isCritical: true, flag: "low" },
      ],
    }],
  });

  // Approved Prescription
  await Prescription.create({
    _id: id(),
    hospitalId,
    departmentId: clinicalDeptId,
    serviceDepartmentId: pharmacyDeptId,
    tokenId,
    encounterJourneyId: encounterId,
    patientId,
    patientInfo: { name: "Alice Owner" },
    prescribingDoctorId: doctorId,
    prescribingDoctorName: "Dr. Consultant",
    status: "dispensed",
    items: [
      { medicationCode: "AMX500", medicationName: "Amoxicillin 500mg", directions: "1 tablet three times daily", durationDays: 5, quantityPrescribed: 15, quantityDispensed: 15, itemStatus: "dispensed" },
    ],
  });

  const res = await http(`/api/patients/me/visits/${tokenId}/packet`, "patient");
  assert.equal(res.status, 200);
  const packet = res.body.packet;
  assert.ok(packet);
  assert.equal(packet.displayToken, "T101");
  assert.equal(packet.status, "completed");
  assert.equal(packet.consultationNotes, "Patient treated for seasonal viral infection.");

  // Clinician-approved SOAP summary
  assert.ok(packet.soapSummary);
  assert.equal(packet.soapSummary.assessment, "Acute Bronchitis");
  assert.equal(packet.soapSummary.approvedByName, "Dr. Consultant");

  // Released Lab Reports
  assert.equal(packet.labReports.length, 1);
  assert.equal(packet.labReports[0].documentStatus, "released");
  assert.equal(packet.labReports[0].results.length, 2);
  assert.equal(packet.labReports[0].results[1].isCritical, true);

  // Prescriptions
  assert.equal(packet.prescriptions.length, 1);
  assert.equal(packet.prescriptions[0].documentStatus, "dispensed");
  assert.equal(packet.prescriptions[0].items[0].medicationName, "Amoxicillin 500mg");

  // Honest guidance & custody
  assert.equal(packet.destination, "Pharmacy Counter");
  assert.equal(packet.physicalFile, "Electronic record only");
});

test("draft lab reports and unapproved SOAP drafts never reach patient documents", async () => {
  const tokenId = id();
  const encounterId = id();

  await OpdToken.create({
    _id: tokenId,
    hospitalId,
    departmentId: clinicalDeptId,
    doctorId,
    patientId,
    tokenNumber: 102,
    status: "in_consultation",
    displayToken: "T102",
    date: new Date(),
    patientInfo: { name: "Alice Owner" },
    // DRAFT SOAP note without approvedAt
    soapNote: {
      subjective: "Preliminary rough notes that have not been approved",
      objective: "Vague signs",
      version: 1,
      approvedAt: null,
    },
  });

  await EncounterJourney.create({
    _id: encounterId,
    hospitalId,
    departmentId: clinicalDeptId,
    tokenId,
    patientId,
    ticketNumber: "T102",
    currentStage: "consultation",
  });

  // DRAFT Lab Order with unreleased version
  await LabOrder.create({
    _id: id(),
    hospitalId,
    departmentId: clinicalDeptId,
    serviceDepartmentId: labDeptId,
    tokenId,
    encounterJourneyId: encounterId,
    patientId,
    patientInfo: { name: "Alice Owner" },
    orderingDoctorId: doctorId,
    orderStatus: "collected",
    tests: [{ testCode: "LIPID", testName: "Lipid Profile" }],
    auditHistory: [{ stage: "sample_collected", notes: "Sample collected by Internal Staff ID 123", actorName: "NURSE" }],
    reportVersions: [{
      version: 1,
      authorId: doctorId,
      results: [{ testCode: "LIPID", parameterCode: "CHOL", parameterName: "Cholesterol", value: 240 }],
      releasedAt: null, // Unreleased draft!
    }],
  });

  // Non-approved Prescription (cancelled)
  await Prescription.create({
    _id: id(),
    hospitalId,
    departmentId: clinicalDeptId,
    serviceDepartmentId: pharmacyDeptId,
    tokenId,
    encounterJourneyId: encounterId,
    patientId,
    patientInfo: { name: "Alice Owner" },
    prescribingDoctorId: doctorId,
    status: "cancelled",
    items: [{ medicationCode: "EXP01", medicationName: "Experimental Med", directions: "Daily", quantityPrescribed: 10 }],
  });

  const res = await http(`/api/patients/me/visits/${tokenId}/packet`, "patient");
  assert.equal(res.status, 200);
  const packet = res.body.packet;

  // Unapproved SOAP draft MUST be null in patient packet
  assert.equal(packet.soapSummary, null);

  // Unreleased lab draft MUST NOT appear in patient released reports
  assert.equal(packet.labReports.length, 0);

  // Draft prescription MUST NOT appear in patient prescriptions
  assert.equal(packet.prescriptions.length, 0);

  // Internal staff audit string MUST NOT be leaked anywhere in response
  const serialized = JSON.stringify(res.body);
  assert.ok(!serialized.includes("Internal Staff ID 123"));
});

test("released lab amendments preserve earlier versions in amendmentHistory with amended status", async () => {
  const tokenId = id();
  const encounterId = id();

  await OpdToken.create({
    _id: tokenId,
    hospitalId,
    departmentId: clinicalDeptId,
    doctorId,
    patientId,
    tokenNumber: 103,
    status: "completed",
    displayToken: "T103",
    date: new Date(),
    patientInfo: { name: "Alice Owner" },
  });

  await EncounterJourney.create({
    _id: encounterId,
    hospitalId,
    departmentId: clinicalDeptId,
    tokenId,
    patientId,
    ticketNumber: "T103",
    currentStage: "completed",
  });

  // Lab Order with 2 released versions: version 1 (earlier) and version 2 (latest amendment)
  await LabOrder.create({
    _id: id(),
    hospitalId,
    departmentId: clinicalDeptId,
    serviceDepartmentId: labDeptId,
    tokenId,
    encounterJourneyId: encounterId,
    patientId,
    patientInfo: { name: "Alice Owner" },
    orderingDoctorId: doctorId,
    orderStatus: "released",
    reportVersion: 2,
    releasedAt: new Date("2026-10-21T14:00:00Z"),
    verifiedByName: "Dr. Pathologist Senior",
    tests: [{ testCode: "GLU", testName: "Fasting Blood Glucose" }],
    reportVersions: [
      {
        version: 1,
        authorId: doctorId,
        releasedAt: new Date("2026-10-21T09:00:00Z"),
        verifiedByName: "Dr. Pathologist Junior",
        correctionReason: "Recalibration required for glucose assay",
        results: [{ testCode: "GLU", parameterCode: "GLU_F", parameterName: "Fasting Glucose", value: 95, unit: "mg/dL" }],
      },
      {
        version: 2,
        authorId: doctorId,
        releasedAt: new Date("2026-10-21T14:00:00Z"),
        verifiedByName: "Dr. Pathologist Senior",
        results: [{ testCode: "GLU", parameterCode: "GLU_F", parameterName: "Fasting Glucose", value: 110, unit: "mg/dL" }],
      },
    ],
  });

  const res = await http(`/api/patients/me/visits/${tokenId}/packet`, "patient");
  assert.equal(res.status, 200);
  const lab = res.body.packet.labReports[0];
  assert.ok(lab);

  // Latest released version
  assert.equal(lab.documentStatus, "amended");
  assert.equal(lab.reportVersion, 2);
  assert.equal(lab.results[0].value, 110);

  // Earlier released version preserved in amendmentHistory
  assert.ok(lab.amendmentHistory);
  assert.equal(lab.amendmentHistory.length, 1);
  assert.equal(lab.amendmentHistory[0].version, 1);
  assert.equal(lab.amendmentHistory[0].status, "amended");
  assert.equal(lab.amendmentHistory[0].reason, "Recalibration required for glucose assay");
  assert.equal(lab.amendmentHistory[0].results[0].value, 95);
});

test("foreign patient access to visit packet is denied", async () => {
  const tokenId = id();
  await OpdToken.create({
    _id: tokenId,
    hospitalId,
    departmentId: clinicalDeptId,
    doctorId,
    patientId,
    tokenNumber: 104,
    date: new Date(),
    status: "completed",
    displayToken: "T104",
    patientInfo: { name: "Alice Owner" },
  });

  const res = await http(`/api/patients/me/visits/${tokenId}/packet`, "foreignPatient");
  assert.equal(res.status, 404);
  assert.match(res.body.message, /not found/i);
});

test("authorized family member can access visit packet", async () => {
  const tokenId = id();
  await OpdToken.create({
    _id: tokenId,
    hospitalId,
    departmentId: clinicalDeptId,
    doctorId,
    patientId,
    familyMemberId,
    tokenNumber: 105,
    date: new Date(),
    status: "completed",
    displayToken: "T105",
    patientInfo: { name: "Bob Family", age: 11 },
    consultationNotes: "Child routine vaccination check.",
  });

  const res = await http(`/api/patients/me/visits/${tokenId}/packet`, "patient");
  assert.equal(res.status, 200);
  assert.equal(res.body.packet.displayToken, "T105");
  assert.equal(res.body.packet.familyMemberId, String(familyMemberId));
  assert.equal(res.body.packet.consultationNotes, "Child routine vaccination check.");
});
