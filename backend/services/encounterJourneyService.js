import mongoose from "mongoose";
import crypto from "crypto";
import EncounterJourney from "../model/encounterJourney.js";
import HospitalLocation from "../model/hospitalLocation.js";
import OpdToken from "../model/opdToken.js";
import { accessError } from "./hospitalAccess.js";
import { assertClinicalWorkflowReady } from "./clinicalSchema.js";

const DEFAULT_STEPS = ["reception", "vitals", "consultation"];

const STAGE_DESTINATION_SERVICE_MAP = {
  booked: "reception",
  checked_in: "reception",
  reception: "vitals",
  vitals: "consultation",
  consultation: "pharmacy",
  diagnostics: "lab",
  pharmacy: "billing",
  completed: "billing",
};

export const initializeEncounterJourney = async ({
  hospitalId,
  departmentId,
  tokenId,
  appointmentId,
  patientId,
  familyMemberId,
  isWalkIn = false,
  ticketNumber,
  requiredSteps,
}) => {
  if (process.env.REQUIRE_CLINICAL_SCHEMA === "true") {
    await assertClinicalWorkflowReady({ workflow: "Encounter" });
  }

  if (mongoose.connection?.readyState !== 1) return null;

  let encounter = await EncounterJourney.findOne({
    $or: [
      ...(tokenId ? [{ tokenId }] : []),
      ...(appointmentId ? [{ appointmentId }] : []),
    ],
  });

  if (encounter) return encounter;

  const steps = Array.isArray(requiredSteps) && requiredSteps.length > 0 ? requiredSteps : DEFAULT_STEPS;

  // Find initial destination location (reception desk)
  const initialLocation = await HospitalLocation.findOne({
    hospitalId,
    serviceType: "reception",
    status: "active",
  }).lean();

  const qrPayload = crypto
    .createHash("sha256")
    .update(`${hospitalId}:${ticketNumber}:${Date.now()}`)
    .digest("hex")
    .substring(0, 24);

  encounter = new EncounterJourney({
    hospitalId,
    departmentId,
    tokenId,
    appointmentId,
    patientId,
    familyMemberId,
    isWalkIn,
    ticketNumber: ticketNumber || "T000",
    qrPayload,
    currentStage: isWalkIn ? "checked_in" : "booked",
    requiredSteps: steps,
    currentDestination: initialLocation
      ? {
          locationId: initialLocation._id,
          name: initialLocation.name,
          building: initialLocation.building,
          floor: initialLocation.floor,
          roomNumber: initialLocation.roomNumber,
          instructions: initialLocation.instructions || "Please report to the reception desk for check-in verification.",
        }
      : {
          name: "Main Reception",
          instructions: "Please report to the central hospital reception desk for check-in verification.",
        },
    stageHistory: [
      {
        stage: isWalkIn ? "checked_in" : "booked",
        fromStage: "none",
        timestamp: new Date(),
        notes: isWalkIn ? "Walk-in encounter created at reception" : "Scheduled encounter confirmed",
      },
    ],
    physicalFile: {
      hasPhysicalFile: false,
      locationName: "not recorded",
      handoffHistory: [],
    },
    revision: 0,
  });

  await encounter.save();
  return encounter;
};

export const transitionEncounterStage = async ({
  encounterId,
  toStage,
  actor,
  locationId,
  notes = "",
  overrideReason = "",
}) => {
  const encounter = await EncounterJourney.findById(encounterId);
  if (!encounter) throw accessError(404, "Encounter journey not found");

  const fromStage = encounter.currentStage;
  if (fromStage === toStage) return encounter;

  // Determine if transition is an override (skipping required steps)
  const isOverride = Boolean(overrideReason);

  // Find next destination based on stage
  let nextDestLocation = null;
  if (locationId) {
    nextDestLocation = await HospitalLocation.findById(locationId).lean();
  } else {
    const targetService = STAGE_DESTINATION_SERVICE_MAP[toStage] || "consultation";
    nextDestLocation = await HospitalLocation.findOne({
      hospitalId: encounter.hospitalId,
      departmentId: encounter.departmentId,
      serviceType: targetService,
      status: "active",
    }).lean() || await HospitalLocation.findOne({
      hospitalId: encounter.hospitalId,
      serviceType: targetService,
      status: "active",
    }).lean();
  }

  encounter.currentStage = toStage;
  encounter.revision += 1;

  if (nextDestLocation) {
    encounter.currentDestination = {
      locationId: nextDestLocation._id,
      name: nextDestLocation.name,
      building: nextDestLocation.building,
      floor: nextDestLocation.floor,
      roomNumber: nextDestLocation.roomNumber,
      instructions: nextDestLocation.instructions || `Proceed to ${nextDestLocation.name}`,
    };
  } else {
    encounter.currentDestination = {
      name: "not recorded",
      instructions: `Follow clinical staff directions for ${toStage}.`,
    };
  }

  encounter.stageHistory.push({
    stage: toStage,
    fromStage,
    actorId: actor?._id || actor?.id,
    actorRole: actor?.role || "SYSTEM",
    actorName: actor?.name || actor?.firstName ? `${actor?.firstName || ""} ${actor?.lastName || ""}`.trim() : "Staff Member",
    timestamp: new Date(),
    locationId: nextDestLocation?._id,
    locationName: nextDestLocation?.name || "not recorded",
    notes,
    reason: overrideReason || undefined,
    isOverride,
  });

  await encounter.save();
  return encounter;
};

