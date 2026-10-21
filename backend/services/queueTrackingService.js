import OpdToken from "../model/opdToken.js";
import Appointment from "../model/appointment.js";
import EncounterJourney from "../model/encounterJourney.js";
import Hospital from "../model/hospital.js";
import { idOf, accessError } from "./hospitalAccess.js";
import { localServiceDate } from "./queueContext.js";

import { getQueuePauseState, setQueuePaused } from "./queueControls.js";
export { getQueuePauseState };
export const pauseDoctorQueue = options => setQueuePaused(options, true);
export const resumeDoctorQueue = options => setQueuePaused(options, false);

export const calculateQueueETA = async ({ queueKey, targetTokenNumber, status, token, targetToken }) => {
  const currentToken = token || targetToken;
  const currentStatus = status || currentToken?.status;

  // 1. Truthful terminal ETA semantics
  if (currentStatus === "completed") {
    return {
      isTerminal: true,
      status: "completed",
      patientsAhead: 0,
      nowServingToken: null,
      etaRange: {
        minMinutes: null,
        maxMinutes: null,
        label: "Consultation completed",
        confidence: "exact",
      },
      doctorStatus: "completed",
      pauseReason: null,
      lastUpdated: new Date(),
    };
  }

  if (currentStatus === "cancelled") {
    return {
      isTerminal: true,
      status: "cancelled",
      patientsAhead: 0,
      nowServingToken: null,
      etaRange: {
        minMinutes: null,
        maxMinutes: null,
        label: "Appointment cancelled",
        confidence: "exact",
      },
      doctorStatus: "cancelled",
      pauseReason: null,
      lastUpdated: new Date(),
    };
  }

  if (currentStatus === "no_show") {
    return {
      isTerminal: true,
      status: "no_show",
      patientsAhead: 0,
      nowServingToken: null,
      etaRange: {
        minMinutes: null,
        maxMinutes: null,
        label: "Marked as no-show",
        confidence: "exact",
      },
      doctorStatus: "no_show",
      pauseReason: null,
      lastUpdated: new Date(),
    };
  }

  const pause = await getQueuePauseState(queueKey);

  // 2. Truthful active-target ETA semantics (patient is currently in consultation)
  if (currentStatus === "in_consultation") {
    const servingDisplay = currentToken?.displayToken || (targetTokenNumber ? `T${targetTokenNumber}` : "In Progress");
    return {
      isActive: true,
      status: "in_consultation",
      patientsAhead: 0,
      nowServingToken: servingDisplay,
      etaRange: {
        minMinutes: 0,
        maxMinutes: 0,
        label: "Currently in consultation",
        confidence: "high",
      },
      doctorStatus: pause.isPaused ? "paused" : "consulting",
      pauseReason: pause.isPaused ? "Consultations temporarily paused" : null,
      lastUpdated: new Date(),
    };
  }

  const currentlyServing = await OpdToken.findOne({
    queueKey,
    status: "in_consultation",
  }).lean();

  const nowServingTokenDisplay = currentlyServing ? (currentlyServing.displayToken || `T${currentlyServing.tokenNumber}`) : null;

  // 3. Truthful reserved/unarrived ETA semantics (patient booked but hasn't arrived)
  if (currentStatus === "reserved") {
    return {
      isReserved: true,
      status: "reserved",
      patientsAhead: null,
      nowServingToken: nowServingTokenDisplay,
      etaRange: {
        minMinutes: null,
        maxMinutes: null,
        label: "Arrival check-in required",
        confidence: "pending_arrival",
      },
      doctorStatus: pause.isPaused ? "paused" : currentlyServing ? "consulting" : "waiting",
      pauseReason: pause.isPaused ? "Consultations temporarily paused" : null,
      lastUpdated: new Date(),
    };
  }

  // 4. Waiting / vitals done queue calculations using deterministic order: { priority: -1, tokenNumber: 1 }
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

  // Target token priority
  const targetPriority = currentToken?.priority || 0;

  // Count active tokens ahead in deterministic order: higher priority first, then lower token number
  const priorityFilter = {
    queueKey,
    status: { $in: ["waiting", "vitals_done"] },
    ...(currentToken?._id ? { _id: { $ne: currentToken._id } } : {}),
    $or: [
      { priority: { $gt: targetPriority } },
      { priority: targetPriority, tokenNumber: { $lt: targetTokenNumber } },
    ],
  };

  const activeTokensAhead = await OpdToken.countDocuments(priorityFilter);

  // If currently serving token exists and is not the current token, it counts as 1 patient ahead
  const isSelfServing = currentlyServing && currentToken && String(currentlyServing._id) === String(currentToken._id);
  const patientsAheadCount = activeTokensAhead + (currentlyServing && !isSelfServing ? 1 : 0);

  // Calculate range rather than claiming single fixed minute
  const baseMinutes = patientsAheadCount * avgMinutes;
  const minMinutes = Math.max(0, Math.round(baseMinutes * 0.8));
  const maxMinutes = Math.round(baseMinutes * 1.3) + (pause.isPaused ? 15 : 0);

  let label;
  if (patientsAheadCount === 0 && currentlyServing && !isSelfServing) {
    label = "You are next";
  } else if (patientsAheadCount === 0 && !currentlyServing) {
    label = "Ready to be called";
  } else {
    label = `${minMinutes}–${maxMinutes} mins`;
  }

  return {
    patientsAhead: patientsAheadCount,
    nowServingToken: nowServingTokenDisplay,
    etaRange: pause.isPaused ? { minMinutes: null, maxMinutes: null, label: "Queue paused - waiting time unavailable", confidence: "unavailable" } : {
      minMinutes,
      maxMinutes,
      label,
      confidence,
    },
    doctorStatus: pause.isPaused ? "paused" : currentlyServing ? "consulting" : "waiting",
    pauseReason: pause.isPaused ? "Consultations temporarily paused" : null,
    lastUpdated: new Date(),
  };
};

