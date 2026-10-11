import HospitalLocation from "../model/hospitalLocation.js";
import EncounterJourney from "../model/encounterJourney.js";
import {
  initializeEncounterJourney,
  transitionEncounterStage,
  handoffPhysicalFile,
  refusePhysicalFileHandoff,
  linkWalkInToAccount,
  getEncounterGuidance,
} from "../services/encounterJourneyService.js";
import { accessError } from "../services/hospitalAccess.js";

export const getGuidance = async (req, res) => {
  const { id } = req.params;
  const isObjectId = id.length === 24;

  let guidance;
  if (isObjectId) {
    try {
      guidance = await getEncounterGuidance({ encounterId: id });
    } catch {
      guidance = await getEncounterGuidance({ tokenId: id });
    }
  } else {
    guidance = await getEncounterGuidance({ tokenId: id });
  }

  // Tenant / Patient access guard
  if (req.staff) {
    if (guidance.hospitalId && String(req.staff.hospitalId) !== String(guidance.hospitalId)) {
      return res.status(403).json({ message: "You cannot access encounters from another hospital" });
    }
  } else if (req.auth) {
    if (guidance.patientId && String(req.auth.id) !== String(guidance.patientId)) {
      return res.status(403).json({ message: "You cannot view guidance for another patient's encounter" });
    }
  }

  res.json({ guidance });
};

export const transitionStage = async (req, res) => {
  const { id } = req.params;
  const { toStage, locationId, notes, overrideReason } = req.body;

  if (!toStage) throw accessError(400, "Target stage is required");

  const encounter = await transitionEncounterStage({
    encounterId: id,
    hospitalId: req.staff?.hospitalId,
    toStage,
    actor: req.staff || req.user,
    locationId,
    notes,
    overrideReason,
  });

  res.json({ message: `Encounter transitioned to ${toStage}`, encounter });
};

export const handoffFile = async (req, res) => {
  const { id } = req.params;
  const { toActorId, toActorName, toActorRole, locationId, reason, acknowledged = true } = req.body;

  if (!toActorId) throw accessError(400, "Target recipient actor ID is required");

  const encounter = await handoffPhysicalFile({
    encounterId: id,
    hospitalId: req.staff?.hospitalId,
    fromActor: req.staff,
    toActor: { id: toActorId, name: toActorName, role: toActorRole },
    locationId,
    reason,
    acknowledged,
  });

  res.json({ message: "Physical file handoff recorded", physicalFile: encounter.physicalFile });
};

export const refuseHandoff = async (req, res) => {
  const { id } = req.params;
  const { reason = "Refused by recipient" } = req.body;

  const encounter = await refusePhysicalFileHandoff({
    encounterId: id,
    hospitalId: req.staff?.hospitalId,
    actor: req.staff,
    reason,
  });

  res.json({ message: "File handoff refused", physicalFile: encounter.physicalFile });
};

export const linkWalkIn = async (req, res) => {
  const { id } = req.params;
  const userId = req.auth?.id || req.user?._id;

  if (!userId) throw accessError(401, "Sign in is required to link a visit");

  const encounter = await linkWalkInToAccount({
    encounterId: id,
    userId,
    claimPhone: req.body.phone,
  });

  res.json({ message: "Walk-in ticket linked to account successfully", encounter });
};

export const getTicket = async (req, res) => {
  const { id } = req.params;
  const encounter = await EncounterJourney.findById(id).lean();
  if (!encounter) throw accessError(404, "Encounter not found");

  if (req.staff) {
    if (encounter.hospitalId && String(req.staff.hospitalId) !== String(encounter.hospitalId)) {
      return res.status(403).json({ message: "You cannot access tickets from another hospital" });
    }
  } else if (req.auth) {
    if (encounter.patientId && String(req.auth.id) !== String(encounter.patientId)) {
      return res.status(403).json({ message: "You cannot view another patient's ticket" });
    }
  }

  res.json({
    ticket: {
      ticketNumber: encounter.ticketNumber,
      qrPayload: encounter.qrPayload,
      hospitalId: encounter.hospitalId,
      departmentId: encounter.departmentId,
      stage: encounter.currentStage,
      destination: encounter.currentDestination,
      issuedAt: encounter.createdAt,
      isWalkIn: encounter.isWalkIn,
    },
  });
};

// Hospital Location Controller
export const getLocations = async (req, res) => {
  const { id: hospitalId } = req.params;
  const { departmentId, serviceType } = req.query;

  const filter = { hospitalId, status: "active" };
  if (departmentId) filter.departmentId = departmentId;
  if (serviceType) filter.serviceType = serviceType;

  const locations = await HospitalLocation.find(filter).sort({ building: 1, floor: 1, roomNumber: 1 });
  res.json({ locations });
};

export const createLocation = async (req, res) => {
  const { id: hospitalId } = req.params;
  if (req.staff && String(req.staff.hospitalId) !== String(hospitalId)) {
    throw accessError(403, "You cannot create locations for another hospital");
  }

  const { name, type, building, floor, roomNumber, departmentId, serviceType, instructions } = req.body;

  if (!name) throw accessError(400, "Location name is required");

  const location = new HospitalLocation({
    hospitalId,
    name,
    type: type || "room",
    building,
    floor,
    roomNumber,
    departmentId,
    serviceType: serviceType || "consultation",
    instructions: instructions || "",
  });

  await location.save();
  res.status(201).json({ message: "Hospital location registered", location });
};
