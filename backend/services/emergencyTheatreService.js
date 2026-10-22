import { assertEnterprisePilot } from "./enterprisePilot.js";
import mongoose from "mongoose";
import crypto from "crypto";
import {
  EmergencyRegistration,
  TheatreRoom,
  OtSchedule,
} from "../model/emergencyTheatre.js";
import Hospital from "../model/hospital.js";
import "../model/inpatient.js";
import "../model/user.js";
import "../model/doctor.js";
import "../model/hospitalStaff.js";
import { accessError } from "./hospitalAccess.js";
import { moneyTransaction } from "./moneyTransaction.js";
import {
  EMERGENCY_TRIAGE_LEVELS,
  WHO_SURGICAL_SAFETY_STAGES,
} from "../config/enterprisePlan.js";
import { assertTenantNotSuspended, checkFeatureEntitlement } from "./saasOperationsService.js";

let testDouble = null;
export const setEmergencyTheatreTestDouble = (double) => {
  if (process.env.NODE_ENV !== "test") throw new Error("Enterprise test adapters are only available in tests");
  testDouble = double;
};

const assertDbConnected = () => {
  assertEnterprisePilot();
  if (!testDouble && mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }
};

/**
 * 1. Emergency Department Registration & 5-Level Triage
 */
export const registerEmergencyPatient = async ({
  hospitalId,
  patientId = null,
  patientName,
  age = null,
  gender = "unknown",
  arrivalMode = "walk_in",
  triageLevel,
  chiefComplaint,
  assignedBay = "",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.registerEmergencyPatient) {
    return testDouble.registerEmergencyPatient({
      hospitalId,
      patientId,
      patientName,
      age,
      gender,
      arrivalMode,
      triageLevel,
      chiefComplaint,
      assignedBay,
      actor,
    });
  }

  if (!patientName || !String(patientName).trim()) {
    throw accessError(400, "Patient identification or temporary trauma moniker is required");
  }
  if (!triageLevel || !EMERGENCY_TRIAGE_LEVELS[triageLevel]) {
    throw accessError(400, "Valid 5-level emergency triage level (1 to 5) is required");
  }
  if (!chiefComplaint || !String(chiefComplaint).trim()) {
    throw accessError(400, "Chief emergency complaint is required");
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);
  checkFeatureEntitlement(hospital, "emergency_theatre");

  const triageConfig = EMERGENCY_TRIAGE_LEVELS[triageLevel];
  const emergencyNumber =
    "ER-" +
    Date.now().toString(36).toUpperCase() +
    "-" +
    crypto.randomBytes(3).toString("hex").toUpperCase();

  const registration = await EmergencyRegistration.create({
    hospitalId,
    emergencyNumber,
    patientId,
    patientName: String(patientName).trim(),
    age: age ? Number(age) : null,
    gender,
    arrivalMode,
    triageLevel: Number(triageLevel),
    triageCategory: triageConfig.code,
    chiefComplaint: String(chiefComplaint).trim(),
    assignedBay: String(assignedBay).trim() || (triageLevel === 1 ? "RESUSCITATION-BAY-1" : "ACUTE-BAY-1"),
    attendingDoctorId: actor?.doctorId || null,
    triagedByStaffId: actor?.staffId || null,
    status: "triaged",
  });

  return {
    success: true,
    registration,
    triageInfo: {
      level: triageLevel,
      category: triageConfig.code,
      name: triageConfig.name,
      maxWaitMinutes: triageConfig.maxWaitMinutes,
      requiresImmediateResuscitation: triageLevel === 1,
    },
  };
};

/**
 * 2. Theatre Room Management
 */
export const createTheatreRoom = async ({
  hospitalId,
  theatreCode,
  theatreName,
  theatreType = "major",
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.createTheatreRoom) {
    return testDouble.createTheatreRoom({ hospitalId, theatreCode, theatreName, theatreType, actor });
  }

  const cleanCode = String(theatreCode || "").trim().toUpperCase();
  if (!cleanCode) throw accessError(400, "Theatre code is required");
  if (!theatreName || !String(theatreName).trim()) {
    throw accessError(400, "Theatre name is required");
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);
  checkFeatureEntitlement(hospital, "emergency_theatre");

  const existing = await TheatreRoom.findOne({ hospitalId, theatreCode: cleanCode });
  if (existing) {
    throw accessError(409, `Theatre with code '${cleanCode}' already exists in this hospital`);
  }

  const room = await TheatreRoom.create({
    hospitalId,
    theatreCode: cleanCode,
    theatreName: String(theatreName).trim(),
    theatreType,
  });

  return room;
};

