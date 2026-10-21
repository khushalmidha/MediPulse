import mongoose from "mongoose";
import crypto from "crypto";
import EncounterJourney from "../model/encounterJourney.js";
import HospitalLocation from "../model/hospitalLocation.js";
import HospitalStaff from "../model/hospitalStaff.js";
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

export const registerPhysicalFile = async ({
  encounterId,
  hospitalId,
  actor,
  fileBarcode,
  locationId,
  reason = "Initial physical file registration",
}) => {
  if (process.env.REQUIRE_CLINICAL_SCHEMA === "true") {
    await assertClinicalWorkflowReady({ workflow: "encounter" });
  }

  const encounter = await EncounterJourney.findById(encounterId);
  if (!encounter) throw accessError(404, "Encounter journey not found");
  if (hospitalId && String(encounter.hospitalId) !== String(hospitalId)) {
    throw accessError(403, "You do not have permission for this hospital's encounter");
  }

  if (encounter.physicalFile?.hasPhysicalFile) {
    throw accessError(409, "Physical file is already registered for this encounter");
  }

  let locationRecord = null;
  if (locationId) {
    locationRecord = await HospitalLocation.findOne({
      _id: locationId,
      hospitalId: encounter.hospitalId,
      $or: [{ status: "active" }, { isActive: true }],
    }).lean();
    if (!locationRecord) {
      throw accessError(400, "Destination location not found, inactive, or belongs to another hospital");
    }
  }

  const locationName = locationRecord ? locationRecord.name : "not recorded";
  const actorId = actor?._id || actor?.id;
  const actorName = actor?.name || "Staff Member";
  const actorRole = actor?.role || "STAFF";
  const barcode = fileBarcode || `PF-${encounter.ticketNumber}`;

  encounter.physicalFile = {
    hasPhysicalFile: true,
    fileBarcode: barcode,
    currentHolderId: actorId,
    currentHolderRole: actorRole,
    currentHolderName: actorName,
    locationId: locationRecord?._id || undefined,
    locationName,
    lastHandoffAt: new Date(),
    handoffHistory: [
      {
        handoffId: crypto.randomUUID(),
        fromActorId: actorId,
        fromActorName: actorName,
        fromActorRole: actorRole,
        toActorId: actorId,
        toActorName: actorName,
        toActorRole: actorRole,
        fromLocationId: locationRecord?._id || undefined,
        toLocationId: locationRecord?._id || undefined,
        toLocationName: locationName,
        timestamp: new Date(),
        status: "acknowledged",
        acknowledgedAt: new Date(),
        reason,
      },
    ],
  };

  encounter.revision = (encounter.revision || 0) + 1;
  await encounter.save();
  return encounter;
};

