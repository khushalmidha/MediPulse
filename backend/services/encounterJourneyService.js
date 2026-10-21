import mongoose from "mongoose";
import crypto from "crypto";
import EncounterJourney from "../model/encounterJourney.js";
import HospitalLocation from "../model/hospitalLocation.js";
import OpdToken from "../model/opdToken.js";
import { accessError } from "./hospitalAccess.js";
import { assertClinicalWorkflowReady } from "./clinicalSchema.js";

import Appointment from "../model/appointment.js";

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
  personKey,
  isWalkIn = false,
  ticketNumber,
  requiredSteps,
  session,
} = {}) => {
  if (process.env.REQUIRE_CLINICAL_SCHEMA === "true") {
    await assertClinicalWorkflowReady({ workflow: "Encounter" });
  }

  if (mongoose.connection?.readyState !== 1) return null;

  // Derive source identity from token or appointment if omitted
  if (tokenId && (!hospitalId || !departmentId || !ticketNumber || !personKey)) {
    const tokenQuery = OpdToken.findById(tokenId);
    if (session) tokenQuery.session(session);
    const tokenDoc = await tokenQuery.lean();
    if (tokenDoc) {
      hospitalId ||= tokenDoc.hospitalId;
      departmentId ||= tokenDoc.departmentId;
      patientId ||= tokenDoc.patientId;
      familyMemberId ||= tokenDoc.familyMemberId;
      personKey ||= tokenDoc.personKey;
      isWalkIn = isWalkIn || Boolean(tokenDoc.patientInfo?.isWalkIn);
      ticketNumber ||= tokenDoc.displayToken || `T${tokenDoc.tokenNumber}`;
      appointmentId ||= tokenDoc.appointmentId;
    }
  }

  if (appointmentId && (!hospitalId || !departmentId || !personKey)) {
    const apptQuery = Appointment.findById(appointmentId);
    if (session) apptQuery.session(session);
    const apptDoc = await apptQuery.lean();
    if (apptDoc) {
      hospitalId ||= apptDoc.hospitalId;
      departmentId ||= apptDoc.departmentId;
      patientId ||= apptDoc.user;
      familyMemberId ||= apptDoc.familyMemberId;
      personKey ||= apptDoc.personKey;
      tokenId ||= apptDoc.opdTokenId;
    }
  }

  const query = {
    $or: [
      ...(tokenId ? [{ tokenId }] : []),
      ...(appointmentId ? [{ appointmentId }] : []),
    ],
  };

  if (!query.$or.length) return null;

  let encounterQuery = EncounterJourney.findOne(query);
  if (session) encounterQuery.session(session);
  let encounter = await encounterQuery;

  if (encounter) {
    let modified = false;
    if (tokenId && !encounter.tokenId) {
      encounter.tokenId = tokenId;
      modified = true;
    }
    if (appointmentId && !encounter.appointmentId) {
      encounter.appointmentId = appointmentId;
      modified = true;
    }
    if (personKey && !encounter.personKey) {
      encounter.personKey = personKey;
      modified = true;
    }
    if (patientId && !encounter.patientId) {
      encounter.patientId = patientId;
      modified = true;
    }
    if (familyMemberId && !encounter.familyMemberId) {
      encounter.familyMemberId = familyMemberId;
      modified = true;
    }
    if (modified) {
      encounter.revision = (encounter.revision || 0) + 1;
      await encounter.save(session ? { session } : undefined);
    }
    return encounter;
  }

  const steps = Array.isArray(requiredSteps) && requiredSteps.length > 0 ? requiredSteps : DEFAULT_STEPS;

  // Find initial destination location (reception desk)
  const locQuery = HospitalLocation.findOne({
    hospitalId,
    serviceType: "reception",
    status: "active",
  });
  if (session) locQuery.session(session);
  const initialLocation = await locQuery.lean();

  const qrPayload = crypto
    .createHash("sha256")
    .update(`${hospitalId}:${ticketNumber || "T000"}:${tokenId || appointmentId || Date.now()}`)
    .digest("hex")
    .substring(0, 24);

  const initialStage = isWalkIn ? "checked_in" : "booked";
  const stageNotes = isWalkIn ? "Walk-in encounter created at reception" : "Scheduled encounter confirmed";

  const encounterData = {
    hospitalId,
    departmentId,
    tokenId,
    appointmentId,
    patientId,
    familyMemberId,
    personKey,
    isWalkIn,
    ticketNumber: ticketNumber || "T000",
    qrPayload,
    currentStage: initialStage,
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
          name: "not recorded",
          instructions: "Location not configured. Please consult hospital staff.",
        },
    stageHistory: [
      {
        stage: initialStage,
        fromStage: "none",
        timestamp: new Date(),
        notes: stageNotes,
      },
    ],
    physicalFile: {
      hasPhysicalFile: false,
      locationName: "not recorded",
      handoffHistory: [],
    },
    revision: 0,
  };

  try {
    const [created] = await EncounterJourney.create([encounterData], session ? { session } : undefined);
    return created;
  } catch (error) {
    if (error.code === 11000) {
      const fallbackQuery = EncounterJourney.findOne(query);
      if (session) fallbackQuery.session(session);
      const existing = await fallbackQuery;
      if (existing) return existing;
    }
    throw error;
  }
};

