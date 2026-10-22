import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import AuthSession from "../../model/authSession.js";
import "../../model/inpatient.js";
import {
  EmergencyRegistration,
  TheatreRoom,
  OtSchedule,
} from "../../model/emergencyTheatre.js";
import { localTestTargets } from "../../util/testTargets.js";
import {
  registerEmergencyPatient,
  createTheatreRoom,
  getTheatreRooms,
  bookTheatreCase,
  cancelTheatreCase,
  recordWhoChecklistStage,
  recordPacuRecovery,
  getEmergencyRegistrations,
  getEmergencyRegistrationById,
  updateEmergencyStatus,
  getOtSchedules,
  getOtScheduleById,
} from "../../services/emergencyTheatreService.js";
import emergencyTheatreRouter from "../../routes/emergencyTheatre.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_em_theatre_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const foreignHospitalId = id();
const departmentId = id();
const surgeonDoctorId = id();
const anesthetistDoctorId = id();
const nurseStaffId = id();
const patientId = id();
let theatreRoomId;
let db;

before(async (t) => {
  try {
    await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 3000 });
    db = mongoose.connection.db;
  } catch {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
  }
});

after(async () => {
  await db?.dropDatabase();
  await mongoose.disconnect();
});

beforeEach(async () => {
  if (!db) return;
  for (const collection of await db.listCollections({}, { nameOnly: true }).toArray()) {
    await db.collection(collection.name).deleteMany({});
  }

  await Hospital.create([
    {
      _id: hospitalId,
      name: "Apollo Multispecialty Enterprise Hospital",
      slug: "apollo-enterprise",
      registrationNumber: "REG-APOLLO-ENT-001",
      type: "private",
      email: "apollo-multispecialty@example.test",
      address: { city: "New Delhi", state: "Delhi" },
      status: "active",
      subscription: { plan: "enterprise", status: "active" },
    },
    {
      _id: foreignHospitalId,
      name: "Max Super Specialty Hospital",
      slug: "max-enterprise",
      registrationNumber: "REG-MAX-ENT-002",
      type: "private",
      email: "max-multispecialty@example.test",
      address: { city: "Gurugram", state: "Haryana" },
      status: "active",
      subscription: { plan: "enterprise", status: "active" },
    },
  ]);

  await Department.create({
    _id: departmentId,
    hospitalId,
    name: "General & Laparoscopic Surgery",
    code: "SURG-GEN",
    status: "active",
    opd: { consultationFee: 500, isActive: true },
  });

  await Doctor.create([
    {
      _id: surgeonDoctorId,
      firstName: "Vikram",
      lastName: "Sethi",
      email: "vikram.sethi@apollo.test",
      password: "Password@123",
      gender: "male",
      specialization: "Surgical Gastroenterology",
      experience: { years: 12, expertise: "Surgical Gastroenterology" },
    },
    {
      _id: anesthetistDoctorId,
      firstName: "Radhika",
      lastName: "Sen",
      email: "radhika.sen@apollo.test",
      password: "Password@123",
      gender: "female",
      specialization: "Neuro & Cardiac Anesthesia",
      experience: { years: 10, expertise: "Neuro & Cardiac Anesthesia" },
    },
  ]);

  await HospitalStaff.create({
    _id: nurseStaffId,
    hospitalId,
    departmentIds: [departmentId],
    name: "Senior OT Sister Maya Menon RN",
    email: "maya.menon@apollo.test",
    role: "NURSE",
    isActive: true,
  });

  await User.create({
    _id: patientId,
    firstName: "Harish",
    lastName: "Chandra",
    email: "harish.chandra@test.org",
    password: "Password@123",
    gender: "male",
    phoneNumber: 9876501234,
  });

  const room = await TheatreRoom.create({
    hospitalId,
    theatreCode: "OT-MAIN-01",
    theatreName: "Main Surgical Suite",
    theatreType: "major",
    isActive: true,
  });
  theatreRoomId = room._id;
});