export const handoffPhysicalFile = async ({
  encounterId,
  fromActor,
  toActor,
  locationId,
  reason = "",
  acknowledged = true,
}) => {
  const encounter = await EncounterJourney.findById(encounterId);
  if (!encounter) throw accessError(404, "Encounter journey not found");

  let locationRecord = null;
  if (locationId) {
    locationRecord = await HospitalLocation.findById(locationId).lean();
  }

  const locationName = locationRecord ? locationRecord.name : "not recorded";

  const handoffEntry = {
    fromActorId: fromActor?._id || fromActor?.id,
    fromActorName: fromActor?.name || [fromActor?.firstName, fromActor?.lastName].filter(Boolean).join(" ") || "Staff",
    fromActorRole: fromActor?.role || "STAFF",
    toActorId: toActor?._id || toActor?.id,
    toActorName: toActor?.name || [toActor?.firstName, toActor?.lastName].filter(Boolean).join(" ") || "Staff",
    toActorRole: toActor?.role || "STAFF",
    fromLocationId: encounter.physicalFile?.locationId,
    toLocationId: locationRecord?._id,
    toLocationName: locationName,
    timestamp: new Date(),
    status: acknowledged ? "acknowledged" : "pending",
    acknowledgedAt: acknowledged ? new Date() : undefined,
    reason,
  };

  encounter.physicalFile.hasPhysicalFile = true;
  if (acknowledged) {
    encounter.physicalFile.currentHolderId = toActor?._id || toActor?.id;
    encounter.physicalFile.currentHolderRole = toActor?.role || "STAFF";
    encounter.physicalFile.currentHolderName = handoffEntry.toActorName;
    encounter.physicalFile.locationId = locationRecord?._id;
    encounter.physicalFile.locationName = locationName;
    encounter.physicalFile.lastHandoffAt = new Date();
  }

  encounter.physicalFile.handoffHistory.push(handoffEntry);
  encounter.revision += 1;

  await encounter.save();
  return encounter;
};

export const refusePhysicalFileHandoff = async ({
  encounterId,
  actor,
  reason = "Refused by recipient",
}) => {
  const encounter = await EncounterJourney.findById(encounterId);
  if (!encounter) throw accessError(404, "Encounter journey not found");

  const pendingIndex = encounter.physicalFile.handoffHistory.findIndex(
    (h) => h.status === "pending" && String(h.toActorId) === String(actor?._id || actor?.id)
  );

  if (pendingIndex === -1) {
    // If no specific pending record, record a refused handoff event directly
    encounter.physicalFile.handoffHistory.push({
      fromActorId: encounter.physicalFile.currentHolderId,
      toActorId: actor?._id || actor?.id,
      toActorName: actor?.name || "Staff",
      toActorRole: actor?.role || "STAFF",
      timestamp: new Date(),
      status: "refused",
      refusedAt: new Date(),
      reason,
      toLocationName: "not recorded",
    });
  } else {
    encounter.physicalFile.handoffHistory[pendingIndex].status = "refused";
    encounter.physicalFile.handoffHistory[pendingIndex].refusedAt = new Date();
    encounter.physicalFile.handoffHistory[pendingIndex].reason = reason;
  }

  encounter.revision += 1;
  await encounter.save();
  return encounter;
};

export const linkWalkInToAccount = async ({
  encounterId,
  tokenId,
  userId,
}) => {
  const query = encounterId ? { _id: encounterId } : { tokenId };
  const encounter = await EncounterJourney.findOne(query);
  if (!encounter) throw accessError(404, "Encounter journey not found");

  if (!encounter.isWalkIn) {
    throw accessError(400, "This visit was not booked as a walk-in");
  }

  if (encounter.linkedUserId) {
    throw accessError(409, "This walk-in ticket is already linked to an account");
  }

  encounter.linkedUserId = userId;
  encounter.patientId = userId;
  encounter.linkedAt = new Date();
  encounter.revision += 1;

  await encounter.save();

  // Also link the OPD token if present
  if (encounter.tokenId) {
    await OpdToken.findByIdAndUpdate(encounter.tokenId, {
      $set: { patientId: userId, "patientInfo.isWalkIn": false },
    });
  }

  return encounter;
};

export const getEncounterGuidance = async ({ tokenId, appointmentId, encounterId }) => {
  const query = encounterId
    ? { _id: encounterId }
    : tokenId
    ? { tokenId }
    : { appointmentId };

  const encounter = await EncounterJourney.findOne(query)
    .populate("currentDestination.locationId")
    .lean();

  if (!encounter) throw accessError(404, "Encounter not found");

  return {
    ticketNumber: encounter.ticketNumber,
    currentStage: encounter.currentStage,
    destination: {
      name: encounter.currentDestination?.name || "not recorded",
      building: encounter.currentDestination?.building || "—",
      floor: encounter.currentDestination?.floor || "—",
      roomNumber: encounter.currentDestination?.roomNumber || "—",
      instructions: encounter.currentDestination?.instructions || "Proceed to the destination indicated by hospital staff.",
    },
    physicalFile: {
      tracked: Boolean(encounter.physicalFile?.hasPhysicalFile),
      holder: encounter.physicalFile?.currentHolderName || "not recorded",
      holderRole: encounter.physicalFile?.currentHolderRole || "not recorded",
      location: encounter.physicalFile?.locationName || "not recorded",
    },
    isWalkIn: encounter.isWalkIn,
    isLinked: Boolean(encounter.linkedUserId),
    qrPayload: encounter.qrPayload,
    revision: encounter.revision,
    updatedAt: encounter.updatedAt,
  };
};