export const handoffPhysicalFile = async ({
  encounterId,
  hospitalId,
  fromActor,
  toActorId,
  locationId,
  reason = "",
  expectedRevision,
}) => {
  if (process.env.REQUIRE_CLINICAL_SCHEMA === "true") {
    await assertClinicalWorkflowReady({ workflow: "encounter" });
  }

  if (typeof expectedRevision !== "number") {
    throw accessError(400, "expectedRevision is required and must be a number");
  }
  if (!toActorId) {
    throw accessError(400, "Target recipient actor ID is required");
  }

  const encounter = await EncounterJourney.findById(encounterId);
  if (!encounter) throw accessError(404, "Encounter journey not found");
  if (hospitalId && String(encounter.hospitalId) !== String(hospitalId)) {
    throw accessError(403, "You do not have permission for this hospital's encounter");
  }

  if (encounter.revision !== expectedRevision) {
    throw accessError(409, `Encounter revision conflict. Expected ${expectedRevision}, but current revision is ${encounter.revision}`);
  }

  if (["completed", "cancelled"].includes(encounter.currentStage)) {
    throw accessError(409, "Cannot transfer file custody on a completed or cancelled encounter");
  }

  const senderId = String(fromActor?._id || fromActor?.id || "");
  const senderRole = fromActor?.role || "STAFF";
  const senderName = fromActor?.name || "Staff Member";
  const isAdmin = senderRole === "HOSPITAL_ADMIN" || Boolean(fromActor?.adminAccess);

  // If file not yet registered, auto-register it with sender as initial holder
  if (!encounter.physicalFile?.hasPhysicalFile) {
    encounter.physicalFile = {
      hasPhysicalFile: true,
      fileBarcode: `PF-${encounter.ticketNumber}`,
      currentHolderId: senderId,
      currentHolderRole: senderRole,
      currentHolderName: senderName,
      locationId: undefined,
      locationName: "not recorded",
      lastHandoffAt: new Date(),
      handoffHistory: [
        {
          handoffId: crypto.randomUUID(),
          fromActorId: senderId,
          fromActorName: senderName,
          fromActorRole: senderRole,
          toActorId: senderId,
          toActorName: senderName,
          toActorRole: senderRole,
          timestamp: new Date(),
          status: "acknowledged",
          acknowledgedAt: new Date(),
          reason: "Initial registration before transfer",
        },
      ],
    };
  }

  const currentHolderId = String(encounter.physicalFile?.currentHolderId || "");
  if (currentHolderId && currentHolderId !== senderId && !isAdmin) {
    throw accessError(403, "Only the current file holder or a hospital admin can initiate a file handoff");
  }

  // Prevent duplicate concurrent pending handoffs
  const existingPending = (encounter.physicalFile.handoffHistory || []).find((h) => h.status === "pending");
  if (existingPending) {
    throw accessError(409, "A file handoff is already pending recipient acknowledgement");
  }

  // Look up recipient staff member in the same hospital
  const recipientStaff = await HospitalStaff.findOne({
    _id: toActorId,
    hospitalId: encounter.hospitalId,
    isActive: true,
  }).lean();
  if (!recipientStaff) {
    throw accessError(400, "Recipient staff member not found, inactive, or belongs to another hospital");
  }

  if (String(recipientStaff._id) === senderId) {
    throw accessError(400, "Cannot hand off physical file to yourself");
  }

  let locationRecord = null;
  if (locationId) {
    locationRecord = await HospitalLocation.findOne({
      _id: locationId,
      hospitalId: encounter.hospitalId,
      $or: [{ status: "active" }, { isActive: true }],
    }).lean();
    if (!locationRecord) {
      throw accessError(400, "Destination location not found, inactive, or belongs to another hospital");
    }
  }

  const toLocationName = locationRecord ? locationRecord.name : "not recorded";

  // Critical requirement: request-supplied acknowledged=true is ignored! Custody DOES NOT TRANSFER until recipient accepts.
  const handoffEntry = {
    handoffId: crypto.randomUUID(),
    fromActorId: senderId,
    fromActorName: senderName,
    fromActorRole: senderRole,
    toActorId: recipientStaff._id,
    toActorName: recipientStaff.name,
    toActorRole: recipientStaff.role,
    fromLocationId: encounter.physicalFile.locationId,
    toLocationId: locationRecord?._id || undefined,
    toLocationName,
    timestamp: new Date(),
    status: "pending",
    reason: reason || "Physical file handoff",
  };

  encounter.physicalFile.handoffHistory.push(handoffEntry);
  encounter.revision = (encounter.revision || 0) + 1;
  await encounter.save();
  return encounter;
};