test("Task AG20: Emergency and Theatre Workflows (Integration)", async (t) => {
  if (!db) {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
    return;
  }

  await t.test("1. Emergency registration persists triage level and assigns resuscitation bay", async () => {
    const res = await registerEmergencyPatient({
      hospitalId,
      patientName: "Trauma Case #902",
      age: 28,
      gender: "male",
      arrivalMode: "ambulance",
      triageLevel: 1,
      chiefComplaint: "Penetrating thoracic trauma, tension pneumothorax",
      actor: { staffId: nurseStaffId },
    });

    assert.equal(res.success, true);
    assert.equal(res.registration.triageLevel, 1);
    assert.equal(res.registration.triageCategory, "RESUSCITATION");
    assert.equal(res.registration.assignedBay, "RESUSCITATION-BAY-1");

    const saved = await EmergencyRegistration.findById(res.registration._id);
    assert.ok(saved);
    assert.equal(saved.triageCategory, "RESUSCITATION");
  });

  await t.test("2. Operation theatre booking enforces conflict validation and WHO checklist lifecycle in DB", async () => {
    const startTime = new Date(Date.now() + 2 * 3600 * 1000);
    const endTime = new Date(Date.now() + 5 * 3600 * 1000);

    const bookingRes = await bookTheatreCase({
      hospitalId,
      theatreRoomId,
      patientId,
      leadSurgeonDoctorId: surgeonDoctorId,
      anesthetistDoctorId: anesthetistDoctorId,
      scrubNurseStaffId: nurseStaffId,
      procedureName: "Emergency Exploratory Laparotomy",
      urgency: "urgent",
      scheduledStartTime: startTime,
      scheduledEndTime: endTime,
      actor: { doctorId: surgeonDoctorId },
    });

    assert.equal(bookingRes.success, true);
    assert.equal(bookingRes.booking.status, "scheduled");

    const bookingId = bookingRes.booking._id;

    // Overlapping booking for same room rejected with 409
    await assert.rejects(
      () =>
        bookTheatreCase({
          hospitalId,
          theatreRoomId,
          patientId,
          leadSurgeonDoctorId: surgeonDoctorId,
          anesthetistDoctorId: anesthetistDoctorId,
          procedureName: "Elective Cholecystectomy",
          scheduledStartTime: new Date(startTime.getTime() + 30 * 60 * 1000),
          scheduledEndTime: new Date(endTime.getTime() + 60 * 60 * 1000),
        }),
      /Theatre room OT-MAIN-01 is already booked/
    );

    // Progress through WHO Checklist: Sign In
    const signInRes = await recordWhoChecklistStage({
      hospitalId,
      bookingId,
      stage: "signIn",
      checkpoints: {
        patient_identity_confirmed: true,
        surgical_site_marked: true,
        anesthesia_safety_check_complete: true,
        pulse_oximeter_operating: true,
        allergy_status_verified: true,
        airway_aspiration_risk_evaluated: true,
        blood_loss_risk_prepared: true,
      },
      actor: { staffId: nurseStaffId },
    });
    assert.equal(signInRes.status, "in_progress");

    // Progress through WHO Checklist: Time Out
    const timeOutRes = await recordWhoChecklistStage({
      hospitalId,
      bookingId,
      stage: "timeOut",
      checkpoints: {
        team_introductions_complete: true,
        patient_procedure_site_confirmed: true,
        surgeon_critical_events_reviewed: true,
        anesthetist_concerns_reviewed: true,
        nursing_sterility_confirmed: true,
        antibiotic_prophylaxis_administered_within_60m: true,
        essential_imaging_displayed: true,
      },
      actor: { doctorId: surgeonDoctorId },
    });
    assert.equal(timeOutRes.success, true);

    // Progress through WHO Checklist: Sign Out
    const signOutRes = await recordWhoChecklistStage({
      hospitalId,
      bookingId,
      stage: "signOut",
      checkpoints: {
        procedure_name_recorded: true,
        instrument_sponge_needle_counts_correct: true,
        surgical_specimen_labeled: true,
        equipment_issues_recorded: true,
        surgeon_anesthetist_nurse_recovery_plan_agreed: true,
      },
      actor: { staffId: nurseStaffId },
    });
    assert.equal(signOutRes.status, "completed");

    // PACU Aldrete gate: score 9 allows ward discharge
    const pacuRes = await recordPacuRecovery({
      hospitalId,
      bookingId,
      aldreteScore: 9,
      dischargedToWard: true,
      actor: { staffId: nurseStaffId },
    });
    assert.equal(pacuRes.success, true);
    assert.equal(pacuRes.pacu.dischargedToWard, true);

    const updatedBooking = await OtSchedule.findById(bookingId);
    assert.equal(updatedBooking.status, "completed");
    assert.equal(updatedBooking.pacu.aldreteScore, 9);
    assert.equal(updatedBooking.pacu.dischargedToWard, true);
  });

  await t.test("3. PACU safety gate rejects premature ward transfer (< 8) and approves score >= 8", async () => {
    const startTime = new Date(Date.now() + 6 * 3600 * 1000);
    const endTime = new Date(Date.now() + 8 * 3600 * 1000);

    const bookingRes = await bookTheatreCase({
      hospitalId,
      theatreRoomId,
      patientId,
      leadSurgeonDoctorId: surgeonDoctorId,
      anesthetistDoctorId: anesthetistDoctorId,
      procedureName: "Hernia Repair",
      scheduledStartTime: startTime,
      scheduledEndTime: endTime,
    });
    const bId = bookingRes.booking._id;

    // Simulate completion
    await OtSchedule.findByIdAndUpdate(bId, { status: "completed" });

    // Premature ward discharge attempt with score 6 -> rejected
    await assert.rejects(
      () =>
        recordPacuRecovery({
          hospitalId,
          bookingId: bId,
          aldreteScore: 6,
          dischargedToWard: true,
        }),
      /PACU safety violation: Aldrete recovery score of 6 is insufficient for ward transfer/
    );

    // Patient kept in PACU with score 6 -> allowed
    const monitorRes = await recordPacuRecovery({
      hospitalId,
      bookingId: bId,
      aldreteScore: 6,
      dischargedToWard: false,
    });
    assert.equal(monitorRes.success, true);
    assert.equal(monitorRes.pacu.dischargedToWard, false);

    // Later recovery to score 8 -> ward discharge allowed
    const dischargeRes = await recordPacuRecovery({
      hospitalId,
      bookingId: bId,
      aldreteScore: 8,
      dischargedToWard: true,
    });
    assert.equal(dischargeRes.success, true);
    assert.equal(dischargeRes.pacu.dischargedToWard, true);
  });

  await t.test("4. Emergency status update and disposition lifecycle (admitted_ipd, outcome notes)", async () => {
    const regRes = await registerEmergencyPatient({
      hospitalId,
      patientName: "Acute Abdomen Patient",
      age: 45,
      gender: "female",
      triageLevel: 2,
      chiefComplaint: "Severe RLQ abdominal pain",
      actor: { staffId: nurseStaffId },
    });
    const regId = regRes.registration._id;

    // Transition to in_treatment
    const treatRes = await updateEmergencyStatus({
      hospitalId,
      emergencyRegistrationId: regId,
      status: "in_treatment",
      assignedBay: "ACUTE-BAY-3",
      attendingDoctorId: surgeonDoctorId,
    });
    assert.equal(treatRes.success, true);
    assert.equal(treatRes.registration.status, "in_treatment");
    assert.equal(treatRes.registration.assignedBay, "ACUTE-BAY-3");

    // Transition to admitted_ipd with disposition
    const admitRes = await updateEmergencyStatus({
      hospitalId,
      emergencyRegistrationId: regId,
      status: "admitted_ipd",
      outcomeNotes: "Admitted to Surgical Ward Bed SW-101 for emergency appendectomy",
    });
    assert.equal(admitRes.success, true);
    assert.equal(admitRes.registration.status, "admitted_ipd");
    assert.ok(admitRes.registration.dispositionTime);
  });

  await t.test("5. Comprehensive HTTP Router Integration: Auth, Roles, Isolation, Conflict & Checklist Lifecycle", async () => {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    app.use("/api/emergency", emergencyTheatreRouter);

    app.use((err, req, res, next) => {
      res.status(err.status || 500).json({ error: err.message });
    });

    const server = app.listen(0);
    await once(server, "listening");
    const port = server.address().port;
    const apiOrigin = `http://127.0.0.1:${port}`;

    try {
      // Helper to generate authenticated sessions
      const createStaffSession = async ({ role, adminAccess = false, hId = hospitalId, doctorId = null }) => {
        const staffMember = await HospitalStaff.create({
          hospitalId: hId,
          departmentIds: [departmentId],
          name: `Staff Member ${role}`,
          email: `staff.${role.toLowerCase()}.${crypto.randomBytes(4).toString("hex")}@apollo.test`,
          role,
          adminAccess,
          isActive: true,
          inviteStatus: "accepted",
        });
        const sid = crypto.randomUUID();
        await AuthSession.create({
          _id: sid,
          principalId: staffMember._id,
          kind: "staff",
          authVersion: 0,
          csrfToken: "csrf-token-test",
          expiresAt: new Date(Date.now() + 600000),
        });
        const token = jwt.sign(
          {
            id: String(staffMember._id),
            sid,
            role,
            type: "staff",
            hospitalId: String(hId),
            doctorId: doctorId ? String(doctorId) : undefined,
          },
          process.env.TOKEN_KEY || "local-development-signing-key-replace-before-production"
        );
        return { staff: staffMember, token };
      };

      const { token: adminToken } = await createStaffSession({ role: "HOSPITAL_ADMIN", adminAccess: true });
      const { token: surgeonToken } = await createStaffSession({ role: "DOCTOR", doctorId: surgeonDoctorId });
      const { token: anesthetistToken } = await createStaffSession({ role: "DOCTOR", doctorId: anesthetistDoctorId });
      const { token: nurseToken } = await createStaffSession({ role: "NURSE" });
      const { token: receptionistToken } = await createStaffSession({ role: "RECEPTIONIST" });
      const { token: foreignAdminToken } = await createStaffSession({ role: "HOSPITAL_ADMIN", adminAccess: true, hId: foreignHospitalId });

      const request = async (path, { method = "GET", token, body } = {}) => {
        const headers = { "Content-Type": "application/json" };
        if (token) headers["Authorization"] = `Bearer ${token}`;
        const res = await fetch(`${apiOrigin}${path}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => ({}));
        return { status: res.status, data };
      };

      // 1. Unauthenticated request -> 401
      const unauth = await request("/api/emergency/registrations");
      assert.equal(unauth.status, 401);

      // 2. Role authorization denials:
      // Receptionist cannot book theatre surgery -> 403
      const receptionistBook = await request("/api/emergency/bookings", {
        method: "POST",
        token: receptionistToken,
        body: { theatreRoomId, patientId, procedureName: "Surgery" },
      });
      assert.equal(receptionistBook.status, 403);

      // Nurse cannot create theatre room -> 403 (requires HOSPITAL_ADMIN)
      const nurseCreateRoom = await request("/api/emergency/theatres", {
        method: "POST",
        token: nurseToken,
        body: { theatreCode: "OT-NURSE-01", theatreName: "Nurse Suite" },
      });
      assert.equal(nurseCreateRoom.status, 403);

      // Nurse cannot verify Time Out checklist -> 403 (strictly operating surgeon DOCTOR)
      const nurseTimeOut = await request(`/api/emergency/bookings/${id()}/who-checklist`, {
        method: "POST",
        token: nurseToken,
        body: { stage: "timeOut", checkpoints: {} },
      });
      assert.equal(nurseTimeOut.status, 403);

      // 3. Foreign hospital tenant isolation:
      // Foreign admin queries registrations -> empty list in their hospital
      const foreignRegs = await request("/api/emergency/registrations", { token: foreignAdminToken });
      assert.equal(foreignRegs.status, 200);
      assert.equal(foreignRegs.data.registrations.length, 0);

      // Foreign admin attempting to book surgery in Hospital A's theatre room -> 404
      const foreignBook = await request("/api/emergency/bookings", {
        method: "POST",
        token: foreignAdminToken,
        body: {
          theatreRoomId,
          patientId,
          leadSurgeonDoctorId: surgeonDoctorId,
          anesthetistDoctorId: anesthetistDoctorId,
          procedureName: "Foreign Procedure",
          scheduledStartTime: new Date(Date.now() + 10 * 3600 * 1000),
          scheduledEndTime: new Date(Date.now() + 12 * 3600 * 1000),
        },
      });
      assert.equal(foreignBook.status, 404);

      // 4. Emergency registration via HTTP
      const erRegRes = await request("/api/emergency/registrations", {
        method: "POST",
        token: nurseToken,
        body: {
          patientName: "Trauma Code Blue #401",
          age: 33,
          gender: "male",
          arrivalMode: "ambulance",
          triageLevel: 1,
          chiefComplaint: "Multi-vehicle collision, severe blunt polytrauma",
        },
      });
      assert.equal(erRegRes.status, 201);
      assert.equal(erRegRes.data.success, true);
      assert.equal(erRegRes.data.registration.triageLevel, 1);
      assert.equal(erRegRes.data.registration.triageCategory, "RESUSCITATION");
      assert.equal(erRegRes.data.registration.assignedBay, "RESUSCITATION-BAY-1");

      const erId = erRegRes.data.registration._id;

      // Update emergency status to in_treatment
      const erUpdateRes = await request(`/api/emergency/registrations/${erId}/status`, {
        method: "PATCH",
        token: surgeonToken,
        body: { status: "in_treatment", outcomeNotes: "Patient stabilized, preparing for emergency laparotomy" },
      });
      assert.equal(erUpdateRes.status, 200);
      assert.equal(erUpdateRes.data.registration.status, "in_treatment");

      // Receptionist queries emergency registrations
      const listErRes = await request("/api/emergency/registrations?triageLevel=1", { token: receptionistToken });
      assert.equal(listErRes.status, 200);
      assert.ok(listErRes.data.registrations.length >= 1);

      // 5. Theatre room creation & OT Scheduling via HTTP
      const createRoomRes = await request("/api/emergency/theatres", {
        method: "POST",
        token: adminToken,
        body: { theatreCode: "OT-CARDIAC-01", theatreName: "Cardiac & Vascular OR", theatreType: "cardiac" },
      });
      assert.equal(createRoomRes.status, 201);
      const cardiacRoomId = createRoomRes.data.room._id;

      const otStart = new Date(Date.now() + 14 * 3600 * 1000);
      const otEnd = new Date(Date.now() + 17 * 3600 * 1000);

      const bookRes = await request("/api/emergency/bookings", {
        method: "POST",
        token: surgeonToken,
        body: {
          theatreRoomId: cardiacRoomId,
          patientId,
          emergencyRegistrationId: erId,
          leadSurgeonDoctorId: surgeonDoctorId,
          anesthetistDoctorId: anesthetistDoctorId,
          procedureName: "Emergency Damage Control Laparotomy",
          urgency: "emergency_stat",
          scheduledStartTime: otStart,
          scheduledEndTime: otEnd,
        },
      });
      assert.equal(bookRes.status, 201);
      assert.equal(bookRes.data.success, true);
      const httpBookingId = bookRes.data.booking._id;

      // Triple-conflict checks via HTTP:
      // (a) Overlapping room -> 409
      const roomConflictHttp = await request("/api/emergency/bookings", {
        method: "POST",
        token: surgeonToken,
        body: {
          theatreRoomId: cardiacRoomId,
          patientId,
          leadSurgeonDoctorId: id(),
          anesthetistDoctorId: id(),
          procedureName: "Conflicting Procedure",
          scheduledStartTime: new Date(otStart.getTime() + 30 * 60 * 1000),
          scheduledEndTime: new Date(otEnd.getTime() + 30 * 60 * 1000),
        },
      });
      assert.equal(roomConflictHttp.status, 409);

      // (b) Overlapping surgeon -> 409
      const surgeonConflictHttp = await request("/api/emergency/bookings", {
        method: "POST",
        token: surgeonToken,
        body: {
          theatreRoomId,
          patientId,
          leadSurgeonDoctorId: surgeonDoctorId,
          anesthetistDoctorId: id(),
          procedureName: "Surgeon Conflict Procedure",
          scheduledStartTime: new Date(otStart.getTime() + 30 * 60 * 1000),
          scheduledEndTime: new Date(otEnd.getTime() + 30 * 60 * 1000),
        },
      });
      assert.equal(surgeonConflictHttp.status, 409);

      // (c) Overlapping anesthetist -> 409
      const anesthetistConflictHttp = await request("/api/emergency/bookings", {
        method: "POST",
        token: surgeonToken,
        body: {
          theatreRoomId,
          patientId,
          leadSurgeonDoctorId: id(),
          anesthetistDoctorId: anesthetistDoctorId,
          procedureName: "Anesthetist Conflict Procedure",
          scheduledStartTime: new Date(otStart.getTime() + 30 * 60 * 1000),
          scheduledEndTime: new Date(otEnd.getTime() + 30 * 60 * 1000),
        },
      });
      assert.equal(anesthetistConflictHttp.status, 409);

      // 6. WHO Surgical Safety Checklist via HTTP
      // Attempt Time Out before Sign In -> 400
      const prematureTimeOut = await request(`/api/emergency/bookings/${httpBookingId}/who-checklist`, {
        method: "POST",
        token: surgeonToken,
        body: { stage: "timeOut", checkpoints: { team_introductions_complete: true } },
      });
      assert.equal(prematureTimeOut.status, 400);

      // Complete Sign In via HTTP -> 200, status in_progress
      const signInHttp = await request(`/api/emergency/bookings/${httpBookingId}/who-checklist`, {
        method: "POST",
        token: nurseToken,
        body: {
          stage: "signIn",
          checkpoints: {
            patient_identity_confirmed: true,
            surgical_site_marked: true,
            anesthesia_safety_check_complete: true,
            pulse_oximeter_operating: true,
            allergy_status_verified: true,
            airway_aspiration_risk_evaluated: true,
            blood_loss_risk_prepared: true,
          },
        },
      });
      assert.equal(signInHttp.status, 200);
      assert.equal(signInHttp.data.status, "in_progress");

      // Surgeon performs Time Out via HTTP -> 200
      const timeOutHttp = await request(`/api/emergency/bookings/${httpBookingId}/who-checklist`, {
        method: "POST",
        token: surgeonToken,
        body: {
          stage: "timeOut",
          checkpoints: {
            team_introductions_complete: true,
            patient_procedure_site_confirmed: true,
            surgeon_critical_events_reviewed: true,
            anesthetist_concerns_reviewed: true,
            nursing_sterility_confirmed: true,
            antibiotic_prophylaxis_administered_within_60m: true,
            essential_imaging_displayed: true,
          },
        },
      });
      assert.equal(timeOutHttp.status, 200);

      // Complete Sign Out via HTTP -> 200, status completed
      const signOutHttp = await request(`/api/emergency/bookings/${httpBookingId}/who-checklist`, {
        method: "POST",
        token: nurseToken,
        body: {
          stage: "signOut",
          checkpoints: {
            procedure_name_recorded: true,
            instrument_sponge_needle_counts_correct: true,
            surgical_specimen_labeled: true,
            equipment_issues_recorded: true,
            surgeon_anesthetist_nurse_recovery_plan_agreed: true,
          },
        },
      });
      assert.equal(signOutHttp.status, 200);
      assert.equal(signOutHttp.data.status, "completed");

      // 7. PACU Aldrete Recovery Scoring via HTTP
      // Score 6 with dischargedToWard: true -> 400 safety violation
      const pacuPremature = await request(`/api/emergency/bookings/${httpBookingId}/pacu`, {
        method: "POST",
        token: nurseToken,
        body: { aldreteScore: 6, dischargedToWard: true },
      });
      assert.equal(pacuPremature.status, 400);

      // Score 9 with dischargedToWard: true -> 200 approved
      const pacuApproved = await request(`/api/emergency/bookings/${httpBookingId}/pacu`, {
        method: "POST",
        token: nurseToken,
        body: { aldreteScore: 9, dischargedToWard: true },
      });
      assert.equal(pacuApproved.status, 200);
      assert.equal(pacuApproved.data.pacu.dischargedToWard, true);

      // 8. Cancellation and immediate slot reallocation via HTTP
      const electiveStart = new Date(Date.now() + 20 * 3600 * 1000);
      const electiveEnd = new Date(Date.now() + 22 * 3600 * 1000);

      const electiveBooking = await request("/api/emergency/bookings", {
        method: "POST",
        token: surgeonToken,
        body: {
          theatreRoomId,
          patientId,
          leadSurgeonDoctorId: surgeonDoctorId,
          anesthetistDoctorId: anesthetistDoctorId,
          procedureName: "Elective Laparoscopic Cholecystectomy",
          scheduledStartTime: electiveStart,
          scheduledEndTime: electiveEnd,
        },
      });
      assert.equal(electiveBooking.status, 201);
      const cancelTargetId = electiveBooking.data.booking._id;

      // Cancel with reason -> 200
      const cancelRes = await request(`/api/emergency/bookings/${cancelTargetId}/cancel`, {
        method: "POST",
        token: surgeonToken,
        body: { reason: "Patient acute fever and elevated inflammatory markers; rescheduled" },
      });
      assert.equal(cancelRes.status, 200);
      assert.equal(cancelRes.data.booking.status, "cancelled");

      // Reallocate the now-freed slot immediately -> 201
      const reallocatedBooking = await request("/api/emergency/bookings", {
        method: "POST",
        token: surgeonToken,
        body: {
          theatreRoomId,
          patientId,
          leadSurgeonDoctorId: surgeonDoctorId,
          anesthetistDoctorId: anesthetistDoctorId,
          procedureName: "Urgent Abscess Drainage",
          scheduledStartTime: electiveStart,
          scheduledEndTime: electiveEnd,
        },
      });
      assert.equal(reallocatedBooking.status, 201);
      assert.equal(reallocatedBooking.data.booking.status, "scheduled");
    } finally {
      server.close();
    }
  });
});
