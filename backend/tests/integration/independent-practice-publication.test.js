import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import Doctor from "../../model/doctor.js";
import User from "../../model/user.js";
import Hospital from "../../model/hospital.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import Department from "../../model/department.js";
import Appointment from "../../model/appointment.js";
import OpdToken from "../../model/opdToken.js";
import Wallet from "../../model/wallet.js";
import AuthSession from "../../model/authSession.js";
import { CareSession, CareSlot, CareReservation, ScheduleOperation } from "../../model/scheduling.js";
import doctorRouter from "../../routes/doctor.js";
import saasRouter from "../../routes/saasOperations.js";
import schedulingRouter from "../../routes/scheduling.js";
import appointmentRouter from "../../routes/appointment.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_practice_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
let server, origin;

const platformAdminId = id();
const patientId = id();
const unverifiedDoctorId = id();
const verifiedDoctorId = id();
const dualDoctorId = id();
const hospitalId = id();
const departmentId = id();
const staffDoctorId = id();

let platformOperatorToken = null;
let patientToken = null;
let unverifiedDoctorToken = null;
let verifiedDoctorToken = null;
let dualDoctorToken = null;
let staffToken = null;

async function makeSessionToken(principalId, kind, hospitalIdParam = null) {
  const sid = crypto.randomUUID();
  await AuthSession.create({
    _id: sid,
    principalId,
    kind,
    csrfToken: "isolated-csrf",
    expiresAt: new Date(Date.now() + 600000),
  });
  return jwt.sign(
    {
      sid,
      id: String(principalId),
      role: kind === "staff" ? "DOCTOR" : kind,
      ...(kind === "staff" ? { type: "staff", hospitalId: String(hospitalIdParam) } : {}),
    },
    process.env.TOKEN_KEY,
    { expiresIn: "1h" }
  );
}

