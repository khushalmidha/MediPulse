import mongoose from "mongoose";
import crypto from "crypto";
import { Ward, Room, Bed, IpdAdmission, BedTransferRecord } from "../model/inpatient.js";
import Hospital from "../model/hospital.js";
import User from "../model/user.js";
import { accessError } from "./hospitalAccess.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { validateBedTransition } from "../config/enterprisePlan.js";
import { assertTenantNotSuspended, checkFeatureEntitlement } from "./saasOperationsService.js";

let testDouble = null;
export const setIpdAdtTestDouble = (double) => {
  testDouble = double;
};

const assertDbConnected = () => {
  if (!testDouble && mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }
};

/**
 * 1. Ward Administration
 */
export const createWard = async ({
  hospitalId,
  name,
  code,
  floor = "1",
  building = "Main",
  genderPolicy = "all",
  nurseStation = "",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.createWard) {
    return testDouble.createWard({ hospitalId, name, code, floor, building, genderPolicy, nurseStation, actor });
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);
  checkFeatureEntitlement(hospital, "ipd_beds");

  const cleanCode = String(code || "").trim().toUpperCase();
  if (!cleanCode) throw accessError(400, "Ward code is required");
  if (!name || !String(name).trim()) throw accessError(400, "Ward name is required");

  const existing = await Ward.findOne({ hospitalId, code: cleanCode });
  if (existing) throw accessError(409, `Ward with code '${cleanCode}' already exists in this hospital`);

  const ward = await Ward.create({
    hospitalId,
    name: String(name).trim(),
    code: cleanCode,
    floor: String(floor).trim(),
    building: String(building).trim(),
    genderPolicy,
    nurseStation: String(nurseStation).trim(),
  });

  return ward;
};

export const getWards = async ({ hospitalId, activeOnly = true }) => {
  assertDbConnected();
  if (testDouble?.getWards) return testDouble.getWards({ hospitalId, activeOnly });

  const filter = { hospitalId };
  if (activeOnly) filter.isActive = true;
  return await Ward.find(filter).sort({ code: 1 }).lean();
};

/**
 * 2. Room Administration
 */
export const createRoom = async ({
  hospitalId,
  wardId,
  roomNumber,
  roomType = "general",
  dailyTariffMinor = 0,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.createRoom) {
    return testDouble.createRoom({ hospitalId, wardId, roomNumber, roomType, dailyTariffMinor, actor });
  }

  const ward = await Ward.findOne({ _id: wardId, hospitalId });
  if (!ward) throw accessError(404, "Ward not found in this hospital");

  const cleanNumber = String(roomNumber || "").trim();
  if (!cleanNumber) throw accessError(400, "Room number is required");

  const existing = await Room.findOne({ hospitalId, wardId, roomNumber: cleanNumber });
  if (existing) throw accessError(409, `Room '${cleanNumber}' already exists in this ward`);

  const room = await Room.create({
    hospitalId,
    wardId,
    roomNumber: cleanNumber,
    roomType,
    dailyTariffMinor: Math.max(0, Number(dailyTariffMinor) || 0),
  });

  return room;
};

export const getRooms = async ({ hospitalId, wardId }) => {
  assertDbConnected();
  if (testDouble?.getRooms) return testDouble.getRooms({ hospitalId, wardId });

  const filter = { hospitalId };
  if (wardId) filter.wardId = wardId;
  return await Room.find(filter).sort({ roomNumber: 1 }).lean();
};

/**
 * 3. Bed Administration & State Machine
 */
export const createBed = async ({
  hospitalId,
  wardId,
  roomId,
  bedNumber,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.createBed) {
    return testDouble.createBed({ hospitalId, wardId, roomId, bedNumber, actor });
  }

  const room = await Room.findOne({ _id: roomId, wardId, hospitalId });
  if (!room) throw accessError(404, "Room not found in this ward/hospital");

  const cleanBedNumber = String(bedNumber || "").trim();
  if (!cleanBedNumber) throw accessError(400, "Bed number is required");

  const existing = await Bed.findOne({ hospitalId, roomId, bedNumber: cleanBedNumber });
  if (existing) throw accessError(409, `Bed '${cleanBedNumber}' already exists in this room`);

  const bed = await Bed.create({
    hospitalId,
    wardId,
    roomId,
    bedNumber: cleanBedNumber,
    status: "available",
  });

  return bed;
};