export const acceptPhysicalFileHandoff = async ({
  encounterId,
  hospitalId,
  actor,
  locationId,
  expectedRevision,
}) => {
  if (process.env.REQUIRE_CLINICAL_SCHEMA === "true") {
    await assertClinicalWorkflowReady({ workflow: "encounter" });
  }

  if (typeof expectedRevision !== "number") {
    throw accessError(400, "expectedRevision is required and must be a number");
  }

  const encounter = await EncounterJourney.findById(encounterId);
  if (!encounter) throw accessError(404, "Encounter journey not found");
  if (hospitalId && String(encounter.hospitalId) !== String(hospitalId)) {
    throw accessError(403, "You do not have permission for this hospital's encounter");
  }

  if (encounter.revision !== expectedRevision) {
    throw accessError(409, `Encounter revision conflict. Expected ${expectedRevision}, but current revision is ${encounter.revision}`);
  }

  const history = encounter.physicalFile?.handoffHistory || [];
  const pendingIndex = history.map((h, i) => ({ h, i })).reverse().find(({ h }) => h.status === "pending")?.i;

  if (pendingIndex === undefined || pendingIndex === -1) {
    throw accessError(409, "No pending file handoff to accept");
  }

  const pending = history[pendingIndex];
  const callerId = String(actor?._id || actor?.id || "");

  if (String(pending.toActorId) !== callerId) {
    throw accessError(403, "Only the designated recipient can accept file custody");
  }

  let locationRecord = null;
  if (locationId) {
    locationRecord = await HospitalLocation.findOne({
      _id: locationId,
      hospitalId: encounter.hospitalId,
      $or: [{ status: "active" }, { isActive: true }],
    }).lean();
    if (!locationRecord) {
      throw accessError(400, "Destination location not found, inactive, or belongs to another hospital");
    }
  }

  const targetLocationId = locationRecord?._id || pending.toLocationId;
  const targetLocationName = locationRecord ? locationRecord.name : pending.toLocationName || "not recorded";

  pending.status = "acknowledged";
  pending.acknowledgedAt = new Date();
  pending.toLocationId = targetLocationId;
  pending.toLocationName = targetLocationName;

  // CUSTODY TRANSFERS TO RECIPIENT
  encounter.physicalFile.currentHolderId = actor?._id || actor?.id;
  encounter.physicalFile.currentHolderRole = actor?.role || "STAFF";
  encounter.physicalFile.currentHolderName = actor?.name || "Staff Member";
  encounter.physicalFile.locationId = targetLocationId;
  encounter.physicalFile.locationName = targetLocationName;
  encounter.physicalFile.lastHandoffAt = new Date();

  encounter.revision = (encounter.revision || 0) + 1;
  await encounter.save();
  return encounter;
};

export const refusePhysicalFileHandoff = async ({
  encounterId,
  hospitalId,
  actor,
  reason,
  expectedRevision,
}) => {
  if (process.env.REQUIRE_CLINICAL_SCHEMA === "true") {
    await assertClinicalWorkflowReady({ workflow: "encounter" });
  }

  if (typeof expectedRevision !== "number") {
    throw accessError(400, "expectedRevision is required and must be a number");
  }
  if (!reason || !reason.trim()) {
    throw accessError(400, "Refusal reason is required");
  }

  const encounter = await EncounterJourney.findById(encounterId);
  if (!encounter) throw accessError(404, "Encounter journey not found");
  if (hospitalId && String(encounter.hospitalId) !== String(hospitalId)) {
    throw accessError(403, "You do not have permission for this hospital's encounter");
  }

  if (encounter.revision !== expectedRevision) {
    throw accessError(409, `Encounter revision conflict. Expected ${expectedRevision}, but current revision is ${encounter.revision}`);
  }

  const history = encounter.physicalFile?.handoffHistory || [];
  const pendingIndex = history.map((h, i) => ({ h, i })).reverse().find(({ h }) => h.status === "pending")?.i;

  if (pendingIndex === undefined || pendingIndex === -1) {
    throw accessError(409, "No pending file handoff to refuse");
  }

  const pending = history[pendingIndex];
  const callerId = String(actor?._id || actor?.id || "");
  const isAdmin = actor?.role === "HOSPITAL_ADMIN" || Boolean(actor?.adminAccess);

  if (String(pending.toActorId) !== callerId && !isAdmin) {
    throw accessError(403, "Only the designated recipient can refuse file custody");
  }

  pending.status = "refused";
  pending.refusedAt = new Date();
  pending.reason = reason.trim();

  // CUSTODY REMAINS UNCHANGED WITH ORIGINAL HOLDER
  encounter.revision = (encounter.revision || 0) + 1;
  await encounter.save();
  return encounter;
};

