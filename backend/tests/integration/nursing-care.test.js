import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import { Ward, Room, Bed, IpdAdmission } from "../../model/inpatient.js";
import {
  InpatientOrder,
  NursingVitals,
  MedicationAdministrationRecord,
  NurseShiftHandover,
} from "../../model/nursingCare.js";
import { localTestTargets } from "../../util/testTargets.js";
import {
  createInpatientOrder,
  discontinueInpatientOrder,
  recordNursingVitals,
  administerMedication,
  recordMedicationOmission,
  recordShiftHandover,
  getInpatientFlowsheet,
} from "../../services/nursingCareService.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_nursing_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const departmentId = id();
const doctorId = id();
const nurse1Id = id();
const nurse2Id = id();
const patientId = id();
const wardId = id();
const roomId = id();
const bedId = id();
let admissionId;
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

  await Hospital.create({
    _id: hospitalId,
    name: "Max Super Specialty Enterprise Hospital",
    slug: "max-super",
    registrationNumber: "REG-MAX-001",
    type: "private",
    email: "max-super@example.test",
    address: { city: "New Delhi", state: "Delhi" },
    status: "active",
    subscription: { plan: "enterprise", status: "active" },
  });

  await Department.create({
    _id: departmentId,
    hospitalId,
    name: "Internal Medicine",
    code: "MED-INT",
    status: "active",
    opd: { consultationFee: 500, isActive: true },
  });

  await Doctor.create({
    _id: doctorId,
    firstName: "Deepak",
    lastName: "Mehta",
    email: "deepak.mehta@max.test",
    password: "Password@123",
    gender: "male",
    specialization: "General Medicine",
    experience: { years: 14, expertise: "General Medicine" },
  });

  await HospitalStaff.create([
    {
      _id: nurse1Id,
      hospitalId,
      departmentIds: [departmentId],
      name: "Staff Nurse Priya Nair",
      email: "priya.nair@max.test",
      role: "NURSE",
      isActive: true,
    },
    {
      _id: nurse2Id,
      hospitalId,
      departmentIds: [departmentId],
      name: "Charge Nurse Anjali Sharma",
      email: "anjali.sharma@max.test",
      role: "NURSE",
      isActive: true,
    },
  ]);

  await User.create({
    _id: patientId,
    firstName: "Vikramaditya",
    lastName: "Rao",
    email: "vikram.rao@test.org",
    password: "Password@123",
    gender: "male",
    phoneNumber: 9123456789,
  });

  await Ward.create({
    _id: wardId,
    hospitalId,
    name: "Medical HDU",
    code: "WARD-HDU",
  });

  await Room.create({
    _id: roomId,
    hospitalId,
    wardId,
    roomNumber: "HDU-01",
  });

  await Bed.create({
    _id: bedId,
    hospitalId,
    wardId,
    roomId,
    bedNumber: "HDU-BED-01",
    status: "occupied",
  });

  const adm = await IpdAdmission.create({
    hospitalId,
    admissionNumber: "IPD-MAX-1001",
    patientId,
    admittingDoctorId: doctorId,
    departmentId,
    currentWardId: wardId,
    currentRoomId: roomId,
    currentBedId: bedId,
    admittingDiagnosis: "Community-Acquired Lobar Pneumonia with Sepsis",
    status: "admitted",
  });
  admissionId = adm._id;
});