export const getTheatreRooms = async ({ hospitalId }) => {
  assertDbConnected();
  if (testDouble?.getTheatreRooms) return testDouble.getTheatreRooms({ hospitalId });

  return await TheatreRoom.find({ hospitalId, isActive: true }).sort({ theatreCode: 1 }).lean();
};

/**
 * 3. Atomic Operation Theatre Scheduling with Triple-Conflict Checking
 */
export const bookTheatreCase = async ({
  hospitalId,
  theatreRoomId,
  patientId,
  admissionId = null,
  emergencyRegistrationId = null,
  leadSurgeonDoctorId,
  anesthetistDoctorId,
  scrubNurseStaffId = null,
  procedureName,
  urgency = "elective",
  scheduledStartTime,
  scheduledEndTime,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.bookTheatreCase) {
    return testDouble.bookTheatreCase({
      hospitalId,
      theatreRoomId,
      patientId,
      admissionId,
      emergencyRegistrationId,
      leadSurgeonDoctorId,
      anesthetistDoctorId,
      scrubNurseStaffId,
      procedureName,
      urgency,
      scheduledStartTime,
      scheduledEndTime,
      actor,
    });
  }

  const startTime = new Date(scheduledStartTime);
  const endTime = new Date(scheduledEndTime);
  if (isNaN(startTime.getTime()) || isNaN(endTime.getTime()) || startTime >= endTime) {
    throw accessError(400, "Valid scheduledStartTime and scheduledEndTime (start < end) are required");
  }
  if (!procedureName || !String(procedureName).trim()) {
    throw accessError(400, "Procedure name is required");
  }
  if (!theatreRoomId) throw accessError(400, "Theatre room ID is required");
  if (!leadSurgeonDoctorId) throw accessError(400, "Lead surgeon doctor ID is required");
  if (!anesthetistDoctorId) throw accessError(400, "Anesthetist doctor ID is required");

  return await moneyTransaction(async (session) => {
    const hospital = await Hospital.findById(hospitalId).session(session);
    if (!hospital) throw accessError(404, "Hospital not found");
    assertTenantNotSuspended(hospital);
    checkFeatureEntitlement(hospital, "emergency_theatre");

    const theatre = await TheatreRoom.findOne({ _id: theatreRoomId, hospitalId, isActive: true }).session(session);
    if (!theatre) throw accessError(404, "Active theatre room not found in this hospital");

    const activeFilter = {
      hospitalId,
      status: { $in: ["scheduled", "in_progress"] },
      scheduledStartTime: { $lt: endTime },
      scheduledEndTime: { $gt: startTime },
    };

    // 1. Conflict Check: Theatre Room overlap
    const roomConflict = await OtSchedule.findOne({
      ...activeFilter,
      theatreRoomId,
    }).session(session);
    if (roomConflict) {
      throw accessError(
        409,
        `Theatre room ${theatre.theatreCode} is already booked for an overlapping surgery (${roomConflict.bookingNumber}) during this window`
      );
    }

    // 2. Conflict Check: Lead Surgeon overlap
    const surgeonConflict = await OtSchedule.findOne({
      ...activeFilter,
      leadSurgeonDoctorId,
    }).session(session);
    if (surgeonConflict) {
      throw accessError(
        409,
        `Lead surgeon is already booked for an overlapping surgery (${surgeonConflict.bookingNumber}) during this window`
      );
    }

    // 3. Conflict Check: Anesthetist overlap
    const anesthetistConflict = await OtSchedule.findOne({
      ...activeFilter,
      anesthetistDoctorId,
    }).session(session);
    if (anesthetistConflict) {
      throw accessError(
        409,
        `Anesthetist is already booked for an overlapping surgery (${anesthetistConflict.bookingNumber}) during this window`
      );
    }

    const bookingNumber =
      "OTB-" +
      Date.now().toString(36).toUpperCase() +
      "-" +
      crypto.randomBytes(3).toString("hex").toUpperCase();

    const [booking] = await OtSchedule.create(
      [
        {
          hospitalId,
          bookingNumber,
          theatreRoomId,
          patientId,
          admissionId,
          emergencyRegistrationId,
          leadSurgeonDoctorId,
          anesthetistDoctorId,
          scrubNurseStaffId,
          procedureName: String(procedureName).trim(),
          urgency,
          scheduledStartTime: startTime,
          scheduledEndTime: endTime,
          status: "scheduled",
        },
      ],
      { session }
    );

    return {
      success: true,
      booking,
    };
  });
};

