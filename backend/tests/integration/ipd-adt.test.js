import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import Hospital from "../../model/hospital.js";
import Department from "../../model/department.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import { Ward, Room, Bed, IpdAdmission, BedTransferRecord } from "../../model/inpatient.js";
import { localTestTargets } from "../../util/testTargets.js";
import {
  createWard,
  getWards,
  createRoom,
  getRooms,
  createBed,
  getBeds,
  updateBedStatus,
  admitPatient,
  transferBed,
  recordDischargeClearance,
  finalizeDischarge,
  getInpatientTimeline,
} from "../../services/ipdAdtService.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_ipd_adt_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
const hospitalId = id();
const departmentId = id();
const doctorId = id();
const nurseId = id();
const patient1Id = id();
const patient2Id = id();

let db;

before(async (t) => {
  try {
    await mongoose.connect(uri.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 3000 });
    db = mongoose.connection.db;
  } catch (err) {
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

  // Hospital with enterprise subscription containing ipd_beds feature
  await Hospital.create({
    _id: hospitalId,
    name: "Apollo Global Enterprise Hospital",
    slug: "apollo-global",
    status: "active",
    subscription: {
      plan: "enterprise",
      status: "active",
    },
  });

  await Department.create({
    _id: departmentId,
    hospitalId,
    name: "General Medicine & Inpatient Care",
    code: "GEN-MED",
    status: "active",
  });

  await Doctor.create({
    _id: doctorId,
    name: "Dr. Arvind Sharma",
    email: "arvind.sharma@apollo.test",
    specialization: "Internal Medicine",
  });

  await HospitalStaff.create({
    _id: nurseId,
    hospitalId,
    departmentIds: [departmentId],
    name: "Sister Mary Varghese",
    role: "NURSE",
    isActive: true,
  });

  await User.create([
    {
      _id: patient1Id,
      name: "Ramesh Kumar Patel",
      email: "ramesh.patel@test.org",
      phone: "9876543210",
    },
    {
      _id: patient2Id,
      name: "Sunita Verma",
      email: "sunita.verma@test.org",
      phone: "9876543211",
    },
  ]);
});

