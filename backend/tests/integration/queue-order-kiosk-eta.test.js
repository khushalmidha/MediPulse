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
import Doctor from "../../model/doctor.js";
import AuthSession from "../../model/authSession.js";
import OpdToken from "../../model/opdToken.js";
import EncounterJourney from "../../model/encounterJourney.js";
import QueueRevision from "../../model/queueRevision.js";
import opdRouter from "../../routes/opd.js";
import hospitalRouter from "../../routes/hospital.js";
import { calculateQueueETA, getHospitalKioskStatus } from "../../services/queueTrackingService.js";
import { localServiceDate } from "../../services/queueContext.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_queue_kiosk_eta_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id(), foreignHospitalId = id();
const clinicalDeptId = id();
const doctor1StaffId = id(), doctor2StaffId = id(), nurseStaffId = id(), pharmacistStaffId = id(), foreignStaffId = id();
const independentDoctorId = id(), foreignIndependentDoctorId = id();
const patient1Id = id(), patient2Id = id();
const practiceScopeId = id();

const today = localServiceDate(new Date(), "Asia/Kolkata");
const queueKeyDoc1 = `hospital:${hospitalId}:${doctor1StaffId}:${today}:day`;
const queueKeyDoc2 = `hospital:${hospitalId}:${doctor2StaffId}:${today}:day`;
const queueKeyIndependent = `independent:${practiceScopeId}:${independentDoctorId}:${today}:day`;
const queueKeyForeignIndependent = `independent:${practiceScopeId}:${foreignIndependentDoctorId}:${today}:day`;

const sessions = {};
let server, origin;

async function createStaffSession(staffId, role, hId = hospitalId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId: staffId, kind: "staff", csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ id: String(staffId), role: "staff", sid, type: "staff", hospitalId: String(hId) }, process.env.TOKEN_KEY);
}

async function createDoctorAccountSession(doctorId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId: doctorId, kind: "doctor", csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ id: String(doctorId), role: "doctor", sid, type: "doctor" }, process.env.TOKEN_KEY);
}

async function createPatientSession(userId) {
  const sid = crypto.randomUUID();
  await AuthSession.create({ _id: sid, principalId: userId, kind: "user", csrfToken: "isolated-csrf", expiresAt: new Date(Date.now() + 600000) });
  return jwt.sign({ id: String(userId), role: "user", sid, type: "user" }, process.env.TOKEN_KEY);
}