/**
 * 4. Cancellation & Immediate Resource Release
 */
export const cancelTheatreCase = async ({ hospitalId, bookingId, reason, actor }) => {
  assertDbConnected();
  if (testDouble?.cancelTheatreCase) {
    return testDouble.cancelTheatreCase({ hospitalId, bookingId, reason, actor });
  }

  if (!reason || !String(reason).trim()) {
    throw accessError(400, "Cancellation reason is required");
  }

  const booking = await OtSchedule.findOne({
    _id: bookingId,
    hospitalId,
    status: { $in: ["scheduled", "in_progress"] },
  });
  if (!booking) throw accessError(404, "Active theatre booking not found");

  booking.status = "cancelled";
  booking.cancellationReason = String(reason).trim();
  booking.cancellationTimestamp = new Date();
  booking.version = (booking.version || 0) + 1;
  await booking.save();

  return {
    success: true,
    booking,
  };
};

/**
 * 5. WHO Surgical Safety Checklist Verification & Stage Progression
 */
export const recordWhoChecklistStage = async ({
  hospitalId,
  bookingId,
  stage, // 'signIn' | 'timeOut' | 'signOut'
  checkpoints = {},
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.recordWhoChecklistStage) {
    return testDouble.recordWhoChecklistStage({ hospitalId, bookingId, stage, checkpoints, actor });
  }

  const validStages = ["signIn", "timeOut", "signOut"];
  if (!validStages.includes(stage)) {
    throw accessError(400, `Invalid WHO checklist stage: '${stage}'. Allowed: [${validStages.join(", ")}]`);
  }

  const stageKey = stage === "signIn" ? "SIGN_IN" : stage === "timeOut" ? "TIME_OUT" : "SIGN_OUT";
  const requiredCheckpoints = WHO_SURGICAL_SAFETY_STAGES[stageKey].minimumCheckpoints;

  // Validate mandatory checkpoints
  const missing = requiredCheckpoints.filter((cp) => !checkpoints[cp]);
  if (missing.length > 0) {
    throw accessError(
      400,
      `WHO Surgical Safety Checklist (${stage}) incomplete: missing mandatory verified items [${missing.join(", ")}]`
    );
  }

  return await moneyTransaction(async (session) => {
    const booking = await OtSchedule.findOne({
      _id: bookingId,
      hospitalId,
      status: { $in: ["scheduled", "in_progress"] },
    }).session(session);

    if (!booking) throw accessError(404, "Active theatre booking not found");

    // Sequence gate enforcement: Time Out requires Sign In; Sign Out requires Time Out
    if (stage === "timeOut" && !booking.whoChecklist?.signIn?.completed) {
      throw accessError(400, "Cannot perform Time Out before Sign In checklist is complete");
    }
    if (stage === "signOut" && !booking.whoChecklist?.timeOut?.completed) {
      throw accessError(400, "Cannot perform Sign Out before Time Out checklist is complete");
    }

    booking.whoChecklist[stage] = {
      completed: true,
      completedAt: new Date(),
      verifiedByDoctorId: stage === "timeOut" ? actor?.doctorId || booking.leadSurgeonDoctorId : null,
      verifiedByStaffId: stage !== "timeOut" ? actor?.staffId || null : null,
      checkpoints: new Map(Object.entries(checkpoints)),
    };

    // Status state progression:
    // Sign In -> in_progress
    // Sign Out -> completed
    if (stage === "signIn" && booking.status === "scheduled") {
      booking.status = "in_progress";
      booking.actualStartTime = new Date();
    } else if (stage === "signOut" && booking.status === "in_progress") {
      booking.status = "completed";
      booking.actualEndTime = new Date();
    }

    booking.version = (booking.version || 0) + 1;
    await booking.save({ session });

    return {
      success: true,
      booking,
      stage,
      status: booking.status,
    };
  });
};