export const getBeds = async ({ hospitalId, wardId, roomId, status }) => {
  assertDbConnected();
  if (testDouble?.getBeds) return testDouble.getBeds({ hospitalId, wardId, roomId, status });

  const filter = { hospitalId };
  if (wardId) filter.wardId = wardId;
  if (roomId) filter.roomId = roomId;
  if (status) filter.status = status;
  return await Bed.find(filter).sort({ bedNumber: 1 }).lean();
};

export const updateBedStatus = async ({
  hospitalId,
  bedId,
  targetStatus,
  reason = "",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.updateBedStatus) {
    return testDouble.updateBedStatus({ hospitalId, bedId, targetStatus, reason, actor });
  }

  const bed = await Bed.findOne({ _id: bedId, hospitalId });
  if (!bed) throw accessError(404, "Bed not found");

  // Validate state machine rule
  validateBedTransition(bed.status, targetStatus);

  // Administrative update cannot occupy a bed without an admission!
  if (targetStatus === "occupied" && !bed.currentAdmissionId) {
    throw accessError(400, "Bed cannot be directly marked occupied without an inpatient admission workflow");
  }

  bed.status = targetStatus;
  if (reason) bed.maintenanceNote = String(reason).trim();
  bed.version = (bed.version || 0) + 1;
  await bed.save();

  return bed;
};

/**
 * 4. Atomic Patient Inpatient Admission
 */
export const admitPatient = async ({
  hospitalId,
  patientId,
  familyMemberId = null,
  encounterJourneyId = null,
  admittingDoctorId,
  attendingDoctorId = null,
  primaryNurseId = null,
  departmentId,
  bedId,
  admittingDiagnosis,
  isMlc = false,
  advanceDepositMinor = 0,
  estimatedLengthOfStayDays = 3,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.admitPatient) {
    return testDouble.admitPatient({
      hospitalId,
      patientId,
      familyMemberId,
      encounterJourneyId,
      admittingDoctorId,
      attendingDoctorId,
      primaryNurseId,
      departmentId,
      bedId,
      admittingDiagnosis,
      isMlc,
      advanceDepositMinor,
      estimatedLengthOfStayDays,
      actor,
    });
  }

  if (!patientId) throw accessError(400, "Patient ID is required");
  if (!admittingDoctorId) throw accessError(400, "Admitting doctor ID is required");
  if (!departmentId) throw accessError(400, "Department ID is required");
  if (!bedId) throw accessError(400, "Bed ID is required");
  if (!admittingDiagnosis || !String(admittingDiagnosis).trim()) {
    throw accessError(400, "Admitting diagnosis is required");
  }

  return await moneyTransaction(async (session) => {
    const hospital = await Hospital.findById(hospitalId).session(session);
    if (!hospital) throw accessError(404, "Hospital not found");
    assertTenantNotSuspended(hospital);
    checkFeatureEntitlement(hospital, "ipd_beds");

    // Prevent concurrent active admissions for the same patient in this hospital
    const existingActive = await IpdAdmission.findOne({
      hospitalId,
      patientId,
      status: "admitted",
    }).session(session);
    if (existingActive) {
      throw accessError(
        409,
        `Patient already has an active admission (${existingActive.admissionNumber}) in this hospital`
      );
    }

    // Atomically claim the bed: MUST be currently 'available'
    const claimedBed = await Bed.findOneAndUpdate(
      { _id: bedId, hospitalId, status: "available" },
      {
        $set: {
          status: "occupied",
          currentPatientId: patientId,
        },
        $inc: { version: 1 },
      },
      { session, new: true }
    );

    if (!claimedBed) {
      throw accessError(
        409,
        "The selected bed is already occupied, reserved, or under maintenance. Please select another bed."
      );
    }

    const admissionNumber =
      "IPD-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      crypto.randomBytes(3).toString("hex").toUpperCase();

    const [admission] = await IpdAdmission.create(
      [
        {
          hospitalId,
          admissionNumber,
          patientId,
          familyMemberId,
          encounterJourneyId,
          admittingDoctorId,
          attendingDoctorId: attendingDoctorId || admittingDoctorId,
          primaryNurseId,
          departmentId,
          currentWardId: claimedBed.wardId,
          currentRoomId: claimedBed.roomId,
          currentBedId: claimedBed._id,
          admittingDiagnosis: String(admittingDiagnosis).trim(),
          isMlc: Boolean(isMlc),
          advanceDepositMinor: Math.max(0, Number(advanceDepositMinor) || 0),
          estimatedLengthOfStayDays: Math.max(1, Number(estimatedLengthOfStayDays) || 3),
          status: "admitted",
          admissionDate: new Date(),
        },
      ],
      { session }
    );

    claimedBed.currentAdmissionId = admission._id;
    await claimedBed.save({ session });

    return {
      success: true,
      admission,
      bed: claimedBed,
    };
  });
};

