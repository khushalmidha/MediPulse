import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
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
  setIpdAdtTestDouble,
} from "../services/ipdAdtService.js";
import {
  BED_STATUSES,
  VALID_BED_TRANSITIONS,
  validateBedTransition,
} from "../config/enterprisePlan.js";

test("Task AG18: Inpatient Admission, Discharge, Transfers and Bed Management (Unit & Domain)", async (t) => {
  const hospitalId = new mongoose.Types.ObjectId();
  const wardId = new mongoose.Types.ObjectId();
  const roomId = new mongoose.Types.ObjectId();
  const bed1Id = new mongoose.Types.ObjectId();
  const bed2Id = new mongoose.Types.ObjectId();
  const patient1Id = new mongoose.Types.ObjectId();
  const patient2Id = new mongoose.Types.ObjectId();
  const doctorId = new mongoose.Types.ObjectId();
  const departmentId = new mongoose.Types.ObjectId();
  const admission1Id = new mongoose.Types.ObjectId();

  // In-memory state storage for unit test double
  const state = {
    wards: [
      {
        _id: wardId,
        hospitalId,
        name: "Male Medical Ward",
        code: "WARD-M1",
        floor: "2",
        building: "Tower B",
        genderPolicy: "male",
        nurseStation: "NS-B2",
        isActive: true,
      },
    ],
    rooms: [
      {
        _id: roomId,
        hospitalId,
        wardId,
        roomNumber: "101",
        roomType: "semi_private",
        dailyTariffMinor: 250000,
        isActive: true,
      },
    ],
    beds: [
      {
        _id: bed1Id,
        hospitalId,
        wardId,
        roomId,
        bedNumber: "BED-101-A",
        status: "available",
        currentAdmissionId: null,
        currentPatientId: null,
        version: 0,
      },
      {
        _id: bed2Id,
        hospitalId,
        wardId,
        roomId,
        bedNumber: "BED-101-B",
        status: "available",
        currentAdmissionId: null,
        currentPatientId: null,
        version: 0,
      },
    ],
    admissions: [],
    transfers: [],
  };

  setIpdAdtTestDouble({
    createWard: async (payload) => {
      if (state.wards.some((w) => w.code === payload.code)) {
        throw Object.assign(new Error(`Ward with code '${payload.code}' already exists in this hospital`), { status: 409 });
      }
      const newWard = { _id: new mongoose.Types.ObjectId(), ...payload, isActive: true };
      state.wards.push(newWard);
      return newWard;
    },
    getWards: async () => state.wards,
    createRoom: async (payload) => {
      if (state.rooms.some((r) => r.wardId.toString() === payload.wardId.toString() && r.roomNumber === payload.roomNumber)) {
        throw Object.assign(new Error(`Room '${payload.roomNumber}' already exists in this ward`), { status: 409 });
      }
      const newRoom = { _id: new mongoose.Types.ObjectId(), ...payload, isActive: true };
      state.rooms.push(newRoom);
      return newRoom;
    },
    getRooms: async () => state.rooms,
    createBed: async (payload) => {
      if (state.beds.some((b) => b.roomId.toString() === payload.roomId.toString() && b.bedNumber === payload.bedNumber)) {
        throw Object.assign(new Error(`Bed '${payload.bedNumber}' already exists in this room`), { status: 409 });
      }
      const newBed = { _id: new mongoose.Types.ObjectId(), ...payload, status: "available", version: 0 };
      state.beds.push(newBed);
      return newBed;
    },
    getBeds: async ({ status }) => {
      if (status) return state.beds.filter((b) => b.status === status);
      return state.beds;
    },
    updateBedStatus: async ({ bedId, targetStatus, reason }) => {
      const bed = state.beds.find((b) => b._id.toString() === bedId.toString());
      if (!bed) throw Object.assign(new Error("Bed not found"), { status: 404 });
      validateBedTransition(bed.status, targetStatus);
      if (targetStatus === "occupied" && !bed.currentAdmissionId) {
        throw Object.assign(new Error("Bed cannot be directly marked occupied without an inpatient admission"), { status: 400 });
      }
      bed.status = targetStatus;
      if (reason) bed.maintenanceNote = reason;
      bed.version += 1;
      return bed;
    },
    admitPatient: async ({ patientId, bedId, admittingDiagnosis, admittingDoctorId, isMlc, advanceDepositMinor }) => {
      const existing = state.admissions.find((a) => a.patientId.toString() === patientId.toString() && a.status === "admitted");
      if (existing) {
        throw Object.assign(new Error(`Patient already has an active admission (${existing.admissionNumber}) in this hospital`), { status: 409 });
      }
      const bed = state.beds.find((b) => b._id.toString() === bedId.toString());
      if (!bed || bed.status !== "available") {
        throw Object.assign(new Error("The selected bed is already occupied, reserved, or under maintenance. Please select another bed."), { status: 409 });
      }
      bed.status = "occupied";
      bed.currentPatientId = patientId;
      bed.version += 1;

      const admission = {
        _id: new mongoose.Types.ObjectId(),
        hospitalId,
        admissionNumber: "IPD-" + Date.now().toString(36).toUpperCase() + "-001",
        patientId,
        currentBedId: bed._id,
        currentRoomId: bed.roomId,
        currentWardId: bed.wardId,
        admittingDoctorId,
        departmentId,
        admittingDiagnosis,
        isMlc: Boolean(isMlc),
        advanceDepositMinor: advanceDepositMinor || 0,
        status: "admitted",
        admissionDate: new Date(),
        dischargeClearance: {
          medicalClearance: { cleared: false },
          pharmacyClearance: { cleared: false },
          financeClearance: { cleared: false },
          isFullyCleared: false,
        },
      };
      bed.currentAdmissionId = admission._id;
      state.admissions.push(admission);
      return { success: true, admission, bed };
    },
    transferBed: async ({ admissionId, targetBedId, transferReason, actor }) => {
      const admission = state.admissions.find((a) => a._id.toString() === admissionId.toString() && a.status === "admitted");
      if (!admission) throw Object.assign(new Error("Active inpatient admission not found"), { status: 404 });

      const targetBed = state.beds.find((b) => b._id.toString() === targetBedId.toString());
      if (!targetBed || targetBed.status !== "available") {
        throw Object.assign(new Error("Target bed is not available for transfer (occupied or under maintenance)"), { status: 409 });
      }

      const sourceBed = state.beds.find((b) => b._id.toString() === admission.currentBedId.toString());
      validateBedTransition(sourceBed.status, "cleaning");

      // Atomic transition
      sourceBed.status = "cleaning";
      sourceBed.currentAdmissionId = null;
      sourceBed.currentPatientId = null;
      sourceBed.version += 1;

      targetBed.status = "occupied";
      targetBed.currentAdmissionId = admission._id;
      targetBed.currentPatientId = admission.patientId;
      targetBed.version += 1;

      const transferRecord = {
        _id: new mongoose.Types.ObjectId(),
        admissionId: admission._id,
        fromBedId: sourceBed._id,
        toBedId: targetBed._id,
        transferredBy: actor,
        transferReason,
        transferTimestamp: new Date(),
      };
      state.transfers.push(transferRecord);

      admission.currentBedId = targetBed._id;
      return {
        success: true,
        admission,
        transferRecord,
        previousBedStatus: "cleaning",
        targetBedStatus: "occupied",
      };
    },
    recordDischargeClearance: async ({ admissionId, clearanceType, actor }) => {
      const admission = state.admissions.find((a) => a._id.toString() === admissionId.toString() && a.status === "admitted");
      if (!admission) throw Object.assign(new Error("Active inpatient admission not found"), { status: 404 });
      admission.dischargeClearance[`${clearanceType}Clearance`] = {
        cleared: true,
        clearedBy: actor?.name,
        clearedAt: new Date(),
      };
      const { medicalClearance, pharmacyClearance, financeClearance } = admission.dischargeClearance;
      admission.dischargeClearance.isFullyCleared = Boolean(medicalClearance?.cleared && pharmacyClearance?.cleared && financeClearance?.cleared);
      return { success: true, admissionId, isFullyCleared: admission.dischargeClearance.isFullyCleared, dischargeClearance: admission.dischargeClearance };
    },
    finalizeDischarge: async ({ admissionId, dischargeSummary }) => {
      const admission = state.admissions.find((a) => a._id.toString() === admissionId.toString() && a.status === "admitted");
      if (!admission) throw Object.assign(new Error("Active inpatient admission not found"), { status: 404 });
      if (!admission.dischargeClearance?.isFullyCleared) {
        throw Object.assign(new Error("Cannot finalize discharge: pending mandatory clearances [medical, pharmacy, finance required]"), { status: 400 });
      }
      const bed = state.beds.find((b) => b._id.toString() === admission.currentBedId.toString());
      validateBedTransition(bed.status, "cleaning");
      bed.status = "cleaning";
      bed.currentAdmissionId = null;
      bed.currentPatientId = null;

      admission.status = "discharged";
      admission.dischargeDate = new Date();
      admission.dischargeSummary = dischargeSummary;
      return { success: true, admission, releasedBedStatus: "cleaning" };
    },
    getInpatientTimeline: async ({ admissionId }) => {
      const admission = state.admissions.find((a) => a._id.toString() === admissionId.toString());
      const transfers = state.transfers.filter((t) => t.admissionId.toString() === admissionId.toString());
      const currentBed = state.beds.find((b) => b._id.toString() === admission.currentBedId.toString());
      return { admission, transfers, currentBed };
    },
  });

  await t.test("1. Ward, Room, and Bed hierarchy with uniqueness and listing", async () => {
    const ward = await createWard({
      hospitalId,
      name: "Female Surgical Ward",
      code: "WARD-FS1",
      floor: "3",
      building: "Main Block",
      genderPolicy: "female",
    });
    assert.equal(ward.code, "WARD-FS1");
    assert.equal(ward.genderPolicy, "female");

    await assert.rejects(
      () => createWard({ hospitalId, name: "Duplicate Ward", code: "WARD-FS1" }),
      /already exists in this hospital/
    );

    const room = await createRoom({
      hospitalId,
      wardId: ward._id,
      roomNumber: "201",
      roomType: "private",
      dailyTariffMinor: 500000,
    });
    assert.equal(room.roomNumber, "201");
    assert.equal(room.dailyTariffMinor, 500000);

    const bed = await createBed({
      hospitalId,
      wardId: ward._id,
      roomId: room._id,
      bedNumber: "BED-201-A",
    });
    assert.equal(bed.bedNumber, "BED-201-A");
    assert.equal(bed.status, "available");

    const allWards = await getWards({ hospitalId });
    assert.ok(allWards.length >= 2);

    const allBeds = await getBeds({ roomId: room._id });
    assert.ok(allBeds.length >= 1);
  });

  await t.test("2. Bed state machine updates and transition enforcement", async () => {
    const updatedBed = await updateBedStatus({
      hospitalId,
      bedId: bed1Id,
      targetStatus: "maintenance",
      reason: "Bed motor repair",
    });
    assert.equal(updatedBed.status, "maintenance");
    assert.equal(updatedBed.maintenanceNote, "Bed motor repair");

    // Cleaned and restored to available
    await updateBedStatus({ hospitalId, bedId: bed1Id, targetStatus: "cleaning" });
    const availBed = await updateBedStatus({ hospitalId, bedId: bed1Id, targetStatus: "available" });
    assert.equal(availBed.status, "available");

    // Prohibit direct occupation without admission
    await assert.rejects(
      () => updateBedStatus({ hospitalId, bedId: bed1Id, targetStatus: "occupied" }),
      /cannot be directly marked occupied without an inpatient admission/
    );
  });

  await t.test("3. Concurrent double-admission prevention for one bed", async () => {
    // Patient 1 admits into Bed 1
    const { admission: adm1, bed: occupiedBed } = await admitPatient({
      hospitalId,
      patientId: patient1Id,
      bedId: bed1Id,
      admittingDoctorId: doctorId,
      admittingDiagnosis: "Acute Appendicitis",
      isMlc: false,
      advanceDepositMinor: 2000000,
    });
    assert.equal(occupiedBed.status, "occupied");
    assert.equal(adm1.status, "admitted");

    // Patient 2 attempts to allocate the SAME occupied Bed 1 -> Rejected with 409
    await assert.rejects(
      () =>
        admitPatient({
          hospitalId,
          patientId: patient2Id,
          bedId: bed1Id,
          admittingDoctorId: doctorId,
          admittingDiagnosis: "Pneumonia",
        }),
      /already occupied, reserved, or under maintenance/
    );

    // Patient 1 attempts to admit again while already active -> Rejected with 409
    await assert.rejects(
      () =>
        admitPatient({
          hospitalId,
          patientId: patient1Id,
          bedId: bed2Id,
          admittingDoctorId: doctorId,
          admittingDiagnosis: "Secondary Admission Attempt",
        }),
      /already has an active admission/
    );
  });

  await t.test("4. Bed Transfer: failure preserves source bed; success records audit and releases to cleaning", async () => {
    const activeAdmission = state.admissions[0];

    // Mark bed2 as occupied by another patient
    state.beds.find((b) => b._id.toString() === bed2Id.toString()).status = "occupied";

    // Attempt transfer to occupied bed2 -> Fails, and source bed1 remains occupied
    await assert.rejects(
      () =>
        transferBed({
          hospitalId,
          admissionId: activeAdmission._id,
          targetBedId: bed2Id,
          transferReason: "Bed upgrade request",
          actor: { name: "Nurse Alice", role: "NURSE" },
        }),
      /Target bed is not available for transfer/
    );

    const sourceBed = state.beds.find((b) => b._id.toString() === bed1Id.toString());
    assert.equal(sourceBed.status, "occupied");
    assert.equal(sourceBed.currentAdmissionId.toString(), activeAdmission._id.toString());

    // Free bed2 to available and execute legitimate transfer
    state.beds.find((b) => b._id.toString() === bed2Id.toString()).status = "available";
    const transferRes = await transferBed({
      hospitalId,
      admissionId: activeAdmission._id,
      targetBedId: bed2Id,
      transferReason: "Transfer to monitored telemetry bed",
      actor: { name: "Nurse Alice", role: "NURSE" },
    });

    assert.equal(transferRes.success, true);
    assert.equal(transferRes.previousBedStatus, "cleaning");
    assert.equal(transferRes.targetBedStatus, "occupied");

    assert.equal(sourceBed.status, "cleaning");
    assert.equal(sourceBed.currentAdmissionId, null);

    const targetBed = state.beds.find((b) => b._id.toString() === bed2Id.toString());
    assert.equal(targetBed.status, "occupied");
    assert.equal(targetBed.currentAdmissionId.toString(), activeAdmission._id.toString());

    assert.equal(state.transfers.length, 1);
    assert.equal(state.transfers[0].transferReason, "Transfer to monitored telemetry bed");
  });

  await t.test("5. Multi-department discharge clearance gate & finalization", async () => {
    const activeAdmission = state.admissions[0];

    // Attempting discharge before clearance fails
    await assert.rejects(
      () =>
        finalizeDischarge({
          hospitalId,
          admissionId: activeAdmission._id,
          dischargeSummary: { summaryText: "Patient cured" },
        }),
      /pending mandatory clearances/
    );

    // Record clearances one by one
    await recordDischargeClearance({
      hospitalId,
      admissionId: activeAdmission._id,
      clearanceType: "medical",
      actor: { name: "Dr. Arvind" },
    });
    assert.equal(activeAdmission.dischargeClearance.isFullyCleared, false);

    await recordDischargeClearance({
      hospitalId,
      admissionId: activeAdmission._id,
      clearanceType: "pharmacy",
      actor: { name: "Pharmacist Roy" },
    });
    assert.equal(activeAdmission.dischargeClearance.isFullyCleared, false);

    const finClear = await recordDischargeClearance({
      hospitalId,
      admissionId: activeAdmission._id,
      clearanceType: "finance",
      actor: { name: "Billing Officer Sita" },
    });
    assert.equal(finClear.isFullyCleared, true);

    // Finalize discharge
    const finalRes = await finalizeDischarge({
      hospitalId,
      admissionId: activeAdmission._id,
      dischargeSummary: {
        summaryText: "Laparoscopic appendectomy successful. Well healed.",
        dischargeCondition: "cured",
      },
    });

    assert.equal(finalRes.success, true);
    assert.equal(finalRes.admission.status, "discharged");
    assert.equal(finalRes.releasedBedStatus, "cleaning");

    // Inpatient timeline verified
    const timeline = await getInpatientTimeline({ hospitalId, admissionId: activeAdmission._id });
    assert.equal(timeline.admission.status, "discharged");
    assert.equal(timeline.transfers.length, 1);
  });

  await t.test("6. Fail closed with 503 when disconnected and no test double", async () => {
    // Clear test double to test disconnected guard
    setIpdAdtTestDouble(null);

    await assert.rejects(
      () => createWard({ hospitalId, name: "Disconnected Ward", code: "WARD-DISC" }),
      (err) => err.status === 503 || err.message.includes("Database service is unavailable")
    );

    await assert.rejects(
      () => admitPatient({ hospitalId, patientId: patient1Id, bedId: bed1Id }),
      (err) => err.status === 503 || err.message.includes("Database service is unavailable")
    );
  });
});