/**
 * 6. PACU (Post-Anesthesia Care Unit) Recovery & Aldrete Discharge Gate
 */
export const recordPacuRecovery = async ({
  hospitalId,
  bookingId,
  aldreteScore,
  dischargedToWard = false,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.recordPacuRecovery) {
    return testDouble.recordPacuRecovery({ hospitalId, bookingId, aldreteScore, dischargedToWard, actor });
  }

  const score = Number(aldreteScore);
  if (isNaN(score) || score < 0 || score > 10) {
    throw accessError(400, "Valid Aldrete recovery score (0 to 10) is required");
  }

  // Clinical safety gate: score >= 8 required for safe discharge to ward
  if (dischargedToWard && score < 8) {
    throw accessError(
      400,
      `PACU safety violation: Aldrete recovery score of ${score} is insufficient for ward transfer (minimum 8 required)`
    );
  }

  const booking = await OtSchedule.findOne({ _id: bookingId, hospitalId, status: "completed" });
  if (!booking) throw accessError(404, "Completed theatre surgery booking not found for PACU recovery");

  booking.pacu = {
    aldreteScore: score,
    recoveryNurseStaffId: actor?.staffId || null,
    dischargedToWard: Boolean(dischargedToWard),
    dischargedAt: dischargedToWard ? new Date() : null,
  };

  await booking.save();

  return {
    success: true,
    pacu: booking.pacu,
  };
};

/**
 * 7. Emergency Department Queries & Status Updates
 */
export const getEmergencyRegistrations = async ({
  hospitalId,
  status,
  triageLevel,
  search,
  limit = 50,
  page = 1,
}) => {
  assertDbConnected();
  if (testDouble?.getEmergencyRegistrations) {
    return testDouble.getEmergencyRegistrations({ hospitalId, status, triageLevel, search, limit, page });
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);
  checkFeatureEntitlement(hospital, "emergency_theatre");

  const query = { hospitalId };
  if (status) {
    if (status.includes(",")) {
      query.status = { $in: status.split(",").map((s) => s.trim()) };
    } else {
      query.status = status;
    }
  }
  if (triageLevel) {
    query.triageLevel = Number(triageLevel);
  }
  if (search && String(search).trim()) {
    const term = String(search).trim();
    query.$or = [
      { patientName: { $regex: term, $options: "i" } },
      { emergencyNumber: { $regex: term, $options: "i" } },
      { chiefComplaint: { $regex: term, $options: "i" } },
      { assignedBay: { $regex: term, $options: "i" } },
    ];
  }

  const parsedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const parsedPage = Math.max(1, Number(page) || 1);
  const skip = (parsedPage - 1) * parsedLimit;

  const [registrations, total] = await Promise.all([
    EmergencyRegistration.find(query)
      .populate("attendingDoctorId", "firstName lastName specialization")
      .populate("triagedByStaffId", "name role")
      .populate("linkedAdmissionId", "admissionNumber bedId status")
      .sort({ arrivalTime: -1 })
      .skip(skip)
      .limit(parsedLimit)
      .lean(),
    EmergencyRegistration.countDocuments(query),
  ]);

  return {
    success: true,
    registrations,
    total,
    page: parsedPage,
    limit: parsedLimit,
  };
};

export const getEmergencyRegistrationById = async ({ hospitalId, emergencyRegistrationId }) => {
  assertDbConnected();
  if (testDouble?.getEmergencyRegistrationById) {
    return testDouble.getEmergencyRegistrationById({ hospitalId, emergencyRegistrationId });
  }

  const registration = await EmergencyRegistration.findOne({
    _id: emergencyRegistrationId,
    hospitalId,
  })
    .populate("attendingDoctorId", "firstName lastName specialization")
    .populate("triagedByStaffId", "name role")
    .populate("linkedAdmissionId")
    .lean();

  if (!registration) throw accessError(404, "Emergency registration not found");
  return registration;
};

