import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import HospitalStaff from "../../model/hospitalStaff.js";
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
} from "../../services/emergencyTheatreService.js";

let uri = null;
try {
  uri = new URL(localTestTargets().mongo);
  uri.pathname = "/medipulse_test_em_theatre_" + crypto.randomBytes(6).toString("hex");
} catch {
  // Gracefully fallback when test targets not present in ambient environment
}

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const departmentId = id();
const surgeonDoctorId = id();
const anesthetistDoctorId = id();
const nurseStaffId = id();
const patientId = id();
let theatreRoomId;
let db;

before(async (t) => {
  if (!uri) {
    t.skip("Local test targets not configured; skipping live integration tests");
    return;
  }
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

  await Hospital.create({
    _id: hospitalId,
    name: "Apollo Multispecialty Enterprise Hospital",
    slug: "apollo-enterprise",
    registrationNumber: "REG-APOLLO-ENT-001",
    type: "private",
    email: "apollo-multispecialty@example.test",
    address: { city: "New Delhi", state: "Delhi" },
    status: "active",
    subscription: { plan: "enterprise", status: "active" },
  });

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
});