export const getCustodyWorklist = async ({ hospitalId, staffId }) => {
  if (!hospitalId || !staffId) throw accessError(400, "hospitalId and staffId are required");

  const encounters = await EncounterJourney.find({
    hospitalId,
    currentStage: { $nin: ["completed", "cancelled"] },
    $or: [
      { "physicalFile.currentHolderId": staffId },
      { "physicalFile.handoffHistory": { $elemMatch: { status: "pending", toActorId: staffId } } },
      { "physicalFile.handoffHistory": { $elemMatch: { status: "pending", fromActorId: staffId } } },
    ],
  }).lean();

  const incoming = [];
  const outgoing = [];
  const held = [];

  for (const enc of encounters) {
    const file = enc.physicalFile;
    if (!file) continue;

    const pending = (file.handoffHistory || []).slice().reverse().find((h) => h.status === "pending");

    if (pending && String(pending.toActorId) === String(staffId)) {
      incoming.push({
        encounterId: enc._id,
        ticketNumber: enc.ticketNumber,
        currentStage: enc.currentStage,
        revision: enc.revision,
        fileBarcode: file.fileBarcode,
        fromActorName: pending.fromActorName,
        fromActorRole: pending.fromActorRole,
        toLocationName: pending.toLocationName,
        timestamp: pending.timestamp,
        reason: pending.reason,
      });
    }

    if (pending && String(pending.fromActorId) === String(staffId)) {
      outgoing.push({
        encounterId: enc._id,
        ticketNumber: enc.ticketNumber,
        currentStage: enc.currentStage,
        revision: enc.revision,
        fileBarcode: file.fileBarcode,
        toActorName: pending.toActorName,
        toActorRole: pending.toActorRole,
        toLocationName: pending.toLocationName,
        timestamp: pending.timestamp,
        reason: pending.reason,
      });
    }

    if (String(file.currentHolderId) === String(staffId)) {
      held.push({
        encounterId: enc._id,
        ticketNumber: enc.ticketNumber,
        currentStage: enc.currentStage,
        revision: enc.revision,
        fileBarcode: file.fileBarcode,
        locationName: file.locationName,
        lastHandoffAt: file.lastHandoffAt,
        hasPendingOutgoing: Boolean(pending && String(pending.fromActorId) === String(staffId)),
      });
    }
  }

  return { incoming, outgoing, held };
};

export const getEncounterCustodyDetails = async ({ encounterId, hospitalId }) => {
  const encounter = await EncounterJourney.findById(encounterId).lean();
  if (!encounter) throw accessError(404, "Encounter journey not found");
  if (hospitalId && String(encounter.hospitalId) !== String(hospitalId)) {
    throw accessError(403, "You do not have permission for this hospital's encounter");
  }

  const file = encounter.physicalFile || {};
  const pendingHandoff = (file.handoffHistory || []).slice().reverse().find((h) => h.status === "pending") || null;

  return {
    encounterId: encounter._id,
    ticketNumber: encounter.ticketNumber,
    currentStage: encounter.currentStage,
    revision: encounter.revision,
    physicalFile: {
      hasPhysicalFile: Boolean(file.hasPhysicalFile),
      fileBarcode: file.fileBarcode,
      currentHolderId: file.currentHolderId,
      currentHolderName: file.currentHolderName || "not recorded",
      currentHolderRole: file.currentHolderRole || "not recorded",
      locationId: file.locationId,
      locationName: file.locationName || "not recorded",
      lastHandoffAt: file.lastHandoffAt,
      pendingHandoff,
      handoffHistory: file.handoffHistory || [],
    },
  };
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

  const pendingHandoff = (encounter.physicalFile?.handoffHistory || []).slice().reverse().find((h) => h.status === "pending");

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
      fileBarcode: encounter.physicalFile?.fileBarcode,
      holderId: encounter.physicalFile?.currentHolderId,
      holder: encounter.physicalFile?.currentHolderName || "not recorded",
      holderRole: encounter.physicalFile?.currentHolderRole || "not recorded",
      location: encounter.physicalFile?.locationName || "not recorded",
      pendingHandoff: pendingHandoff
        ? {
            fromActorName: pendingHandoff.fromActorName,
            toActorId: pendingHandoff.toActorId,
            toActorName: pendingHandoff.toActorName,
            status: "pending",
          }
        : null,
    },
    isWalkIn: encounter.isWalkIn,
    isLinked: Boolean(encounter.linkedUserId),
    qrPayload: encounter.qrPayload,
    revision: encounter.revision,
    updatedAt: encounter.updatedAt,
  };
};