export const updateEmergencyStatus = async ({
  hospitalId,
  emergencyRegistrationId,
  status,
  attendingDoctorId,
  assignedBay,
  outcomeNotes,
  linkedAdmissionId,
  actor,
}) => {
  assertDbConnected();
  if (testDouble?.updateEmergencyStatus) {
    return testDouble.updateEmergencyStatus({
      hospitalId,
      emergencyRegistrationId,
      status,
      attendingDoctorId,
      assignedBay,
      outcomeNotes,
      linkedAdmissionId,
      actor,
    });
  }

  const validStatuses = ["triaged", "in_treatment", "admitted_ipd", "transferred_out", "discharged", "deceased"];
  if (status && !validStatuses.includes(status)) {
    throw accessError(400, `Invalid emergency status: '${status}'. Allowed: [${validStatuses.join(", ")}]`);
  }

  const registration = await EmergencyRegistration.findOne({
    _id: emergencyRegistrationId,
    hospitalId,
  });
  if (!registration) throw accessError(404, "Emergency registration not found");

  if (status) {
    registration.status = status;
    if (["admitted_ipd", "transferred_out", "discharged", "deceased"].includes(status)) {
      registration.dispositionTime = new Date();
    }
  }
  if (attendingDoctorId !== undefined) {
    registration.attendingDoctorId = attendingDoctorId || null;
  }
  if (assignedBay !== undefined) {
    registration.assignedBay = String(assignedBay || "").trim();
  }
  if (outcomeNotes !== undefined) {
    registration.outcomeNotes = String(outcomeNotes || "").trim();
  }
  if (linkedAdmissionId !== undefined) {
    registration.linkedAdmissionId = linkedAdmissionId || null;
  }

  await registration.save();

  return {
    success: true,
    registration,
  };
};

/**
 * 8. Operation Theatre Queries
 */
export const getOtSchedules = async ({
  hospitalId,
  date,
  theatreRoomId,
  leadSurgeonDoctorId,
  status,
}) => {
  assertDbConnected();
  if (testDouble?.getOtSchedules) {
    return testDouble.getOtSchedules({ hospitalId, date, theatreRoomId, leadSurgeonDoctorId, status });
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);
  checkFeatureEntitlement(hospital, "emergency_theatre");

  const query = { hospitalId };
  if (theatreRoomId) query.theatreRoomId = theatreRoomId;
  if (leadSurgeonDoctorId) query.leadSurgeonDoctorId = leadSurgeonDoctorId;
  if (status) query.status = status;

  if (date) {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);
    query.scheduledStartTime = { $gte: dayStart, $lte: dayEnd };
  }

  const schedules = await OtSchedule.find(query)
    .populate("theatreRoomId", "theatreCode theatreName theatreType")
    .populate("leadSurgeonDoctorId", "firstName lastName specialization")
    .populate("anesthetistDoctorId", "firstName lastName specialization")
    .populate("scrubNurseStaffId", "name role")
    .populate("patientId", "firstName lastName phoneNumber gender")
    .populate("whoChecklist.timeOut.verifiedByDoctorId", "firstName lastName")
    .populate("whoChecklist.signIn.verifiedByStaffId", "name role")
    .populate("whoChecklist.signOut.verifiedByStaffId", "name role")
    .populate("pacu.recoveryNurseStaffId", "name role")
    .sort({ scheduledStartTime: 1 })
    .lean();

  return {
    success: true,
    schedules,
  };
};

export const getOtScheduleById = async ({ hospitalId, bookingId }) => {
  assertDbConnected();
  if (testDouble?.getOtScheduleById) {
    return testDouble.getOtScheduleById({ hospitalId, bookingId });
  }

  const booking = await OtSchedule.findOne({ _id: bookingId, hospitalId })
    .populate("theatreRoomId", "theatreCode theatreName theatreType")
    .populate("leadSurgeonDoctorId", "firstName lastName specialization")
    .populate("anesthetistDoctorId", "firstName lastName specialization")
    .populate("scrubNurseStaffId", "name role")
    .populate("patientId", "firstName lastName phoneNumber gender age")
    .populate("whoChecklist.timeOut.verifiedByDoctorId", "firstName lastName")
    .populate("whoChecklist.signIn.verifiedByStaffId", "name role")
    .populate("whoChecklist.signOut.verifiedByStaffId", "name role")
    .populate("pacu.recoveryNurseStaffId", "name role")
    .lean();

  if (!booking) throw accessError(404, "Theatre surgery booking not found");
  return booking;
};

export default {
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
};

