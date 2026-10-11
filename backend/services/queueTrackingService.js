import OpdToken from "../model/opdToken.js";
import Appointment from "../model/appointment.js";
import EncounterJourney from "../model/encounterJourney.js";
import { idOf, accessError } from "./hospitalAccess.js";

// Global in-memory pause registry for queue sessions (or stored with Redis)
const queuePauseState = new Map();

export const pauseDoctorQueue = ({ queueKey, doctorId, reason = "Doctor break" }) => {
  if (!queueKey) throw accessError(400, "Queue key is required");
  queuePauseState.set(queueKey, {
    isPaused: true,
    pausedAt: new Date(),
    pausedBy: doctorId,
    reason,
  });
  return queuePauseState.get(queueKey);
};

export const resumeDoctorQueue = ({ queueKey }) => {
  if (!queueKey) throw accessError(400, "Queue key is required");
  const previous = queuePauseState.get(queueKey);
  queuePauseState.delete(queueKey);
  return { isPaused: false, resumedAt: new Date(), previous };
};

export const getQueuePauseState = (queueKey) => {
  return queuePauseState.get(queueKey) || { isPaused: false };
};

export const calculateQueueETA = async ({ queueKey, targetTokenNumber }) => {
  const pause = getQueuePauseState(queueKey);

  // Find recent completed consultations to determine average duration
  const recentCompleted = await OpdToken.find({
    queueKey,
    status: "completed",
    consultationStartedAt: { $exists: true },
    consultationEndedAt: { $exists: true },
  })
    .sort({ consultationEndedAt: -1 })
    .limit(10)
    .lean();

  let avgMinutes = 12; // default clinical baseline
  let confidence = "low";

  if (recentCompleted.length >= 5) {
    const durations = recentCompleted
      .map((t) => (new Date(t.consultationEndedAt) - new Date(t.consultationStartedAt)) / 60000)
      .filter((d) => d >= 2 && d <= 60);

    if (durations.length >= 3) {
      const sum = durations.reduce((acc, v) => acc + v, 0);
      avgMinutes = Math.round(sum / durations.length);
      confidence = durations.length >= 7 ? "high" : "moderate";
    }
  }

  // Count active patients ahead in deterministic order
  const activeTokensAhead = await OpdToken.countDocuments({
    queueKey,
    status: { $in: ["waiting", "vitals_done"] },
    tokenNumber: { $lt: targetTokenNumber },
  });

  const currentlyServing = await OpdToken.findOne({
    queueKey,
    status: "in_consultation",
  }).lean();

  const patientsAheadCount = activeTokensAhead + (currentlyServing ? 1 : 0);

  // Calculate range rather than claiming single fixed minute
  const baseMinutes = patientsAheadCount * avgMinutes;
  const minMinutes = Math.max(0, Math.round(baseMinutes * 0.8));
  const maxMinutes = Math.round(baseMinutes * 1.3) + (pause.isPaused ? 15 : 0);

  return {
    patientsAhead: patientsAheadCount,
    nowServingToken: currentlyServing ? currentlyServing.displayToken || `T${currentlyServing.tokenNumber}` : null,
    etaRange: {
      minMinutes,
      maxMinutes,
      label: patientsAheadCount === 0 && currentlyServing
        ? "You are next"
        : `${minMinutes}–${maxMinutes} mins`,
      confidence,
    },
    doctorStatus: pause.isPaused ? "paused" : currentlyServing ? "consulting" : "waiting",
    pauseReason: pause.isPaused ? pause.reason : null,
    lastUpdated: new Date(),
  };
};

export const getHospitalKioskStatus = async (hospitalId, targetDate = new Date()) => {
  const startOfDay = new Date(targetDate);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(targetDate);
  endOfDay.setHours(23, 59, 59, 999);

  const activeTokens = await OpdToken.find({
    hospitalId,
    createdAt: { $gte: startOfDay, $lte: endOfDay },
    status: { $in: ["waiting", "vitals_done", "in_consultation"] },
  })
    .sort({ tokenNumber: 1 })
    .populate("departmentId", "name code")
    .lean();

  const departmentsMap = new Map();

  for (const token of activeTokens) {
    const deptId = token.departmentId?._id?.toString() || "unknown";
    if (!departmentsMap.has(deptId)) {
      departmentsMap.set(deptId, {
        departmentId: deptId,
        departmentName: token.departmentId?.name || "OPD Department",
        departmentCode: token.departmentId?.code || "OPD",
        nowServing: null,
        nextInLine: [],
        totalWaiting: 0,
      });
    }

    const dept = departmentsMap.get(deptId);
    const tokenDisplay = token.displayToken || `T${token.tokenNumber}`;

    if (token.status === "in_consultation" && !dept.nowServing) {
      dept.nowServing = tokenDisplay;
    } else {
      dept.totalWaiting += 1;
      if (dept.nextInLine.length < 4) {
        dept.nextInLine.push(tokenDisplay);
      }
    }
  }

  return {
    hospitalId,
    departments: Array.from(departmentsMap.values()),
    displayTime: new Date(),
    notice: "Privacy Protected Display · No Personal Patient Information is Displayed",
  };
};

export const getPatientLiveTimeline = async (tokenId) => {
  const token = await OpdToken.findById(tokenId).lean();
  if (!token) throw accessError(404, "Visit token not found");

  const eta = await calculateQueueETA({
    queueKey: token.queueKey,
    targetTokenNumber: token.tokenNumber,
  });

  const journey = await EncounterJourney.findOne({ tokenId }).lean();

  return {
    tokenId: token._id,
    displayToken: token.displayToken || `T${token.tokenNumber}`,
    serviceDate: token.serviceDate,
    status: token.status,
    eta,
    destination: journey?.currentDestination || {
      name: "not recorded",
      instructions: "Proceed to destination when called.",
    },
    timeline: journey?.stageHistory || [
      { stage: token.status, timestamp: token.createdAt, notes: "Token issued" },
    ],
    physicalFile: journey?.physicalFile || {
      hasPhysicalFile: false,
      locationName: "not recorded",
    },
    updatedAt: new Date(),
  };
};

export const recordPriorityOverride = async ({ tokenId, actor, reason, newPriorityIndex }) => {
  if (!reason) throw accessError(400, "Reason for priority override is required");

  const token = await OpdToken.findById(tokenId);
  if (!token) throw accessError(404, "Token not found");

  token.priority = Number(newPriorityIndex) || 1;
  token.priorityReason = reason.trim();
  await token.save();

  // Track the override in the journey history
  const journey = await EncounterJourney.findOne({ tokenId });
  if (journey) {
    journey.stageHistory.push({
      stage: journey.currentStage,
      fromStage: journey.currentStage,
      actorId: actor?._id || actor?.id,
      actorRole: actor?.role || "STAFF",
      actorName: actor?.name || "Staff Member",
      timestamp: new Date(),
      notes: `Priority override applied: position set to ${newPriorityIndex || "URGENT"}`,
      reason,
      isOverride: true,
    });
    journey.revision += 1;
    await journey.save();
  }

  return {
    tokenId,
    overrideRecorded: true,
    actorId: actor?._id || actor?.id,
    reason,
    timestamp: new Date(),
  };
};