async function http(path, actor, body, method = body ? (path.includes("/start-consultation") ? "PATCH" : "POST") : "GET", extraHeaders = {}) {
  const response = await fetch(origin + path, {
    method,
    signal: AbortSignal.timeout(10000),
    headers: {
      "Content-Type": "application/json",
      ...(actor ? { Authorization: "Bearer " + sessions[actor] } : {}),
      ...extraHeaders,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, headers: response.headers, body: await response.json() };
}

before(async () => {
  await mongoose.connect(uri.toString(), { directConnection: true });

  await Hospital.create([
    {
      _id: hospitalId,
      name: "City Care Hospital",
      slug: "city-care-" + crypto.randomBytes(4).toString("hex"),
      registrationNumber: "REG-HOSP-01",
      type: "clinic",
      email: "citycare@medipulse.test",
      status: "active",
      timezone: "Asia/Kolkata",
      address: { city: "Delhi", state: "DL" },
    },
    {
      _id: foreignHospitalId,
      name: "Metro General",
      slug: "metro-general-" + crypto.randomBytes(4).toString("hex"),
      registrationNumber: "REG-HOSP-02",
      type: "clinic",
      email: "metro@medipulse.test",
      status: "active",
      timezone: "Asia/Kolkata",
      address: { city: "Mumbai", state: "MH" },
    },
  ]);

  await Department.create([
    { _id: clinicalDeptId, hospitalId, name: "Cardiology", code: "CARD", isActive: true, status: "active", opd: { consultationFee: 100 } },
  ]);

  await HospitalStaff.create([
    { _id: doctor1StaffId, hospitalId, name: "Dr. Arvind Rao", email: "arvind@citycare.test", role: "DOCTOR", isActive: true, inviteStatus: "accepted", departmentIds: [clinicalDeptId], doctorProfile: { specialization: "Cardiology" } },
    { _id: doctor2StaffId, hospitalId, name: "Dr. Maya Sen", email: "maya@citycare.test", role: "DOCTOR", isActive: true, inviteStatus: "accepted", departmentIds: [clinicalDeptId], doctorProfile: { specialization: "Cardiology" } },
    { _id: nurseStaffId, hospitalId, name: "Nurse Brenda", email: "brenda@citycare.test", role: "NURSE", isActive: true, inviteStatus: "accepted", departmentIds: [clinicalDeptId] },
    { _id: pharmacistStaffId, hospitalId, name: "Pharma Phil", email: "phil@citycare.test", role: "PHARMACIST", isActive: true, inviteStatus: "accepted", departmentIds: [] },
    { _id: foreignStaffId, hospitalId: foreignHospitalId, name: "Dr. Foreigner", email: "foreigner@metro.test", role: "DOCTOR", isActive: true, inviteStatus: "accepted", departmentIds: [] },
  ]);

  await Doctor.create([
    {
      _id: independentDoctorId,
      firstName: "Jane",
      lastName: "Doe",
      email: `jane.doe.${crypto.randomBytes(4).toString("hex")}@medipulse.test`,
      password: "hashedpassword123",
      gender: "female",
      queueTimezone: "Asia/Kolkata",
      queueSessionIds: ["day"],
      experience: { years: 10, expertise: "General Medicine" },
    },
    {
      _id: foreignIndependentDoctorId,
      firstName: "Robert",
      lastName: "Frost",
      email: `robert.frost.${crypto.randomBytes(4).toString("hex")}@medipulse.test`,
      password: "hashedpassword123",
      gender: "male",
      queueTimezone: "Asia/Kolkata",
      queueSessionIds: ["day"],
      experience: { years: 10, expertise: "General Medicine" },
    },
  ]);

  await User.create([
    { _id: patient1Id, firstName: "Alice", lastName: "Verma", email: `alice.${crypto.randomBytes(4).toString("hex")}@example.com`, password: "password123", gender: "female", role: "patient" },
    { _id: patient2Id, firstName: "Bob", lastName: "Sharma", email: `bob.${crypto.randomBytes(4).toString("hex")}@example.com`, password: "password123", gender: "male", role: "patient" },
  ]);

  sessions.doctor1 = await createStaffSession(doctor1StaffId, "DOCTOR", hospitalId);
  sessions.doctor2 = await createStaffSession(doctor2StaffId, "DOCTOR", hospitalId);
  sessions.nurse = await createStaffSession(nurseStaffId, "NURSE", hospitalId);
  sessions.pharmacist = await createStaffSession(pharmacistStaffId, "PHARMACIST", hospitalId);
  sessions.foreignStaff = await createStaffSession(foreignStaffId, "DOCTOR", foreignHospitalId);
  sessions.independentDoctor = await createDoctorAccountSession(independentDoctorId);
  sessions.foreignIndependentDoctor = await createDoctorAccountSession(foreignIndependentDoctorId);
  sessions.patient = await createPatientSession(patient1Id);

  const app = express();
  app.use(express.json());
  app.use("/api/opd", opdRouter);
  app.use("/api/hospitals", hospitalRouter);

  server = app.listen(0);
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  server?.close();
  await mongoose.disconnect();
  await closeRedis();
});

test("AG09: Queue order, priority override, public kiosk and ETA semantics", async (t) => {
  let tokenDoc1A, tokenDoc1B, tokenDoc2A;

  await t.test("setup: seed test tokens across doctors and sessions", async () => {
    // Doctor 1 has Token 1 and Token 2
    tokenDoc1A = await OpdToken.create({
      _id: id(),
      hospitalId,
      departmentId: clinicalDeptId,
      doctorId: doctor1StaffId,
      patientId: patient1Id,
      serviceDate: today,
      sessionId: "day",
      queueKey: queueKeyDoc1,
      personKey: `${patient1Id}:self`,
      tokenNumber: 1,
      displayToken: "T001",
      date: new Date(),
      arrivedAt: new Date(),
      status: "waiting",
      priority: 0,
      revision: 0,
      patientInfo: { name: "Alice Verma", phone: "9876543210" },
    });

    tokenDoc1B = await OpdToken.create({
      _id: id(),
      hospitalId,
      departmentId: clinicalDeptId,
      doctorId: doctor1StaffId,
      patientId: patient2Id,
      serviceDate: today,
      sessionId: "day",
      queueKey: queueKeyDoc1,
      personKey: `${patient2Id}:self`,
      tokenNumber: 2,
      displayToken: "T002",
      date: new Date(),
      arrivedAt: new Date(),
      status: "waiting",
      priority: 0,
      revision: 0,
      patientInfo: { name: "Bob Sharma", phone: "9876543211" },
    });

    // Doctor 2 has Token 1 (same token number T001, but different doctor)
    tokenDoc2A = await OpdToken.create({
      _id: id(),
      hospitalId,
      departmentId: clinicalDeptId,
      doctorId: doctor2StaffId,
      patientId: patient2Id,
      serviceDate: today,
      sessionId: "day",
      queueKey: queueKeyDoc2,
      personKey: `${patient2Id}:self`,
      tokenNumber: 1,
      displayToken: "T001",
      date: new Date(),
      status: "waiting",
      priority: 0,
      revision: 0,
      patientInfo: { name: "Bob Sharma", phone: "9876543211" },
    });

    // Initialize journey for tokenDoc1B
    await EncounterJourney.create({
      _id: id(),
      tokenId: tokenDoc1B._id,
      patientId: patient2Id,
      hospitalId,
      departmentId: clinicalDeptId,
      ticketNumber: "T002",
      currentStage: "checked_in",
      stageHistory: [{ stage: "reception", timestamp: new Date() }],
      revision: 0,
    });

    assert.ok(tokenDoc1A);
    assert.ok(tokenDoc1B);
    assert.ok(tokenDoc2A);
  });

  await t.test("priority override requires valid clinical role, reason (max 300), and rejects foreign staff", async () => {
    // 1. Missing / empty reason
    const emptyReason = await http(`/api/opd/tokens/${tokenDoc1B._id}/priority-override`, "nurse", { reason: "   " });
    assert.equal(emptyReason.status, 400);
    assert.equal(emptyReason.body.message, "Reason for priority override is required");

    // 2. Reason exceeds 300 chars
    const longReason = await http(`/api/opd/tokens/${tokenDoc1B._id}/priority-override`, "nurse", { reason: "A".repeat(301) });
    assert.equal(longReason.status, 400);
    assert.match(longReason.body.message, /300 characters/i);

    // 3. Foreign hospital staff
    const foreignRes = await http(`/api/opd/tokens/${tokenDoc1B._id}/priority-override`, "foreignStaff", { reason: "Emergency triage override" });
    assert.equal(foreignRes.status, 403);
    assert.match(foreignRes.body.message, /cannot override priority in another hospital/i);

    // 4. Unauthorized non-clinical role (e.g. PHARMACIST)
    const unauthorizedRes = await http(`/api/opd/tokens/${tokenDoc1B._id}/priority-override`, "pharmacist", { reason: "Urgent case" });
    assert.equal(unauthorizedRes.status, 403);
    assert.match(unauthorizedRes.body.message, /Only authorized clinical staff/i);

    // 5. Authorized clinical role (NURSE) succeeds
    const successRes = await http(`/api/opd/tokens/${tokenDoc1B._id}/priority-override`, "nurse", {
      reason: "Patient in acute respiratory distress",
      priority: 1,
    });
    assert.equal(successRes.status, 200);
    assert.equal(successRes.body.overrideRecorded, true);
    assert.equal(successRes.body.priority, 1);
    assert.equal(successRes.body.replayed, false);

    // Verify token updated in database
    const updatedToken = await OpdToken.findById(tokenDoc1B._id);
    assert.equal(updatedToken.priority, 1);
    assert.equal(updatedToken.priorityReason, "Patient in acute respiratory distress");
    assert.equal(String(updatedToken.priorityOverriddenBy), String(nurseStaffId));

    // Verify EncounterJourney audit trail
    const updatedJourney = await EncounterJourney.findOne({ tokenId: tokenDoc1B._id });
    const lastStage = updatedJourney.stageHistory[updatedJourney.stageHistory.length - 1];
    assert.equal(lastStage.isOverride, true);
    assert.equal(lastStage.reason, "Patient in acute respiratory distress");
    assert.match(lastStage.notes, /priority set to 1/i);
  });

  await t.test("priority override with idempotency key returns exact replayed result safely", async () => {
    const idempotencyKey = `p-override-${crypto.randomUUID()}`;

    // First call with key
    const firstCall = await http(
      `/api/opd/tokens/${tokenDoc1B._id}/priority-override`,
      "doctor1",
      { reason: "Re-evaluated urgent condition", priority: 2, key: idempotencyKey }
    );
    assert.equal(firstCall.status, 200);
    assert.equal(firstCall.body.replayed, false);
    assert.equal(firstCall.body.priority, 2);

    const tokenAfterFirst = await OpdToken.findById(tokenDoc1B._id);
    const revisionAfterFirst = tokenAfterFirst.revision;

    // Second call with identical key (simulating network retry)
    const replayCall = await http(
      `/api/opd/tokens/${tokenDoc1B._id}/priority-override`,
      "doctor1",
      { reason: "Re-evaluated urgent condition", priority: 2, key: idempotencyKey }
    );
    assert.equal(replayCall.status, 200);
    assert.equal(replayCall.body.replayed, true);
    assert.equal(replayCall.body.priority, 2);

    const tokenAfterReplay = await OpdToken.findById(tokenDoc1B._id);
    // Revision should not have changed on replay
    assert.equal(tokenAfterReplay.revision, revisionAfterFirst);
  });

  await t.test("deterministic queue order: urgent priority token preempts lower priority tokens and starts first", async () => {
    // Current queue state for Doctor 1:
    // tokenDoc1A: tokenNumber 1, priority 0
    // tokenDoc1B: tokenNumber 2, priority 2 (URGENT)
    // Head of queue must be tokenDoc1B due to sort({ priority: -1, tokenNumber: 1 })

    // Doctor 1 attempts to start tokenDoc1A (which has lower priority than urgent tokenDoc1B)
    const startAAttempt = await http(
      `/api/opd/tokens/${tokenDoc1A._id}/start-consultation`,
      "doctor1",
      { revision: 0 }
    );
    assert.equal(startAAttempt.status, 409);
    assert.match(startAAttempt.body.message, /start visits in this session's queue order/i);

    // Starting urgent tokenDoc1B succeeds
    const startBRes = await http(
      `/api/opd/tokens/${tokenDoc1B._id}/start-consultation`,
      "doctor1",
      { revision: (await OpdToken.findById(tokenDoc1B._id)).revision }
    );
    assert.equal(startBRes.status, 200);
    assert.equal(startBRes.body.token.status, "in_consultation");

    // Complete consultation for tokenDoc1B to free queue head
    await OpdToken.updateOne({ _id: tokenDoc1B._id }, { $set: { status: "completed" } });

    // Now tokenDoc1A is head and can be started
    const startARes = await http(
      `/api/opd/tokens/${tokenDoc1A._id}/start-consultation`,
      "doctor1",
      { revision: (await OpdToken.findById(tokenDoc1A._id)).revision }
    );
    assert.equal(startARes.status, 200);
    assert.equal(startARes.body.token.status, "in_consultation");

    // Reset tokenDoc1A back to waiting for remaining ETA tests
    await OpdToken.updateOne({ _id: tokenDoc1A._id }, { $set: { status: "waiting" } });
  });

  await t.test("truthful ETA semantics for terminal, in_consultation, reserved, and priority tokens", async () => {
    // 1. Truthful terminal ETA (completed token)
    const completedToken = await OpdToken.create({
      _id: id(),
      hospitalId,
      departmentId: clinicalDeptId,
      doctorId: doctor1StaffId,
      patientId: patient1Id,
      serviceDate: today,
      sessionId: "day",
      queueKey: queueKeyDoc1,
      personKey: `${patient1Id}:self`,
      tokenNumber: 99,
      displayToken: "T099",
      date: new Date(),
      status: "completed",
    });

    const terminalETA = await calculateQueueETA({
      queueKey: queueKeyDoc1,
      targetTokenNumber: 99,
      status: "completed",
      token: completedToken,
    });
    assert.equal(terminalETA.isTerminal, true);
    assert.equal(terminalETA.patientsAhead, 0);
    assert.equal(terminalETA.etaRange.minMinutes, null);
    assert.equal(terminalETA.etaRange.maxMinutes, null);
    assert.equal(terminalETA.doctorStatus, "completed");

    // 2. Truthful active-target ETA (in_consultation token)
    const inConsultToken = await OpdToken.create({
      _id: id(),
      hospitalId,
      departmentId: clinicalDeptId,
      doctorId: doctor1StaffId,
      patientId: patient1Id,
      serviceDate: today,
      sessionId: "day",
      queueKey: queueKeyDoc1,
      personKey: `${patient1Id}:self`,
      tokenNumber: 98,
      displayToken: "T098",
      date: new Date(),
      status: "in_consultation",
    });

    const activeETA = await calculateQueueETA({
      queueKey: queueKeyDoc1,
      targetTokenNumber: 98,
      status: "in_consultation",
      token: inConsultToken,
    });
    assert.equal(activeETA.isActive, true);
    assert.equal(activeETA.patientsAhead, 0);
    assert.equal(activeETA.etaRange.minMinutes, 0);
    assert.equal(activeETA.etaRange.maxMinutes, 0);

    // 3. Truthful reserved token ETA
    const reservedToken = await OpdToken.create({
      _id: id(),
      hospitalId,
      departmentId: clinicalDeptId,
      doctorId: doctor1StaffId,
      patientId: patient1Id,
      serviceDate: today,
      sessionId: "day",
      queueKey: queueKeyDoc1,
      personKey: `${patient1Id}:self`,
      tokenNumber: 97,
      displayToken: "T097",
      date: new Date(),
      status: "reserved",
      admissionState: "reserved",
    });

    const reservedETA = await calculateQueueETA({
      queueKey: queueKeyDoc1,
      targetTokenNumber: 97,
      status: "reserved",
      token: reservedToken,
    });
    assert.equal(reservedETA.isReserved, true);
    assert.equal(reservedETA.patientsAhead, null);
    assert.match(reservedETA.etaRange.label, /Arrival check-in required/i);
  });

  await t.test("public kiosk groups by doctor/session and keeps identical tokens distinct", async () => {
    // Both Doctor 1 and Doctor 2 have active tokens
    const res = await http(`/api/hospitals/${hospitalId}/kiosk-display`, null);
    assert.equal(res.status, 200);
    assert.equal(res.headers.get("cache-control"), "no-cache, no-store, must-revalidate");

    const kiosk = res.body.kiosk;
    assert.ok(kiosk.queues);
    assert.equal(kiosk.serviceDate, today);
    assert.equal(kiosk.timezone, "Asia/Kolkata");

    // Must have separate queue groups for Doctor 1 and Doctor 2
    const doc1Queue = kiosk.queues.find((q) => q.doctorId === String(doctor1StaffId));
    const doc2Queue = kiosk.queues.find((q) => q.doctorId === String(doctor2StaffId));

    assert.ok(doc1Queue, "Doctor 1 queue should be present");
    assert.ok(doc2Queue, "Doctor 2 queue should be present");
    assert.notEqual(doc1Queue.queueKey, doc2Queue.queueKey);
    assert.equal(doc1Queue.doctorName, "Dr. Arvind Rao");
    assert.equal(doc2Queue.doctorName, "Dr. Maya Sen");
    assert.equal(doc1Queue.specialization, "Cardiology");
    assert.equal(doc2Queue.specialization, "Cardiology");

    // Both doctors have T001, but they are completely distinct and not collated into one
    assert.ok(doc1Queue.nowServing || doc1Queue.nextInLine.length > 0);
    assert.ok(doc2Queue.nowServing || doc2Queue.nextInLine.length > 0);
  });

  await t.test("public kiosk strictly protects privacy with zero patient PII exposed", async () => {
    const res = await http(`/api/hospitals/${hospitalId}/kiosk-display`, null);
    const kiosk = res.body.kiosk;

    for (const q of kiosk.queues) {
      assert.equal(q.patientName, undefined);
      assert.equal(q.patientPhone, undefined);
      assert.equal(q.patientInfo, undefined);
      assert.equal(q.patientId, undefined);

      for (const next of q.nextInLine) {
        assert.equal(next.patientName, undefined);
        assert.equal(next.phone, undefined);
        assert.equal(next.name, undefined);
        assert.ok(next.displayToken);
      }
    }
  });

  await t.test("independent practice queue pause controls with doctor account authorization", async () => {
    // 1. Patient account attempting to pause independent queue is rejected (403)
    const patientPause = await http("/api/opd/queue/pause", "patient", {
      queueKey: queueKeyIndependent,
      revision: 0,
      reason: "Patient break",
    });
    assert.equal(patientPause.status, 403);
    assert.match(patientPause.body.message, /Only the assigned doctor/i);

    // 2. Foreign independent doctor attempting to pause is rejected (403)
    const foreignDocPause = await http("/api/opd/queue/pause", "foreignIndependentDoctor", {
      queueKey: queueKeyIndependent,
      revision: 0,
      reason: "Doctor step out",
    });
    assert.equal(foreignDocPause.status, 403);
    assert.match(foreignDocPause.body.message, /Only the assigned doctor/i);

    // 3. Stale revision returns 409
    const stalePause = await http("/api/opd/queue/pause", "independentDoctor", {
      queueKey: queueKeyIndependent,
      revision: 99,
      reason: "Doctor step out",
    });
    assert.equal(stalePause.status, 409);

    // 4. Assigned independent doctor successfully pauses queue
    const pauseRes = await http("/api/opd/queue/pause", "independentDoctor", {
      queueKey: queueKeyIndependent,
      revision: 0,
      reason: "Emergency telephone consult",
    });
    assert.equal(pauseRes.status, 200);
    assert.equal(pauseRes.body.pause.pause.isPaused, true);
    assert.equal(pauseRes.body.pause.pause.reason, "Emergency telephone consult");
    assert.equal(pauseRes.body.pause.queueRevision, 1);

    // Verify persisted queue revision
    const persistedRev = await QueueRevision.findById(queueKeyIndependent);
    assert.equal(persistedRev.pause.isPaused, true);
    assert.equal(persistedRev.revision, 1);

    // 5. Assigned independent doctor successfully resumes queue
    const resumeRes = await http("/api/opd/queue/resume", "independentDoctor", {
      queueKey: queueKeyIndependent,
      revision: 1,
    });
    assert.equal(resumeRes.status, 200);
    assert.equal(resumeRes.body.result.pause.isPaused, false);
    assert.equal(resumeRes.body.result.queueRevision, 2);

    const resumedRev = await QueueRevision.findById(queueKeyIndependent);
    assert.equal(resumedRev.pause.isPaused, false);
    assert.equal(resumedRev.revision, 2);
  });
});