before(async () => {
  process.env.TOKEN_KEY = "test-secret-key-32-chars-long-practice-test!";
  process.env.USE_REAL_REDIS = "false";
  process.env.PLATFORM_ADMIN_IDS = String(platformAdminId);

  await mongoose.connect(uri.href, {
    autoIndex: false,
    autoCreate: false,
    serverSelectionTimeoutMS: 5000,
    directConnection: true,
  });

  await Promise.all([
    Doctor.createIndexes(),
    User.createIndexes(),
    Hospital.createIndexes(),
    HospitalStaff.createIndexes(),
    Department.createIndexes(),
    Appointment.createIndexes(),
    OpdToken.createIndexes(),
    Wallet.createIndexes(),
    AuthSession.createIndexes(),
    CareSession.createIndexes(),
    CareSlot.createIndexes(),
    CareReservation.createIndexes(),
    ScheduleOperation.createIndexes(),
  ]);

  // Seed platform operator
  await User.create({
    _id: platformAdminId,
    firstName: "Platform",
    lastName: "Operator",
    email: "operator@example.invalid",
    password: "fixture-password-123",
    gender: "other",
  });

  // Seed patient with wallet balance
  await User.create({
    _id: patientId,
    firstName: "Test",
    lastName: "Patient",
    email: "patient@example.invalid",
    password: "fixture-password-123",
    gender: "female",
  });
  await Wallet.create({
    userId: patientId,
    userRole: "user",
    balanceMinor: 500000,
    balance: 5000,
    initialCreditApplied: true,
  });

  // Seed unverified doctor
  await Doctor.create({
    _id: unverifiedDoctorId,
    firstName: "Unverified",
    lastName: "Physician",
    email: "unverified@example.invalid",
    password: "fixture-password-123",
    gender: "male",
    experience: { years: 3, expertise: "Internal Medicine" },
    credentialVerification: {
      status: "pending",
      councilRegistrationNumber: "MCI-11111",
      stateMedicalCouncil: "Delhi Medical Council",
    },
    isPublished: false,
    independentPractice: {
      enabled: true,
      consultationFee: 600,
    },
  });

  // Seed verified doctor
  await Doctor.create({
    _id: verifiedDoctorId,
    firstName: "Verified",
    lastName: "Cardiologist",
    email: "verified@example.invalid",
    password: "fixture-password-123",
    gender: "female",
    experience: { years: 10, expertise: "Cardiology" },
    credentialVerification: {
      status: "verified",
      councilRegistrationNumber: "MCI-22222",
      stateMedicalCouncil: "Maharashtra Medical Council",
      verifiedAt: new Date(),
      reviewNotes: "Initial test verified",
    },
    isPublished: true,
    independentPractice: {
      enabled: true,
      consultationFee: 750,
      slotDurationMinutes: 20,
    },
  });

  // Seed hospital and department
  await Hospital.create({
    _id: hospitalId,
    name: "Metropolitan Hospital",
    slug: "metro-hosp",
    registrationNumber: "REG-METRO-01",
    email: "admin@metro.invalid",
    type: "private",
    status: "active",
    address: { city: "Mumbai", state: "Maharashtra" },
  });

  await Department.create({
    _id: departmentId,
    hospitalId,
    name: "Cardiology",
    code: "CARDIO",
    status: "active",
    opd: { consultationFee: 500 },
  });

  // Seed dual-role doctor (employed at hospital + independent practice)
  await Doctor.create({
    _id: dualDoctorId,
    firstName: "Dual",
    lastName: "Practitioner",
    email: "dual@example.invalid",
    password: "fixture-password-123",
    gender: "male",
    experience: { years: 12, expertise: "Cardiology" },
    credentialVerification: {
      status: "verified",
      councilRegistrationNumber: "MCI-33333",
      stateMedicalCouncil: "Maharashtra Medical Council",
      verifiedAt: new Date(),
    },
    isPublished: true,
    independentPractice: {
      enabled: true,
      consultationFee: 1000,
      slotDurationMinutes: 30,
    },
  });

  await HospitalStaff.create({
    _id: staffDoctorId,
    hospitalId,
    doctorId: dualDoctorId,
    departmentIds: [departmentId],
    name: "Dual Practitioner",
    email: "dual.staff@metro.invalid",
    role: "DOCTOR",
    isActive: true,
    inviteStatus: "accepted",
    doctorProfile: {
      specialization: "Cardiology",
      experience: 12,
      consultationFee: 500,
    },
  });

  platformOperatorToken = await makeSessionToken(platformAdminId, "user");
  patientToken = await makeSessionToken(patientId, "user");
  unverifiedDoctorToken = await makeSessionToken(unverifiedDoctorId, "doctor");
  verifiedDoctorToken = await makeSessionToken(verifiedDoctorId, "doctor");
  dualDoctorToken = await makeSessionToken(dualDoctorId, "doctor");
  staffToken = await makeSessionToken(staffDoctorId, "staff", hospitalId);

  const app = express();
  app.use(express.json());
  app.use(cookieParser());

  app.use("/api/doctor", doctorRouter);
  app.use("/api/saas", saasRouter);
  app.use("/api/scheduling", schedulingRouter);
  app.use("/api/appointment", appointmentRouter);

  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    res.status(status).json({ message: err.message, code: err.code || "INTERNAL_ERROR" });
  });

  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) server.close();
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  await closeRedis();
});

