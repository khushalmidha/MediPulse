import asyncHandler from "../middleware/asyncHandler.js";
import {
  registerEmergencyPatient,
  getEmergencyRegistrations,
  getEmergencyRegistrationById,
  updateEmergencyStatus,
  createTheatreRoom,
  getTheatreRooms,
  bookTheatreCase,
  cancelTheatreCase,
  getOtSchedules,
  getOtScheduleById,
  recordWhoChecklistStage,
  recordPacuRecovery,
} from "../services/emergencyTheatreService.js";

const getHospitalId = (req) => {
  return req.staff?.hospitalId || req.hospitalContext?.hospitalId;
};

const getActor = (req) => {
  return {
    staffId: req.staff?.id,
    doctorId: req.staff?.doctorId || (req.staff?.role === "DOCTOR" ? req.staff?.id : null),
    role: req.staff?.role,
    name: req.staff?.name,
    email: req.staff?.email,
  };
};

export const registerEmergencyPatientHandler = asyncHandler(async (req, res) => {
  const result = await registerEmergencyPatient({
    hospitalId: getHospitalId(req),
    patientId: req.body.patientId || null,
    patientName: req.body.patientName,
    age: req.body.age,
    gender: req.body.gender,
    arrivalMode: req.body.arrivalMode,
    triageLevel: req.body.triageLevel,
    chiefComplaint: req.body.chiefComplaint,
    assignedBay: req.body.assignedBay,
    actor: getActor(req),
  });
  res.status(201).json(result);
});

export const getEmergencyRegistrationsHandler = asyncHandler(async (req, res) => {
  const result = await getEmergencyRegistrations({
    hospitalId: getHospitalId(req),
    status: req.query.status,
    triageLevel: req.query.triageLevel,
    search: req.query.search,
    limit: req.query.limit,
    page: req.query.page,
  });
  res.json(result);
});

export const getEmergencyRegistrationByIdHandler = asyncHandler(async (req, res) => {
  const registration = await getEmergencyRegistrationById({
    hospitalId: getHospitalId(req),
    emergencyRegistrationId: req.params.id,
  });
  res.json({ success: true, registration });
});

export const updateEmergencyStatusHandler = asyncHandler(async (req, res) => {
  const result = await updateEmergencyStatus({
    hospitalId: getHospitalId(req),
    emergencyRegistrationId: req.params.id,
    status: req.body.status,
    attendingDoctorId: req.body.attendingDoctorId,
    assignedBay: req.body.assignedBay,
    outcomeNotes: req.body.outcomeNotes,
    linkedAdmissionId: req.body.linkedAdmissionId,
    actor: getActor(req),
  });
  res.json(result);
});

export const createTheatreRoomHandler = asyncHandler(async (req, res) => {
  const room = await createTheatreRoom({
    hospitalId: getHospitalId(req),
    theatreCode: req.body.theatreCode,
    theatreName: req.body.theatreName,
    theatreType: req.body.theatreType,
    actor: getActor(req),
  });
  res.status(201).json({ success: true, room });
});

export const getTheatreRoomsHandler = asyncHandler(async (req, res) => {
  const rooms = await getTheatreRooms({
    hospitalId: getHospitalId(req),
  });
  res.json({ success: true, rooms });
});

export const bookTheatreCaseHandler = asyncHandler(async (req, res) => {
  const actor = getActor(req);
  const result = await bookTheatreCase({
    hospitalId: getHospitalId(req),
    theatreRoomId: req.body.theatreRoomId,
    patientId: req.body.patientId,
    admissionId: req.body.admissionId || null,
    emergencyRegistrationId: req.body.emergencyRegistrationId || null,
    leadSurgeonDoctorId: req.body.leadSurgeonDoctorId || actor.doctorId,
    anesthetistDoctorId: req.body.anesthetistDoctorId,
    scrubNurseStaffId: req.body.scrubNurseStaffId || null,
    procedureName: req.body.procedureName,
    urgency: req.body.urgency || "elective",
    scheduledStartTime: req.body.scheduledStartTime,
    scheduledEndTime: req.body.scheduledEndTime,
    actor,
  });
  res.status(201).json(result);
});

export const cancelTheatreCaseHandler = asyncHandler(async (req, res) => {
  const result = await cancelTheatreCase({
    hospitalId: getHospitalId(req),
    bookingId: req.params.bookingId || req.params.id,
    reason: req.body.reason,
    actor: getActor(req),
  });
  res.json(result);
});

export const getOtSchedulesHandler = asyncHandler(async (req, res) => {
  const result = await getOtSchedules({
    hospitalId: getHospitalId(req),
    date: req.query.date,
    theatreRoomId: req.query.theatreRoomId,
    leadSurgeonDoctorId: req.query.leadSurgeonDoctorId,
    status: req.query.status,
  });
  res.json(result);
});

export const getOtScheduleByIdHandler = asyncHandler(async (req, res) => {
  const booking = await getOtScheduleById({
    hospitalId: getHospitalId(req),
    bookingId: req.params.bookingId || req.params.id,
  });
  res.json({ success: true, booking });
});

export const recordWhoChecklistStageHandler = asyncHandler(async (req, res) => {
  const stage = req.body.stage;
  const actor = getActor(req);

  // Time Out specifically requires Doctor role (Surgeon)
  if (stage === "timeOut" && req.staff.role !== "DOCTOR" && req.staff.role !== "HOSPITAL_ADMIN") {
    return res.status(403).json({
      error: "WHO Surgical Safety Checklist Time Out must be verified by an operating surgeon (DOCTOR role)",
    });
  }

  const result = await recordWhoChecklistStage({
    hospitalId: getHospitalId(req),
    bookingId: req.params.bookingId || req.params.id,
    stage: req.body.stage,
    checkpoints: req.body.checkpoints,
    actor,
  });
  res.json(result);
});

export const recordPacuRecoveryHandler = asyncHandler(async (req, res) => {
  const result = await recordPacuRecovery({
    hospitalId: getHospitalId(req),
    bookingId: req.params.bookingId || req.params.id,
    aldreteScore: req.body.aldreteScore,
    dischargedToWard: req.body.dischargedToWard,
    actor: getActor(req),
  });
  res.json(result);
});

export default {
  registerEmergencyPatientHandler,
  getEmergencyRegistrationsHandler,
  getEmergencyRegistrationByIdHandler,
  updateEmergencyStatusHandler,
  createTheatreRoomHandler,
  getTheatreRoomsHandler,
  bookTheatreCaseHandler,
  cancelTheatreCaseHandler,
  getOtSchedulesHandler,
  getOtScheduleByIdHandler,
  recordWhoChecklistStageHandler,
  recordPacuRecoveryHandler,
};