test("Task AG19: Inpatient Clinical Orders, Nursing and Medication Administration (Integration)", async (t) => {
  if (!db) {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
    return;
  }

  await t.test("1. Clinician order creation automatically schedules eMAR doses in MongoDB", async () => {
    const res = await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Piperacillin-Tazobactam",
        dose: "4.5g",
        route: "iv",
        frequency: "tds", // every 8h
        durationDays: 3,
      },
      nursingInstructions: "Infuse over 4 hours (extended infusion)",
      actor: { doctorId },
    });

    assert.equal(res.success, true);
    assert.equal(res.order.medicationDetails.drugName, "Piperacillin-Tazobactam");
    // 3 days * 3 doses/day = 9 scheduled doses
    assert.equal(res.scheduledDosesCount, 9);

    const savedEmars = await MedicationAdministrationRecord.find({ orderId: res.order._id });
    assert.equal(savedEmars.length, 9);
    assert.ok(savedEmars.every((e) => e.status === "scheduled"));
  });

  await t.test("2. Nursing vitals calculation correctly records NEWS2 and triggers doctor escalation", async () => {
    // Vitals with severe tachypnea and hypoxia
    const vitals = {
      respirationRate: 26, // 3
      spO2: 91,            // 3
      supplementalOxygen: true, // 2
      systolicBP: 95,      // 2
      pulse: 115,          // 2
      consciousness: "A",  // 0
      temperature: 38.5,   // 1
      painScore: 4,
    };

    const res = await recordNursingVitals({
      hospitalId,
      admissionId,
      vitals,
      actor: { staffId: nurse1Id },
    });

    assert.equal(res.success, true);
    assert.ok(res.news2.score >= 7);
    assert.equal(res.news2.riskLevel, "HIGH");
    assert.equal(res.news2.requiresCodeBlue, true);

    const savedVitals = await NursingVitals.findById(res.vitals._id);
    assert.ok(savedVitals);
    assert.equal(savedVitals.news2.requiresDoctorEscalation, true);
  });

  await t.test("3. eMAR administration enforces 5 rights and dual-nurse witness on controlled substances", async () => {
    // Order Fentanyl (Schedule X Narcotic)
    const orderRes = await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Fentanyl Citrate",
        dose: "50mcg",
        route: "iv",
        frequency: "stat",
        isControlledSubstance: true,
      },
      actor: { doctorId },
    });

    const emar = await MedicationAdministrationRecord.findOne({ orderId: orderRes.order._id });
    assert.ok(emar);

    // Missing dual witness on narcotic -> Fails
    await assert.rejects(
      () =>
        administerMedication({
          hospitalId,
          emarId: emar._id,
          fiveRightsVerified: {
            rightPatient: true,
            rightDrug: true,
            rightDose: true,
            rightRoute: true,
            rightTime: true,
          },
          actor: { staffId: nurse1Id },
        }),
      /Mandatory dual-nurse verification missing/
    );

    // Legitimate administration with secondary nurse witness
    const adminRes = await administerMedication({
      hospitalId,
      emarId: emar._id,
      fiveRightsVerified: {
        rightPatient: true,
        rightDrug: true,
        rightDose: true,
        rightRoute: true,
        rightTime: true,
      },
      dualWitnessStaffId: nurse2Id,
      dualWitnessSignature: "Charge Nurse Anjali Sharma RN",
      actor: { staffId: nurse1Id },
    });

    assert.equal(adminRes.success, true);
    assert.equal(adminRes.emar.status, "administered");

    const updated = await MedicationAdministrationRecord.findById(emar._id);
    assert.equal(updated.status, "administered");
    assert.equal(String(updated.dualWitnessStaffId), String(nurse2Id));
  });

  await t.test("4. Shift handover logs structured summary and critical alerts", async () => {
    await createInpatientOrder({
      hospitalId,
      admissionId,
      patientId,
      orderType: "medication",
      medicationDetails: {
        drugName: "Piperacillin-Tazobactam",
        dose: "4.5g",
        route: "iv",
        frequency: "tds",
        durationDays: 3,
      },
      nursingInstructions: "Infuse over 4 hours (extended infusion)",
      actor: { doctorId },
    });

    const handover = await recordShiftHandover({
      hospitalId,
      wardId,
      shiftDate: "2026-10-22",
      shiftType: "evening",
      outgoingNurseStaffId: nurse1Id,
      incomingNurseStaffId: nurse2Id,
      patientSummaries: [
        {
          admissionId,
          bedNumber: "HDU-BED-01",
          patientName: "Vikramaditya Rao",
          diagnosis: "Lobar Pneumonia",
          news2Score: 7,
          pendingTasks: ["Repeat ABG at 20:00", "Monitor SpO2 on 4L nasal cannula"],
          criticalAlerts: "High NEWS2 score, Code Blue outreach notified",
        },
      ],
      codeBlueEvents: [],
      handoverNotes: "Patient required non-rebreather mask escalation during afternoon shift.",
      actor: { staffId: nurse1Id },
    });

    assert.equal(handover.success, true);
    assert.equal(handover.criticalPatientsCount, 1);

    const savedHandover = await NurseShiftHandover.findById(handover.handover._id);
    assert.ok(savedHandover);
    assert.equal(savedHandover.shiftType, "evening");

    // Flowsheet check
    const flowsheet = await getInpatientFlowsheet({ hospitalId, admissionId });
    assert.ok(flowsheet.activeOrders.length >= 1);
  });
});
