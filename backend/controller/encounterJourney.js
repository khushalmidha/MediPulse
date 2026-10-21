import HospitalLocation from "../model/hospitalLocation.js";
import Hospital from "../model/hospital.js";
import EncounterJourney from "../model/encounterJourney.js";
import Department from "../model/department.js";
import { assertTenantNotSuspended } from "../services/saasOperationsService.js";
import {
  initializeEncounterJourney,
  transitionEncounterStage,
  registerPhysicalFile,
  handoffPhysicalFile,
  acceptPhysicalFileHandoff,
  refusePhysicalFileHandoff,
  getCustodyWorklist,
  getEncounterCustodyDetails,
  linkWalkInToAccount,
  requestClaimOtp,
  verifyClaimOtp,
  getEncounterGuidance,
} from "../services/encounterJourneyService.js";
import { accessError, requireRecordId } from "../services/hospitalAccess.js";

export const getGuidance = async (req, res) => {
  if (!req.encounter) throw accessError(403, "Encounter authorization is required");
  const guidance = await getEncounterGuidance({ encounterId: req.encounter._id });
  if (!req.staff) {
    guidance.physicalFile = { tracked: guidance.physicalFile.tracked, location: guidance.physicalFile.location };
    delete guidance.qrPayload;
  }
  res.json({ guidance });
};

export const transitionStage = async (req, res) => {
  const { id } = req.params;
  const { toStage, locationId, notes, overrideReason, expectedRevision } = req.body;

  if (!toStage) throw accessError(400, "Target stage is required");

  const encounter = await transitionEncounterStage({
    encounterId: id,
    hospitalId: req.staff?.hospitalId,
    toStage,
    actor: req.staff || req.user,
    locationId,
    notes,
    overrideReason,
    expectedRevision,
  });

  res.json({ message: `Encounter transitioned to ${toStage}`, encounter });
};

export const registerFile = async (req, res) => {
  const { id } = req.params;
  const { fileBarcode, locationId, reason } = req.body;

  const encounter = await registerPhysicalFile({
    encounterId: id,
    hospitalId: req.staff?.hospitalId,
    actor: req.staff,
    fileBarcode,
    locationId,
    reason,
  });

  res.json({ message: "Physical file registered successfully", physicalFile: encounter.physicalFile });
};

export const handoffFile = async (req, res) => {
  const { id } = req.params;
  const { toActorId, locationId, reason, expectedRevision } = req.body;

  const encounter = await handoffPhysicalFile({
    encounterId: id,
    hospitalId: req.staff?.hospitalId,
    fromActor: req.staff,
    toActorId,
    locationId,
    reason,
    expectedRevision,
  });

  res.json({ message: "Physical file handoff initiated", physicalFile: encounter.physicalFile });
};

export const acceptHandoff = async (req, res) => {
  const { id } = req.params;
  const { locationId, expectedRevision } = req.body;

  const encounter = await acceptPhysicalFileHandoff({
    encounterId: id,
    hospitalId: req.staff?.hospitalId,
    actor: req.staff,
    locationId,
    expectedRevision,
  });

  res.json({ message: "Physical file custody accepted", physicalFile: encounter.physicalFile });
};

export const refuseHandoff = async (req, res) => {
  const { id } = req.params;
  const { reason, expectedRevision } = req.body;

  const encounter = await refusePhysicalFileHandoff({
    encounterId: id,
    hospitalId: req.staff?.hospitalId,
    actor: req.staff,
    reason,
    expectedRevision,
  });

  res.json({ message: "File handoff refused", physicalFile: encounter.physicalFile });
};

export const getCustodyWorklistController = async (req, res) => {
  const worklist = await getCustodyWorklist({
    hospitalId: req.staff?.hospitalId,
    staffId: req.staff?.id,
  });
  res.json({ worklist });
};

export const getCustodyDetails = async (req, res) => {
  const { id } = req.params;
  const details = await getEncounterCustodyDetails({
    encounterId: id,
    hospitalId: req.staff?.hospitalId,
  });
  res.json(details);
};

export const requestClaimChallenge = async (req, res) => {
  const { id } = req.params;
  const userId = req.auth?.id || req.user?._id;
  if (!userId) throw accessError(401, "Sign in is required to request claim challenge");

  const result = await requestClaimOtp({
    encounterId: id,
    userId,
    phone: req.body.phone,
    familyMemberId: req.body.familyMemberId,
  });

  res.json(result);
};