test("AG12: Independent practice publication and booking eligibility", async (t) => {
  await t.test("1. Unverified doctor cannot publish independent practice (400 CREDENTIALS_NOT_VERIFIED)", async () => {
    const response = await fetch(`${origin}/api/doctor/practice-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${unverifiedDoctorToken}`,
      },
      body: JSON.stringify({ isPublished: true }),
    });

    assert.equal(response.status, 400);
    const body = await response.json();
    assert.equal(body.code, "CREDENTIALS_NOT_VERIFIED");

    // Verify in database that doctor is still not published
    const doc = await Doctor.findById(unverifiedDoctorId);
    assert.equal(doc.isPublished, false);
    assert.equal(doc.credentialVerification.status, "pending");
  });

  await t.test("2. Doctor cannot self-verify status via practice settings", async () => {
    const response = await fetch(`${origin}/api/doctor/practice-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${unverifiedDoctorToken}`,
      },
      body: JSON.stringify({
        credentialVerification: {
          status: "verified",
          councilRegistrationNumber: "MCI-FORGED",
        },
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    // Status must be pending, self-verification ignored
    assert.equal(body.settings.credentialVerification.status, "pending");
    assert.equal(body.settings.credentialVerification.councilRegistrationNumber, "MCI-FORGED");

    const doc = await Doctor.findById(unverifiedDoctorId);
    assert.equal(doc.credentialVerification.status, "pending");
  });

  await t.test("3. Platform operator can verify doctor credentials via saas route", async () => {
    const response = await fetch(`${origin}/api/saas/doctors/${unverifiedDoctorId}/verify-credentials`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${platformOperatorToken}`,
      },
      body: JSON.stringify({
        status: "verified",
        reviewNotes: "MCI Registration validated against official council ledger",
      }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.credentialVerification.status, "verified");
    assert.ok(body.credentialVerification.verifiedAt);

    const doc = await Doctor.findById(unverifiedDoctorId);
    assert.equal(doc.credentialVerification.status, "verified");
  });

  await t.test("4. Verified doctor can publish practice and preserve an explicitly zero consultation fee", async () => {
    // Now that unverifiedDoctorId is verified, publish it and set consultation fee to 0
    const updateRes = await fetch(`${origin}/api/doctor/practice-settings`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${unverifiedDoctorToken}`,
      },
      body: JSON.stringify({
        isPublished: true,
        consultationFee: 0,
        independentPractice: {
          enabled: true,
          consultationFee: 0,
          slotDurationMinutes: 15,
        },
      }),
    });

    assert.equal(updateRes.status, 200);
    const updateBody = await updateRes.json();
    assert.equal(updateBody.settings.isPublished, true);
    assert.equal(updateBody.settings.consultationFee, 0);
    assert.equal(updateBody.settings.independentPractice.consultationFee, 0);

    // Verify GET /api/doctor/practice-settings returns exactly 0, not 500
    const settingsRes = await fetch(`${origin}/api/doctor/practice-settings`, {
      headers: { Authorization: `Bearer ${unverifiedDoctorToken}` },
    });
    assert.equal(settingsRes.status, 200);
    const settings = await settingsRes.json();
    assert.equal(settings.consultationFee, 0);
    assert.equal(settings.independentPractice.consultationFee, 0);
    assert.equal(settings.isPublished, true);
    assert.equal(settings.credentialVerification.status, "verified");

    // Verify public profile GET /api/doctor/:id returns exactly 0
    const publicRes = await fetch(`${origin}/api/doctor/${unverifiedDoctorId}`);
    assert.equal(publicRes.status, 200);
    const publicDoc = await publicRes.json();
    assert.equal(publicDoc.user.consultationFee, 0);
    assert.equal(publicDoc.user.independentPractice.consultationFee, 0);
    assert.equal(publicDoc.user.isPublished, true);
    assert.equal(publicDoc.user.verificationStatus, "verified");
  });

  await t.test("5. Discovery via GET /api/doctor filters published and verified independent practices", async () => {
    // Create an unverified unpublished doctor
    const hiddenDocId = id();
    await Doctor.create({
      _id: hiddenDocId,
      firstName: "Hidden",
      lastName: "Unpublished",
      email: "hidden@example.invalid",
      password: "fixture-password-123",
      gender: "male",
      experience: { years: 2, expertise: "General Medicine" },
      credentialVerification: { status: "pending" },
      isPublished: false,
      independentPractice: { enabled: true },
    });

    const res = await fetch(`${origin}/api/doctor?limit=50`);
    assert.equal(res.status, 200);
    const data = await res.json();
    const items = data.items || [];

    const foundHidden = items.find((d) => String(d._id) === String(hiddenDocId));
    assert.equal(foundHidden, undefined, "Unpublished/unverified doctor must not appear in discovery");

    const foundVerified = items.find((d) => String(d._id) === String(verifiedDoctorId));
    assert.ok(foundVerified, "Verified and published doctor must appear in discovery");
    assert.equal(foundVerified.sourceType, "platform");
  });

  await t.test("6. Dual-role doctor is discoverable both independently and via hospital staff affiliation", async () => {
    const res = await fetch(`${origin}/api/doctor?limit=50`);
    assert.equal(res.status, 200);
    const data = await res.json();
    const items = data.items || [];

    // Should find dualDoctorId in platform context
    const independentEntry = items.find((d) => String(d._id) === String(dualDoctorId) && d.sourceType === "platform");
    assert.ok(independentEntry, "Dual-role doctor must be discoverable in independent platform context");
    assert.equal(independentEntry.bookingMode, "appointment");
    assert.equal(independentEntry.hospitalContext, null);

    // Should find staffDoctorId in hospital context
    const hospitalEntry = items.find((d) => String(d._id) === String(staffDoctorId) && d.sourceType === "hospital");
    assert.ok(hospitalEntry, "Dual-role doctor must be discoverable in hospital OPD context");
    assert.equal(hospitalEntry.bookingMode, "opd-token");
    assert.equal(String(hospitalEntry.hospitalContext.hospitalId), String(hospitalId));
  });

  await t.test("7. Unpublished, unverified, or inactive independent practice cannot be booked (403)", async () => {
    // Create inactive practice doctor
    const inactiveDocId = id();
    await Doctor.create({
      _id: inactiveDocId,
      firstName: "Inactive",
      lastName: "Doctor",
      email: "inactive@example.invalid",
      password: "fixture-password-123",
      gender: "male",
      experience: { years: 5, expertise: "Dermatology" },
      credentialVerification: { status: "verified" },
      isPublished: true,
      independentPractice: { enabled: false }, // explicitly disabled
    });

    // Create unpublished doctor
    const unpubDocId = id();
    await Doctor.create({
      _id: unpubDocId,
      firstName: "Unpublished",
      lastName: "Doctor",
      email: "unpub@example.invalid",
      password: "fixture-password-123",
      gender: "female",
      experience: { years: 4, expertise: "Pediatrics" },
      credentialVerification: { status: "verified" },
      isPublished: false,
      independentPractice: { enabled: true },
    });

    // Try booking inactive doctor
    const inactiveRes = await fetch(`${origin}/api/appointment/book/${inactiveDocId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${patientToken}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({}),
    });
    assert.equal(inactiveRes.status, 403);

    // Try booking unpublished doctor
    const unpubRes = await fetch(`${origin}/api/appointment/book/${unpubDocId}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${patientToken}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({}),
    });
    assert.equal(unpubRes.status, 403);
  });

  await t.test("8. Eligible published independent practice can be held, confirmed, and booked", async () => {
    // Create CareSession for verifiedDoctorId
    const now = new Date();
    const tomorrow = new Date(now.getTime() + 86400000);
    tomorrow.setUTCHours(9, 0, 0, 0);
    const ends = new Date(tomorrow.getTime() + 7200000); // 2 hours

    const sessionRes = await fetch(`${origin}/api/scheduling/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${verifiedDoctorToken}`,
      },
      body: JSON.stringify({
        doctorId: String(verifiedDoctorId),
        appointmentType: "scheduled_online",
        startsAt: tomorrow.toISOString(),
        endsAt: ends.toISOString(),
        slotDurationMinutes: 30,
      }),
    });

    assert.equal(sessionRes.status, 201);
    const sessionBody = await sessionRes.json();
    assert.ok(sessionBody._id);

    // Fetch availability
    const availRes = await fetch(`${origin}/api/scheduling/availability?doctorId=${verifiedDoctorId}&from=${sessionBody.serviceDate}&to=${sessionBody.serviceDate}`);
    assert.equal(availRes.status, 200);
    const availBody = await availRes.json();
    assert.ok(availBody.sessions.length > 0);
    const slot = availBody.sessions[0].slots[0];
    assert.ok(slot._id);

    // Hold slot
    const holdRes = await fetch(`${origin}/api/scheduling/holds`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${patientToken}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({ slotId: String(slot._id) }),
    });
    assert.equal(holdRes.status, 201);
    const holdBody = await holdRes.json();
    assert.ok(holdBody.reservation);

    // Confirm reservation
    const confirmRes = await fetch(`${origin}/api/scheduling/reservations/${holdBody.reservation._id}/confirm`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${patientToken}`,
        "Idempotency-Key": crypto.randomUUID(),
      },
      body: JSON.stringify({}),
    });
    assert.equal(confirmRes.status, 200);
    const confirmBody = await confirmRes.json();
    assert.equal(confirmBody.reservation.state, "confirmed");
  });

  await t.test("9. Overlapping care sessions across independent and hospital contexts are rejected with 409 conflict, non-overlapping succeed", async () => {
    const serviceDate = new Date(Date.now() + 2 * 86400000);
    serviceDate.setUTCHours(9, 0, 0, 0);
    const sessionEnd = new Date(serviceDate.getTime() + 7200000); // 09:00 - 11:00 UTC

    // 1. Dual doctor creates independent CareSession for 09:00 - 11:00 UTC
    const indepSessionRes = await fetch(`${origin}/api/scheduling/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${dualDoctorToken}`,
      },
      body: JSON.stringify({
        doctorId: String(dualDoctorId),
        appointmentType: "scheduled_online",
        startsAt: serviceDate.toISOString(),
        endsAt: sessionEnd.toISOString(),
        slotDurationMinutes: 30,
      }),
    });
    assert.equal(indepSessionRes.status, 201);

    // 2. Hospital administrator/staff attempts to create overlapping hospital CareSession for same doctor at 10:00 - 12:00 UTC
    const overlapStart = new Date(serviceDate.getTime() + 3600000); // 10:00 UTC (overlaps!)
    const overlapEnd = new Date(serviceDate.getTime() + 10800000); // 12:00 UTC

    const overlapRes = await fetch(`${origin}/api/scheduling/hospital/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        hospitalId: String(hospitalId),
        departmentId: String(departmentId),
        doctorId: String(staffDoctorId),
        appointmentType: "hospital_in_person",
        startsAt: overlapStart.toISOString(),
        endsAt: overlapEnd.toISOString(),
        slotDurationMinutes: 20,
      }),
    });

    assert.equal(overlapRes.status, 409, "Overlapping CareSession across hospital and independent contexts must be rejected");
    const overlapBody = await overlapRes.json();
    assert.match(overlapBody.message, /overlapping session/i);

    // 3. Hospital creates non-overlapping CareSession at 14:00 - 16:00 UTC
    const nonOverlapStart = new Date(serviceDate.getTime() + 18000000); // 14:00 UTC
    const nonOverlapEnd = new Date(serviceDate.getTime() + 25200000); // 16:00 UTC

    const nonOverlapRes = await fetch(`${origin}/api/scheduling/hospital/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${staffToken}`,
      },
      body: JSON.stringify({
        hospitalId: String(hospitalId),
        departmentId: String(departmentId),
        doctorId: String(staffDoctorId),
        appointmentType: "hospital_in_person",
        startsAt: nonOverlapStart.toISOString(),
        endsAt: nonOverlapEnd.toISOString(),
        slotDurationMinutes: 20,
      }),
    });

    assert.equal(nonOverlapRes.status, 201, "Non-overlapping CareSession must succeed");
    const nonOverlapBody = await nonOverlapRes.json();
    assert.ok(nonOverlapBody._id);
    assert.equal(nonOverlapBody.practiceType, "hospital");
  });
});