function rollupDepartments(queues) {
  const map = new Map();
  for (const q of queues) {
    if (!map.has(q.departmentId)) {
      map.set(q.departmentId, {
        departmentId: q.departmentId,
        departmentName: q.departmentName,
        departmentCode: q.departmentCode,
        nowServing: null,
        nextInLine: [],
        totalWaiting: 0,
        doctorStatus: q.doctorStatus,
      });
    }
    const dept = map.get(q.departmentId);
    if (!dept.nowServing && q.nowServing) {
      dept.nowServing = q.nowServing;
    }
    dept.totalWaiting += q.totalWaiting;
    for (const item of q.nextInLine || []) {
      const display = typeof item === "string" ? item : item.displayToken;
      if (dept.nextInLine.length < 5 && !dept.nextInLine.includes(display)) {
        dept.nextInLine.push(display);
      }
    }
  }
  return Array.from(map.values());
}

export const getHospitalKioskStatus = async (hospitalId, targetDate = new Date()) => {
  const hospital = await Hospital.findById(hospitalId).lean();
  if (!hospital) throw accessError(404, "Hospital not found");

  const timezone = hospital.settings?.timezone || "Asia/Kolkata";
  const serviceDate = localServiceDate(targetDate, timezone);

  const activeTokens = await OpdToken.find({
    hospitalId,
    serviceDate,
    status: { $in: ["waiting", "vitals_done", "in_consultation"] },
  })
    .sort({ priority: -1, tokenNumber: 1 })
    .populate("departmentId", "name code")
    .populate("doctorId", "name doctorProfile.specialization")
    .lean();

  const queueMap = new Map();

  for (const token of activeTokens) {
    const docId = String(token.doctorId?._id || token.doctorId || "unassigned");
    const sessId = token.sessionId || "day";
    const groupKey = `${docId}:${sessId}`;

    if (!queueMap.has(groupKey)) {
      const dept = token.departmentId;
      const doc = token.doctorId;
      queueMap.set(groupKey, {
        queueKey: token.queueKey,
        departmentId: String(dept?._id || dept || "unknown"),
        departmentName: dept?.name || "General OPD",
        departmentCode: dept?.code || "OPD",
        doctorId: docId,
        doctorName: doc?.name ? `Dr. ${doc.name.replace(/^Dr\.\s*/i, "")}` : "Attending Physician",
        specialization: doc?.doctorProfile?.specialization || "",
        sessionId: sessId,
        serviceDate,
        nowServing: null,
        nowServingToken: null,
        nextInLine: [],
        totalWaiting: 0,
        isPaused: false,
      });
    }

    const group = queueMap.get(groupKey);
    const tokenDisplay = token.displayToken || `T${String(token.tokenNumber).padStart(3, "0")}`;

    if (token.status === "in_consultation" && !group.nowServing) {
      group.nowServing = tokenDisplay;
      group.nowServingToken = {
        displayToken: tokenDisplay,
        priority: token.priority || 0,
      };
    } else if (["waiting", "vitals_done"].includes(token.status)) {
      group.totalWaiting += 1;
      if (group.nextInLine.length < 5) {
        group.nextInLine.push({
          displayToken: tokenDisplay,
          priority: token.priority || 0,
          isPriority: (token.priority || 0) > 0,
        });
      }
    }
  }

  // Populate pause state and doctor status for each queue group
  const queues = Array.from(queueMap.values());
  for (const q of queues) {
    if (q.queueKey) {
      const pause = await getQueuePauseState(q.queueKey);
      q.isPaused = Boolean(pause?.isPaused);
      q.doctorStatus = q.isPaused ? "paused" : q.nowServing ? "consulting" : "waiting";
    }
  }

  return {
    hospitalId: String(hospitalId),
    hospitalName: hospital.name,
    serviceDate,
    timezone,
    queues,
    departments: rollupDepartments(queues),
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
    status: token.status,
    token,
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

export const recordPriorityOverride = async ({ tokenId, actor, reason, newPriorityIndex = 1, key = null }) => {
  if (!reason || typeof reason !== "string" || !reason.trim()) {
    throw accessError(400, "Reason for priority override is required");
  }
  if (reason.trim().length > 300) {
    throw accessError(400, "Reason for priority override must be at most 300 characters");
  }

  const token = await OpdToken.findById(tokenId);
  if (!token) throw accessError(404, "Token not found");

  // Hospital tenant boundary: actor must belong to the token's hospital
  if (actor?.hospitalId && String(actor.hospitalId) !== String(token.hospitalId)) {
    throw accessError(403, "You cannot override priority in another hospital");
  }

  // Clinical role validation: only authorized roles
  const allowedRoles = ["DOCTOR", "NURSE", "TRIAGE", "DEPARTMENT_HEAD", "HOSPITAL_ADMIN"];
  if (actor?.role && !allowedRoles.includes(actor.role)) {
    throw accessError(403, "Only authorized clinical staff or administrators can override queue priority");
  }

  const numericPriority = Math.max(1, Number(newPriorityIndex) || 1);
  const trimmedReason = reason.trim();

  // Replay safety: if the same idempotency key was already recorded on this token
  if (key && token.priorityOverrideKey === key) {
    return {
      tokenId: token._id,
      priority: token.priority,
      reason: token.priorityReason,
      actorId: token.priorityOverriddenBy,
      timestamp: token.priorityOverriddenAt || token.updatedAt,
      replayed: true,
      overrideRecorded: true,
    };
  }

  // Update token
  token.priority = numericPriority;
  token.priorityReason = trimmedReason;
  token.priorityOverriddenAt = new Date();
  token.priorityOverriddenBy = actor?._id || actor?.id;
  if (key) token.priorityOverrideKey = key;
  token.revision = (token.revision || 0) + 1;
  await token.save();

  // Track in EncounterJourney
  const journey = await EncounterJourney.findOne({ tokenId });
  if (journey) {
    journey.stageHistory.push({
      stage: journey.currentStage,
      fromStage: journey.currentStage,
      actorId: actor?._id || actor?.id,
      actorRole: actor?.role || "STAFF",
      actorName: actor?.name || "Staff Member",
      timestamp: new Date(),
      notes: `Priority override applied: priority set to ${numericPriority} (${trimmedReason})`,
      reason: trimmedReason,
      isOverride: true,
    });
    journey.revision += 1;
    await journey.save();
  }

  return {
    tokenId: token._id,
    priority: numericPriority,
    overrideRecorded: true,
    actorId: actor?._id || actor?.id,
    reason: trimmedReason,
    timestamp: token.priorityOverriddenAt,
    replayed: false,
  };
};
