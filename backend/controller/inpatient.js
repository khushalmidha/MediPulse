import asyncHandler from "../middleware/asyncHandler.js";
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
} from "../services/ipdAdtService.js";

export const getWardsHandler = asyncHandler(async (req, res) => {
  const wards = await getWards({
    hospitalId: req.staff.hospitalId,
    activeOnly: req.query.activeOnly !== "false",
  });
  res.json({ wards });
});

export const createWardHandler = asyncHandler(async (req, res) => {
  const ward = await createWard({
    hospitalId: req.staff.hospitalId,
    name: req.body.name,
    code: req.body.code,
    floor: req.body.floor,
    building: req.body.building,
    genderPolicy: req.body.genderPolicy,
    nurseStation: req.body.nurseStation,
    actor: req.staff,
  });
  res.status(201).json({ ward });
});

export const getRoomsHandler = asyncHandler(async (req, res) => {
  const rooms = await getRooms({
    hospitalId: req.staff.hospitalId,
    wardId: req.query.wardId,
  });
  res.json({ rooms });
});

export const createRoomHandler = asyncHandler(async (req, res) => {
  const room = await createRoom({
    hospitalId: req.staff.hospitalId,
    wardId: req.body.wardId,
    roomNumber: req.body.roomNumber,
    roomType: req.body.roomType,
    dailyTariffMinor: req.body.dailyTariffMinor,
    actor: req.staff,
  });
  res.status(201).json({ room });
});

export const getBedsHandler = asyncHandler(async (req, res) => {
  const beds = await getBeds({
    hospitalId: req.staff.hospitalId,
    wardId: req.query.wardId,
    roomId: req.query.roomId,
    status: req.query.status,
  });
  res.json({ beds });
});

export const createBedHandler = asyncHandler(async (req, res) => {
  const bed = await createBed({
    hospitalId: req.staff.hospitalId,
    wardId: req.body.wardId,
    roomId: req.body.roomId,
    bedNumber: req.body.bedNumber,
    actor: req.staff,
  });
  res.status(201).json({ bed });
});

export const updateBedStatusHandler = asyncHandler(async (req, res) => {
  const result = await updateBedStatus({
    hospitalId: req.staff.hospitalId,
    bedId: req.params.bedId,
    targetStatus: req.body.targetStatus || req.body.status,
    reason: req.body.reason || req.body.maintenanceNote,
    actor: req.staff,
  });
  res.json({ success: true, bed: result });
});

export const admitPatientHandler = asyncHandler(async (req, res) => {
  const result = await admitPatient({
    hospitalId: req.staff.hospitalId,
    patientId: req.body.patientId,
    familyMemberId: req.body.familyMemberId,
    encounterJourneyId: req.body.encounterJourneyId,
    admittingDoctorId: req.body.admittingDoctorId || req.staff.id,
    attendingDoctorId: req.body.attendingDoctorId,
    primaryNurseId: req.body.primaryNurseId,
    departmentId: req.body.departmentId,
    bedId: req.body.bedId,
    admittingDiagnosis: req.body.admittingDiagnosis,
    isMlc: req.body.isMlc,
    advanceDepositMinor: req.body.advanceDepositMinor,
    estimatedLengthOfStayDays: req.body.estimatedLengthOfStayDays,
    actor: req.staff,
  });
  res.status(201).json(result);
});

export const transferBedHandler = asyncHandler(async (req, res) => {
  const result = await transferBed({
    hospitalId: req.staff.hospitalId,
    admissionId: req.params.admissionId,
    targetBedId: req.body.targetBedId,
    transferReason: req.body.transferReason,
    actor: req.staff,
  });
  res.json(result);
});

export const recordClearanceHandler = asyncHandler(async (req, res) => {
  const { clearanceType } = req.body;
  if (clearanceType === "medical" && !["DOCTOR", "DEPARTMENT_HEAD"].includes(req.staff.role)) {
    return res.status(403).json({ message: "Only medical doctors or clinical department heads can issue medical clearance; administrative access cannot authorize clinical discharge" });
  }
  if (clearanceType === "pharmacy" && req.staff.role !== "PHARMACIST") {
    return res.status(403).json({ message: "Only licensed pharmacy staff can issue pharmacy clearance" });
  }
  if (
    clearanceType === "finance" &&
    req.staff.role !== "RECEPTIONIST" &&
    req.staff.role !== "HOSPITAL_ADMIN" &&
    !req.staff.adminAccess
  ) {
    return res.status(403).json({ message: "Only billing/reception staff or hospital admins can issue finance clearance" });
  }

  const result = await recordDischargeClearance({
    hospitalId: req.staff.hospitalId,
    admissionId: req.params.admissionId,
    clearanceType,
    actor: req.staff,
  });
  res.json(result);
});

export const finalizeDischargeHandler = asyncHandler(async (req, res) => {
  const result = await finalizeDischarge({
    hospitalId: req.staff.hospitalId,
    admissionId: req.params.admissionId,
    dischargeSummary: req.body.dischargeSummary,
    actor: req.staff,
  });
  res.json(result);
});

export const getInpatientTimelineHandler = asyncHandler(async (req, res) => {
  const timeline = await getInpatientTimeline({
    hospitalId: req.staff.hospitalId,
    admissionId: req.params.admissionId,
  });
  res.json({ timeline });
});