/**
 * 5. Atomic Bed Transfer with State Invariants and Safe Fallback
 */
export const transferBed = async ({
  hospitalId,
  admissionId,
  targetBedId,
  transferReason,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.transferBed) {
    return testDouble.transferBed({ hospitalId, admissionId, targetBedId, transferReason, actor });
  }

  if (!admissionId) throw accessError(400, "Admission ID is required");
  if (!targetBedId) throw accessError(400, "Target bed ID is required");
  if (!transferReason || !String(transferReason).trim()) {
    throw accessError(400, "Reason for bed transfer is required");
  }

  return await moneyTransaction(async (session) => {
    const admission = await IpdAdmission.findOne({
      _id: admissionId,
      hospitalId,
      status: "admitted",
    }).session(session);

    if (!admission) throw accessError(404, "Active inpatient admission not found");

    if (String(admission.currentBedId) === String(targetBedId)) {
      throw accessError(400, "Patient is already assigned to this bed");
    }

    // Atomically claim target bed (must be 'available')
    const targetBed = await Bed.findOneAndUpdate(
      { _id: targetBedId, hospitalId, status: "available" },
      {
        $set: {
          status: "occupied",
          currentAdmissionId: admission._id,
          currentPatientId: admission.patientId,
        },
        $inc: { version: 1 },
      },
      { session, new: true }
    );

    if (!targetBed) {
      // If target bed is occupied/unavailable, the source bed is completely untouched!
      throw accessError(409, "Target bed is not available for transfer (occupied or under maintenance)");
    }

    const previousBedId = admission.currentBedId;
    const previousRoomId = admission.currentRoomId;
    const previousWardId = admission.currentWardId;

    // Transition source bed from occupied -> cleaning per bed lifecycle
    validateBedTransition("occupied", "cleaning");
    await Bed.updateOne(
      { _id: previousBedId, hospitalId },
      {
        $set: {
          status: "cleaning",
          currentAdmissionId: null,
          currentPatientId: null,
          maintenanceNote: `Transferred to ${targetBed.bedNumber} (${transferReason})`,
        },
        $inc: { version: 1 },
      },
      { session }
    );

    // Create durable audit transfer record
    const [transferRecord] = await BedTransferRecord.create(
      [
        {
          hospitalId,
          admissionId: admission._id,
          fromBedId: previousBedId,
          toBedId: targetBed._id,
          fromRoomId: previousRoomId,
          toRoomId: targetBed.roomId,
          fromWardId: previousWardId,
          toWardId: targetBed.wardId,
          transferredBy: {
            staffId: actor?.staffId || null,
            name: actor?.name || "Staff",
            role: actor?.role || "NURSE",
          },
          transferReason: String(transferReason).trim(),
          transferTimestamp: new Date(),
        },
      ],
      { session }
    );

    // Update active admission with new location
    admission.currentBedId = targetBed._id;
    admission.currentRoomId = targetBed.roomId;
    admission.currentWardId = targetBed.wardId;
    await admission.save({ session });

    return {
      success: true,
      admission,
      transferRecord,
      previousBedStatus: "cleaning",
      targetBedStatus: "occupied",
    };
  });
};

/**
 * 6. Multi-Department Discharge Clearance Gate
 */
export const recordDischargeClearance = async ({
  hospitalId,
  admissionId,
  clearanceType, // 'medical' | 'pharmacy' | 'finance'
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.recordDischargeClearance) {
    return testDouble.recordDischargeClearance({ hospitalId, admissionId, clearanceType, actor });
  }

  const validTypes = ["medical", "pharmacy", "finance"];
  if (!validTypes.includes(clearanceType)) {
    throw accessError(400, `Invalid clearance type: ${clearanceType}. Allowed: ${validTypes.join(", ")}`);
  }

  const admission = await IpdAdmission.findOne({ _id: admissionId, hospitalId, status: "admitted" });
  if (!admission) throw accessError(404, "Active inpatient admission not found");

  const clearanceKey = `${clearanceType}Clearance`;
  admission.dischargeClearance[clearanceKey] = {
    cleared: true,
    clearedBy: actor?.name || `${clearanceType.toUpperCase()} Staff`,
    clearedAt: new Date(),
  };

  const { medicalClearance, pharmacyClearance, financeClearance } = admission.dischargeClearance;
  admission.dischargeClearance.isFullyCleared = Boolean(
    medicalClearance?.cleared && pharmacyClearance?.cleared && financeClearance?.cleared
  );

  await admission.save();

  return {
    success: true,
    admissionId: admission._id,
    clearanceType,
    isFullyCleared: admission.dischargeClearance.isFullyCleared,
    dischargeClearance: admission.dischargeClearance,
  };
};