test("Task AG18: Inpatient Admission, Discharge, Transfers and Bed Management", async (t) => {
  if (!db) {
    t.skip("Local MongoDB replica set unavailable; skipping live integration tests");
    return;
  }
  await t.test("1. Setup Ward, Room, and Bed hierarchy with uniqueness constraints", async () => {
    // 1. Create Ward
    const wardA = await createWard({
      hospitalId,
      name: "Male Medical Ward",
      code: "WARD-M1",
      floor: "2",
      building: "Tower B",
      genderPolicy: "male",
      nurseStation: "NS-B2",
    });
    assert.equal(wardA.code, "WARD-M1");
    assert.equal(wardA.genderPolicy, "male");

    // Duplicate ward code rejected
    await assert.rejects(
      () => createWard({ hospitalId, name: "Another Ward", code: "WARD-M1" }),
      /already exists in this hospital/
    );

    // 2. Create Room
    const room101 = await createRoom({
      hospitalId,
      wardId: wardA._id,
      roomNumber: "101",
      roomType: "semi_private",
      dailyTariffMinor: 250000, // 2,500 INR
    });
    assert.equal(room101.roomNumber, "101");
    assert.equal(room101.dailyTariffMinor, 250000);

    // Duplicate room rejected
    await assert.rejects(
      () => createRoom({ hospitalId, wardId: wardA._id, roomNumber: "101" }),
      /already exists in this ward/
    );

    // 3. Create Beds
    const bedA1 = await createBed({
      hospitalId,
      wardId: wardA._id,
      roomId: room101._id,
      bedNumber: "BED-101-A",
    });
    assert.equal(bedA1.bedNumber, "BED-101-A");
    assert.equal(bedA1.status, "available");

    const bedA2 = await createBed({
      hospitalId,
      wardId: wardA._id,
      roomId: room101._id,
      bedNumber: "BED-101-B",
    });
    assert.equal(bedA2.bedNumber, "BED-101-B");

    // Duplicate bed rejected
    await assert.rejects(
      () => createBed({ hospitalId, wardId: wardA._id, roomId: room101._id, bedNumber: "BED-101-A" }),
      /already exists in this room/
    );

    // Verify querying
    const wards = await getWards({ hospitalId });
    assert.equal(wards.length, 1);
    const rooms = await getRooms({ hospitalId, wardId: wardA._id });
    assert.equal(rooms.length, 1);
    const beds = await getBeds({ hospitalId, roomId: room101._id });
    assert.equal(beds.length, 2);
  });

  await t.test("2. Bed state machine updates and transition rule enforcement", async () => {
    const ward = await createWard({ hospitalId, name: "Isolation Ward", code: "WARD-ISO" });
    const room = await createRoom({ hospitalId, wardId: ward._id, roomNumber: "ISO-1" });
    const bed = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "ISO-BED-1" });

    // Available -> Maintenance (valid)
    const mBed = await updateBedStatus({
      hospitalId,
      bedId: bed._id,
      targetStatus: "maintenance",
      reason: "Oxygen flowmeter calibration",
    });
    assert.equal(mBed.status, "maintenance");
    assert.equal(mBed.maintenanceNote, "Oxygen flowmeter calibration");

    // Maintenance -> Cleaning (valid)
    const cBed = await updateBedStatus({ hospitalId, bedId: bed._id, targetStatus: "cleaning" });
    assert.equal(cBed.status, "cleaning");

    // Cleaning -> Available (valid)
    const aBed = await updateBedStatus({ hospitalId, bedId: bed._id, targetStatus: "available" });
    assert.equal(aBed.status, "available");

    // Direct transition to occupied without admission is prohibited
    await assert.rejects(
      () => updateBedStatus({ hospitalId, bedId: bed._id, targetStatus: "occupied" }),
      /cannot be directly marked occupied without an inpatient admission/
    );
  });

  await t.test("3. Atomic Patient Admission claims bed and prevents concurrent double-admission", async () => {
    const ward = await createWard({ hospitalId, name: "ICU Ward", code: "WARD-ICU" });
    const room = await createRoom({ hospitalId, wardId: ward._id, roomNumber: "ICU-RM-1", roomType: "icu" });
    const bed = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "ICU-BED-1" });

    // Admit Patient 1
    const res1 = await admitPatient({
      hospitalId,
      patientId: patient1Id,
      admittingDoctorId: doctorId,
      departmentId,
      bedId: bed._id,
      admittingDiagnosis: "Acute Myocardial Infarction; STEMI anterior wall",
      isMlc: false,
      advanceDepositMinor: 5000000, // 50,000 INR
    });

    assert.equal(res1.success, true);
    assert.ok(res1.admission.admissionNumber.startsWith("IPD-"));
    assert.equal(res1.admission.status, "admitted");
    assert.equal(res1.admission.admittingDiagnosis, "Acute Myocardial Infarction; STEMI anterior wall");

    // Bed is now occupied
    const checkedBed = await Bed.findById(bed._id);
    assert.equal(checkedBed.status, "occupied");
    assert.equal(String(checkedBed.currentAdmissionId), String(res1.admission._id));
    assert.equal(String(checkedBed.currentPatientId), String(patient1Id));

    // Trying to admit Patient 2 to the SAME bed fails with 409 Conflict
    await assert.rejects(
      () =>
        admitPatient({
          hospitalId,
          patientId: patient2Id,
          admittingDoctorId: doctorId,
          departmentId,
          bedId: bed._id,
          admittingDiagnosis: "Severe Pneumonia",
        }),
      /already occupied, reserved, or under maintenance/
    );

    // Patient 1 cannot be concurrently admitted again to another bed
    const bed2 = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "ICU-BED-2" });
    await assert.rejects(
      () =>
        admitPatient({
          hospitalId,
          patientId: patient1Id,
          admittingDoctorId: doctorId,
          departmentId,
          bedId: bed2._id,
          admittingDiagnosis: "Concurrent admission attempt",
        }),
      /already has an active admission/
    );
  });

  await t.test("4. Concurrent race: Two concurrent admissions cannot allocate one bed", async () => {
    const ward = await createWard({ hospitalId, name: "Emergency Ward", code: "WARD-ED" });
    const room = await createRoom({ hospitalId, wardId: ward._id, roomNumber: "ED-BAY-1" });
    const singleBed = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "BAY-1-BED" });

    // Simultaneously fire two admissions competing for the exact same bed
    const results = await Promise.allSettled([
      admitPatient({
        hospitalId,
        patientId: patient1Id,
        admittingDoctorId: doctorId,
        departmentId,
        bedId: singleBed._id,
        admittingDiagnosis: "Candidate A",
      }),
      admitPatient({
        hospitalId,
        patientId: patient2Id,
        admittingDoctorId: doctorId,
        departmentId,
        bedId: singleBed._id,
        admittingDiagnosis: "Candidate B",
      }),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    // Exactly one winner, exactly one 409 conflict loser
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].reason.message, /already occupied, reserved, or under maintenance/);

    // Bed has exactly one occupant
    const finalBed = await Bed.findById(singleBed._id);
    assert.equal(finalBed.status, "occupied");
    assert.ok(
      String(finalBed.currentPatientId) === String(patient1Id) ||
        String(finalBed.currentPatientId) === String(patient2Id)
    );
  });

  await t.test("5. Bed Transfer preserves original assignment on failure and creates audit on success", async () => {
    const ward = await createWard({ hospitalId, name: "Step Down Ward", code: "WARD-SD" });
    const room = await createRoom({ hospitalId, wardId: ward._id, roomNumber: "SD-101" });
    const sourceBed = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "SD-BED-1" });
    const targetBed = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "SD-BED-2" });
    const busyBed = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "SD-BED-3" });

    // Admit Patient 1 into sourceBed
    const { admission: adm1 } = await admitPatient({
      hospitalId,
      patientId: patient1Id,
      admittingDoctorId: doctorId,
      departmentId,
      bedId: sourceBed._id,
      admittingDiagnosis: "Post-op Cholecystectomy recovery",
    });

    // Admit Patient 2 into busyBed
    await admitPatient({
      hospitalId,
      patientId: patient2Id,
      admittingDoctorId: doctorId,
      departmentId,
      bedId: busyBed._id,
      admittingDiagnosis: "Observation",
    });

    // Attempt transfer to already occupied busyBed -> Must fail and preserve sourceBed!
    await assert.rejects(
      () =>
        transferBed({
          hospitalId,
          admissionId: adm1._id,
          targetBedId: busyBed._id,
          transferReason: "Requested upgrade to occupied bed",
          actor: { staffId: nurseId, name: "Nurse Mary", role: "NURSE" },
        }),
      /Target bed is not available for transfer/
    );

    // Verify source bed assignment was completely preserved
    const intactSource = await Bed.findById(sourceBed._id);
    assert.equal(intactSource.status, "occupied");
    assert.equal(String(intactSource.currentAdmissionId), String(adm1._id));
    assert.equal(String(intactSource.currentPatientId), String(patient1Id));

    // Now execute legitimate transfer to targetBed
    const transferRes = await transferBed({
      hospitalId,
      admissionId: adm1._id,
      targetBedId: targetBed._id,
      transferReason: "Step-down from telemetry monitoring to standard bed",
      actor: { staffId: nurseId, name: "Nurse Mary", role: "NURSE" },
    });

    assert.equal(transferRes.success, true);
    assert.equal(transferRes.previousBedStatus, "cleaning");
    assert.equal(transferRes.targetBedStatus, "occupied");

    // Source bed is now in cleaning
    const updatedSource = await Bed.findById(sourceBed._id);
    assert.equal(updatedSource.status, "cleaning");
    assert.equal(updatedSource.currentAdmissionId, null);

    // Target bed is occupied by Patient 1
    const updatedTarget = await Bed.findById(targetBed._id);
    assert.equal(updatedTarget.status, "occupied");
    assert.equal(String(updatedTarget.currentAdmissionId), String(adm1._id));
    assert.equal(String(updatedTarget.currentPatientId), String(patient1Id));

    // Audit record created
    const transferAudit = await BedTransferRecord.findOne({ admissionId: adm1._id });
    assert.ok(transferAudit);
    assert.equal(String(transferAudit.fromBedId), String(sourceBed._id));
    assert.equal(String(transferAudit.toBedId), String(targetBed._id));
    assert.equal(transferAudit.transferReason, "Step-down from telemetry monitoring to standard bed");
    assert.equal(transferAudit.transferredBy.name, "Nurse Mary");
  });

  await t.test("6. Multi-department discharge clearance gate & finalization", async () => {
    const ward = await createWard({ hospitalId, name: "Surgical Ward", code: "WARD-SURG" });
    const room = await createRoom({ hospitalId, wardId: ward._id, roomNumber: "SURG-201" });
    const bed = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "SURG-BED-1" });

    const { admission } = await admitPatient({
      hospitalId,
      patientId: patient1Id,
      admittingDoctorId: doctorId,
      departmentId,
      bedId: bed._id,
      admittingDiagnosis: "Elective Hernia Repair",
    });

    // Attempting to finalize discharge without clearance fails
    await assert.rejects(
      () =>
        finalizeDischarge({
          hospitalId,
          admissionId: admission._id,
          dischargeSummary: { summaryText: "Recovered well" },
        }),
      /pending mandatory clearances \[medical, pharmacy, finance\]/
    );

    // 1. Record Medical Clearance
    const medClear = await recordDischargeClearance({
      hospitalId,
      admissionId: admission._id,
      clearanceType: "medical",
      actor: { name: "Dr. Arvind Sharma" },
    });
    assert.equal(medClear.isFullyCleared, false);

    // 2. Record Pharmacy Clearance
    const pharmClear = await recordDischargeClearance({
      hospitalId,
      admissionId: admission._id,
      clearanceType: "pharmacy",
      actor: { name: "Pharmacist Rajesh" },
    });
    assert.equal(pharmClear.isFullyCleared, false);

    // Still cannot discharge with pending finance
    await assert.rejects(
      () =>
        finalizeDischarge({
          hospitalId,
          admissionId: admission._id,
          dischargeSummary: { summaryText: "Recovered well" },
        }),
      /pending mandatory clearances \[finance\]/
    );

    // 3. Record Finance Clearance
    const finClear = await recordDischargeClearance({
      hospitalId,
      admissionId: admission._id,
      clearanceType: "finance",
      actor: { name: "Billing Officer Anita" },
    });
    assert.equal(finClear.isFullyCleared, true);

    // Finalize discharge successfully
    const finalRes = await finalizeDischarge({
      hospitalId,
      admissionId: admission._id,
      dischargeSummary: {
        summaryText: "Patient underwent uncomplicated open hernia repair. Sutures intact. Afebrile.",
        signedByDoctorId: doctorId,
        dischargeCondition: "cured",
        followUpPlan: "Review in OPD after 7 days for suture removal",
      },
      actor: { name: "Dr. Arvind Sharma" },
    });

    assert.equal(finalRes.success, true);
    assert.equal(finalRes.admission.status, "discharged");
    assert.ok(finalRes.admission.dischargeDate);
    assert.equal(finalRes.admission.dischargeSummary.dischargeCondition, "cured");

    // Bed released to cleaning per bed lifecycle
    const releasedBed = await Bed.findById(bed._id);
    assert.equal(releasedBed.status, "cleaning");
    assert.equal(releasedBed.currentAdmissionId, null);
  });

  await t.test("7. Inpatient timeline aggregates admission, transfer history, and location", async () => {
    const ward = await createWard({ hospitalId, name: "Cardiology Ward", code: "WARD-CARD" });
    const room = await createRoom({ hospitalId, wardId: ward._id, roomNumber: "CARD-101" });
    const bed1 = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "CARD-B1" });
    const bed2 = await createBed({ hospitalId, wardId: ward._id, roomId: room._id, bedNumber: "CARD-B2" });

    const { admission } = await admitPatient({
      hospitalId,
      patientId: patient1Id,
      admittingDoctorId: doctorId,
      departmentId,
      bedId: bed1._id,
      admittingDiagnosis: "Angina Pectoris",
    });

    await transferBed({
      hospitalId,
      admissionId: admission._id,
      targetBedId: bed2._id,
      transferReason: "Moved to window bed",
      actor: { name: "Sister Mary", role: "NURSE" },
    });

    const timeline = await getInpatientTimeline({
      hospitalId,
      admissionId: admission._id,
    });

    assert.equal(timeline.admission.admissionNumber, admission.admissionNumber);
    assert.equal(timeline.admission.patientId.name, "Ramesh Kumar Patel");
    assert.equal(timeline.transfers.length, 1);
    assert.equal(timeline.transfers[0].transferReason, "Moved to window bed");
    assert.equal(timeline.currentLocation.bed.bedNumber, "CARD-B2");
  });
});