export const resolveDestinationForStage = async ({
  hospitalId,
  departmentId,
  toStage,
  locationId,
  session,
}) => {
  if (locationId) {
    const locQuery = HospitalLocation.findById(locationId);
    if (session) locQuery.session(session);
    const loc = await locQuery.lean();
    if (!loc) throw accessError(404, "Destination location not found");
    if (String(loc.hospitalId) !== String(hospitalId)) {
      throw accessError(400, "Location does not belong to this hospital");
    }
    if (loc.status !== "active") {
      throw accessError(400, "Destination location is inactive");
    }
    if (loc.departmentId && departmentId && String(loc.departmentId) !== String(departmentId)) {
      throw accessError(400, "Location does not belong to the encounter department");
    }
    return {
      locationId: loc._id,
      name: loc.name,
      building: loc.building,
      floor: loc.floor,
      roomNumber: loc.roomNumber,
      instructions: loc.instructions || `Proceed to ${loc.name}`,
    };
  }

  const targetService = STAGE_DESTINATION_SERVICE_MAP[toStage] || "consultation";
  let loc = null;
  if (departmentId) {
    const deptQuery = HospitalLocation.findOne({
      hospitalId,
      departmentId,
      serviceType: targetService,
      status: "active",
    });
    if (session) deptQuery.session(session);
    loc = await deptQuery.lean();
  }
  if (!loc) {
    const hospQuery = HospitalLocation.findOne({
      hospitalId,
      serviceType: targetService,
      status: "active",
    });
    if (session) hospQuery.session(session);
    loc = await hospQuery.lean();
  }

  if (loc) {
    return {
      locationId: loc._id,
      name: loc.name,
      building: loc.building,
      floor: loc.floor,
      roomNumber: loc.roomNumber,
      instructions: loc.instructions || `Proceed to ${loc.name}`,
    };
  }

  return {
    name: "not recorded",
    instructions: "Location not configured. Please consult hospital staff.",
  };
};

export const transitionEncounterStage = async ({
  encounterId,
  hospitalId,
  toStage,
  actor,
  locationId,
  notes = "",
  overrideReason = "",
  expectedRevision,
}) => {
  const encounter = await EncounterJourney.findById(encounterId);
  if (!encounter) throw accessError(404, "Encounter journey not found");

  if (hospitalId && String(encounter.hospitalId) !== String(hospitalId)) {
    throw accessError(403, "You cannot modify encounters from another hospital");
  }

  if (expectedRevision !== undefined) {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
      throw accessError(400, "Invalid encounter revision");
    }
    if ((encounter.revision || 0) !== expectedRevision) {
      throw accessError(409, "Encounter changed; refresh before retrying");
    }
  }

  const fromStage = encounter.currentStage;
  if (fromStage === toStage) return encounter;

  if (["completed", "cancelled"].includes(fromStage)) {
    throw accessError(409, "Cannot transition a completed or cancelled encounter");
  }

  const STAGE_ORDER = ["booked", "checked_in", "reception", "vitals", "consultation", "diagnostics", "pharmacy", "completed"];
  const fromIdx = STAGE_ORDER.indexOf(fromStage);
  const toIdx = STAGE_ORDER.indexOf(toStage);

  if (toIdx === -1 && toStage !== "cancelled") {
    throw accessError(400, `Unknown target stage: ${toStage}`);
  }

  const required = encounter.requiredSteps || DEFAULT_STEPS;
  let skippedRequired = false;
  if (fromIdx !== -1 && toIdx !== -1) {
    if (toIdx > fromIdx + 1) {
      for (let i = fromIdx + 1; i < toIdx; i++) {
        if (required.includes(STAGE_ORDER[i])) {
          skippedRequired = true;
          break;
        }
      }
    } else if (toIdx < fromIdx) {
      skippedRequired = true;
    }
  }

  const hasReason = Boolean(overrideReason && overrideReason.trim());
  if (skippedRequired && !hasReason) {
    throw accessError(400, "Skipped required stages require an override reason");
  }

  const isOverride = hasReason || skippedRequired;

  const nextDest = await resolveDestinationForStage({
    hospitalId: encounter.hospitalId,
    departmentId: encounter.departmentId,
    toStage,
    locationId,
  });

  encounter.currentStage = toStage;
  encounter.currentDestination = nextDest;
  encounter.revision = (encounter.revision || 0) + 1;

  encounter.stageHistory.push({
    stage: toStage,
    fromStage,
    actorId: actor?._id || actor?.id,
    actorRole: actor?.role || "STAFF",
    actorName: actor?.name || (actor?.firstName ? `${actor.firstName} ${actor.lastName || ""}`.trim() : "Staff Member"),
    timestamp: new Date(),
    locationId: nextDest.locationId || undefined,
    locationName: nextDest.name || "not recorded",
    notes: notes || (isOverride ? `Override: ${overrideReason.trim()}` : `Transitioned to ${toStage}`),
    reason: hasReason ? overrideReason.trim() : undefined,
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

  let encounter = await EncounterJourney.findOne(query)
    .populate("currentDestination.locationId")
    .lean();

  if (!encounter && (tokenId || appointmentId)) {
    const repaired = await initializeEncounterJourney({ tokenId, appointmentId });
    if (repaired) {
      encounter = await EncounterJourney.findOne({ _id: repaired._id })
        .populate("currentDestination.locationId")
        .lean();
    }
  }

  if (!encounter) throw accessError(404, "Encounter not found");

  return {
    ticketNumber: encounter.ticketNumber,
    currentStage: encounter.currentStage,
    destination: {
      name: encounter.currentDestination?.name || "not recorded",
      building: encounter.currentDestination?.building || "—",
      floor: encounter.currentDestination?.floor || "—",
      roomNumber: encounter.currentDestination?.roomNumber || "—",
      instructions: encounter.currentDestination?.instructions || "Location not configured. Please consult hospital staff.",
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