/**
 * 7. Discharge Finalization with Gate Enforcement
 */
export const finalizeDischarge = async ({
  hospitalId,
  admissionId,
  dischargeSummary = {},
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.finalizeDischarge) {
    return testDouble.finalizeDischarge({ hospitalId, admissionId, dischargeSummary, actor });
  }

  return await moneyTransaction(async (session) => {
    const admission = await IpdAdmission.findOne({
      _id: admissionId,
      hospitalId,
      status: "admitted",
    }).session(session);

    if (!admission) throw accessError(404, "Active inpatient admission not found");

    // Discharge clearance gate: must have medical, pharmacy, and finance clearances!
    if (!admission.dischargeClearance?.isFullyCleared) {
      const pending = [];
      if (!admission.dischargeClearance?.medicalClearance?.cleared) pending.push("medical");
      if (!admission.dischargeClearance?.pharmacyClearance?.cleared) pending.push("pharmacy");
      if (!admission.dischargeClearance?.financeClearance?.cleared) pending.push("finance");
      throw accessError(
        400,
        `Cannot finalize discharge: pending mandatory clearances [${pending.join(", ")}]. All 3 departments must sign off.`
      );
    }

    if (!dischargeSummary.summaryText || !String(dischargeSummary.summaryText).trim()) {
      throw accessError(400, "Discharge clinical summary is required before discharge finalization");
    }

    // Release bed to cleaning per bed state machine
    validateBedTransition("occupied", "cleaning");
    await Bed.updateOne(
      { _id: admission.currentBedId, hospitalId },
      {
        $set: {
          status: "cleaning",
          currentAdmissionId: null,
          currentPatientId: null,
          maintenanceNote: `Discharged ${admission.admissionNumber}`,
        },
        $inc: { version: 1 },
      },
      { session }
    );

    admission.status = "discharged";
    admission.dischargeDate = new Date();
    admission.dischargeSummary = {
      summaryText: String(dischargeSummary.summaryText).trim(),
      signedByDoctorId: dischargeSummary.signedByDoctorId || admission.admittingDoctorId,
      signedAt: new Date(),
      dischargeCondition: dischargeSummary.dischargeCondition || "improved",
      followUpPlan: String(dischargeSummary.followUpPlan || "").trim(),
    };

    await admission.save({ session });

    return {
      success: true,
      admission,
      releasedBedStatus: "cleaning",
    };
  });
};

/**
 * 8. Comprehensive Inpatient Timeline & Bed Audit
 */
export const getInpatientTimeline = async ({ hospitalId, admissionId }) => {
  assertDbConnected();
  if (testDouble?.getInpatientTimeline) {
    return testDouble.getInpatientTimeline({ hospitalId, admissionId });
  }

  const [admission, transfers] = await Promise.all([
    IpdAdmission.findOne({ _id: admissionId, hospitalId })
      .populate("patientId", "name email phone")
      .populate("admittingDoctorId", "name email specialization")
      .populate("departmentId", "name code")
      .populate("currentWardId", "name code floor building")
      .populate("currentRoomId", "roomNumber roomType dailyTariffMinor")
      .populate("currentBedId", "bedNumber status")
      .lean(),
    BedTransferRecord.find({ hospitalId, admissionId })
      .populate("fromBedId", "bedNumber")
      .populate("toBedId", "bedNumber")
      .populate("fromRoomId", "roomNumber roomType")
      .populate("toRoomId", "roomNumber roomType")
      .populate("fromWardId", "name code")
      .populate("toWardId", "name code")
      .sort({ transferTimestamp: 1 })
      .lean(),
  ]);

  if (!admission) throw accessError(404, "Inpatient admission record not found");

  return {
    admission,
    transfers,
    currentLocation: {
      ward: admission.currentWardId,
      room: admission.currentRoomId,
      bed: admission.currentBedId,
    },
    clearanceStatus: admission.dischargeClearance,
  };
};

export default {
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
};