export const verifyClaimChallenge = async (req, res) => {
  const { id } = req.params;
  const userId = req.auth?.id || req.user?._id;
  if (!userId) throw accessError(401, "Sign in is required to verify claim");

  const result = await verifyClaimOtp({
    encounterId: id,
    userId,
    otp: req.body.otp,
  });

  res.json(result);
};

export const linkWalkIn = async (req, res) => {
  const { id } = req.params;
  const userId = req.auth?.id || req.user?._id;

  if (!userId) throw accessError(401, "Sign in is required to link a visit");

  const claimProof = req.body.claimProof || req.body.proof;
  const result = await linkWalkInToAccount({
    encounterId: id,
    userId,
    claimProof,
    familyMemberId: req.body.familyMemberId,
  });

  const encounter = result?.encounter || result;
  const isReplay = Boolean(result?.isReplay);

  res.json({
    message: isReplay
      ? "Walk-in ticket already linked to your account"
      : "Walk-in ticket linked to account successfully",
    encounter,
    isReplay,
  });
};

export const getTicket = async (req, res) => {
  const encounter = req.encounter;
  if (!encounter) throw accessError(403, "Encounter authorization is required");

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

export const resolveScannedTicket = async (req, res) => {
  const code = (req.params.qrPayload || req.query.qrPayload || req.body?.qrPayload || req.body?.code || req.query.code || "").trim();
  if (!code) throw accessError(400, "Scanner QR payload or ticket code is required");

  const payload = code.replace(/^MP-TKT:/i, "").trim();

  const filter = {
    $or: [
      { qrPayload: payload },
      { ticketNumber: payload },
    ],
  };

  const encounter = await EncounterJourney.findOne(filter)
    .populate("departmentId", "name code")
    .populate("hospitalId", "name slug")
    .lean();

  if (!encounter) throw accessError(404, "Invalid or unrecognized ticket QR code");

  // A public bearer scanner must NEVER expose patient details (PII)
  if (!req.staff && !req.auth) {
    return res.status(200).json({
      verified: true,
      ticketNumber: encounter.ticketNumber,
      stage: encounter.currentStage,
      destination: encounter.currentDestination?.name || "not recorded",
      hospitalId: encounter.hospitalId?._id || encounter.hospitalId,
      hospitalName: encounter.hospitalId?.name || "Hospital Network",
      issuedAt: encounter.createdAt,
      isWalkIn: encounter.isWalkIn,
    });
  }

  // Authenticated hospital staff: verify hospital scope
  if (req.staff) {
    const staffHospitalId = req.staff.hospitalId;
    const encounterHospitalId = encounter.hospitalId?._id || encounter.hospitalId;
    if (staffHospitalId && String(staffHospitalId) !== String(encounterHospitalId)) {
      throw accessError(403, "You cannot access tickets from another hospital");
    }

    return res.status(200).json({
      verified: true,
      encounterId: encounter._id,
      tokenId: encounter.tokenId,
      appointmentId: encounter.appointmentId,
      ticketNumber: encounter.ticketNumber,
      qrPayload: encounter.qrPayload,
      stage: encounter.currentStage,
      destination: encounter.currentDestination,
      department: encounter.departmentId,
      hospital: encounter.hospitalId,
      physicalFile: encounter.physicalFile,
      isWalkIn: encounter.isWalkIn,
      issuedAt: encounter.createdAt,
      patientId: encounter.patientId,
      familyMemberId: encounter.familyMemberId,
    });
  }

  // Authenticated patient: verify patient ownership
  if (req.auth) {
    if (encounter.patientId && String(req.auth.id) !== String(encounter.patientId)) {
      throw accessError(403, "You cannot access another patient's ticket");
    }

    return res.status(200).json({
      verified: true,
      encounterId: encounter._id,
      ticketNumber: encounter.ticketNumber,
      qrPayload: encounter.qrPayload,
      stage: encounter.currentStage,
      destination: encounter.currentDestination,
      department: encounter.departmentId,
      hospital: encounter.hospitalId,
      isWalkIn: encounter.isWalkIn,
      issuedAt: encounter.createdAt,
    });
  }
};

// Hospital Location Controller
export const getLocations = async (req, res) => {
  const { id: hospitalId } = req.params;
  const { departmentId, serviceType, includeInactive, status } = req.query;

  const filter = { hospitalId };
  if (status) {
    filter.status = status;
  } else if (includeInactive !== "true") {
    filter.status = "active";
  }
  if (departmentId) filter.departmentId = departmentId;
  if (serviceType) filter.serviceType = serviceType;

  const locations = await HospitalLocation.find(filter)
    .populate("departmentId", "name code")
    .sort({ building: 1, floor: 1, roomNumber: 1, name: 1 })
    .lean();
  res.json({ locations });
};

export const createLocation = async (req, res) => {
  const { id: hospitalId } = req.params;
  if (req.staff && String(req.staff.hospitalId) !== String(hospitalId)) {
    throw accessError(403, "You cannot create locations for another hospital");
  }
  if (!req.staff?.adminAccess && req.staff?.role !== "HOSPITAL_ADMIN") {
    throw accessError(403, "Hospital admin access is required to register locations");
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);

  const { name, type, building, floor, roomNumber, departmentId, serviceType, instructions, status } = req.body;

  if (!name || !name.trim()) throw accessError(400, "Location name is required");

  if (departmentId) {
    requireRecordId(departmentId, "department");
    const dept = await Department.findOne({ _id: departmentId, hospitalId });
    if (!dept) throw accessError(400, "Department does not belong to this hospital");
  }

  const validServiceTypes = ["reception", "registration", "vitals", "consultation", "lab", "pharmacy", "billing", "other"];
  if (serviceType && !validServiceTypes.includes(serviceType)) {
    throw accessError(400, `Invalid service type: ${serviceType}`);
  }

  const location = new HospitalLocation({
    hospitalId,
    name: name.trim(),
    type: type || "room",
    building: building?.trim(),
    floor: floor?.trim(),
    roomNumber: roomNumber?.trim(),
    departmentId: departmentId || undefined,
    serviceType: serviceType || "consultation",
    instructions: instructions?.trim() || "",
    status: status === "inactive" ? "inactive" : "active",
  });

  await location.save();
  res.status(201).json({ message: "Hospital location registered", location });
};

export const updateLocation = async (req, res) => {
  const { id: hospitalId, locationId } = req.params;
  if (req.staff && String(req.staff.hospitalId) !== String(hospitalId)) {
    throw accessError(403, "You cannot modify locations for another hospital");
  }
  if (!req.staff?.adminAccess && req.staff?.role !== "HOSPITAL_ADMIN") {
    throw accessError(403, "Hospital admin access is required to update locations");
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");
  assertTenantNotSuspended(hospital);

  requireRecordId(locationId, "location");
  const location = await HospitalLocation.findOne({ _id: locationId, hospitalId });
  if (!location) throw accessError(404, "Hospital location not found");

  const { name, type, building, floor, roomNumber, departmentId, serviceType, instructions, status } = req.body;

  if (name !== undefined) {
    if (!name.trim()) throw accessError(400, "Location name cannot be empty");
    location.name = name.trim();
  }
  if (departmentId !== undefined) {
    if (departmentId) {
      requireRecordId(departmentId, "department");
      const dept = await Department.findOne({ _id: departmentId, hospitalId });
      if (!dept) throw accessError(400, "Department does not belong to this hospital");
      location.departmentId = departmentId;
    } else {
      location.departmentId = undefined;
    }
  }
  if (serviceType !== undefined) {
    const validServiceTypes = ["reception", "registration", "vitals", "consultation", "lab", "pharmacy", "billing", "other"];
    if (!validServiceTypes.includes(serviceType)) {
      throw accessError(400, `Invalid service type: ${serviceType}`);
    }
    location.serviceType = serviceType;
  }
  if (type !== undefined) location.type = type;
  if (building !== undefined) location.building = building.trim();
  if (floor !== undefined) location.floor = floor.trim();
  if (roomNumber !== undefined) location.roomNumber = roomNumber.trim();
  if (instructions !== undefined) location.instructions = instructions.trim();
  if (status !== undefined) {
    if (!["active", "inactive"].includes(status)) throw accessError(400, "Status must be active or inactive");
    location.status = status;
  }

  await location.save();
  res.json({ message: "Hospital location updated", location });
};
