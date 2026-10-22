import asyncHandler from "../middleware/asyncHandler.js";
import {
  createInpatientOrder,
  discontinueInpatientOrder,
  recordNursingVitals,
  administerMedication,
  recordMedicationOmission,
  recordShiftHandover,
  getInpatientFlowsheet,
  getShiftHandovers,
  getInpatientOrders,
  getNursingVitals,
  getEmarSchedule,
} from "../services/nursingCareService.js";

export const createInpatientOrderHandler = asyncHandler(async (req, res) => {
  const result = await createInpatientOrder({
    hospitalId: req.staff.hospitalId,
    admissionId: req.body.admissionId,
    patientId: req.body.patientId,
    orderType: req.body.orderType,
    medicationDetails: req.body.medicationDetails,
    nursingInstructions: req.body.nursingInstructions,
    startDate: req.body.startDate,
    prescribedByDoctorId: req.body.prescribedByDoctorId,
    actor: {
      staffId: req.staff.id,
      doctorId: req.body.prescribedByDoctorId || req.staff.doctorId || req.staff.id,
      role: req.staff.role,
      name: req.staff.name,
    },
  });
  res.status(201).json(result);
});

export const discontinueInpatientOrderHandler = asyncHandler(async (req, res) => {
  const result = await discontinueInpatientOrder({
    hospitalId: req.staff.hospitalId,
    orderId: req.params.orderId,
    reason: req.body.reason,
    actor: {
      staffId: req.staff.id,
      doctorId: req.staff.doctorId || req.staff.id,
      role: req.staff.role,
      name: req.staff.name,
    },
  });
  res.json(result);
});

export const recordNursingVitalsHandler = asyncHandler(async (req, res) => {
  const vitalsPayload = req.body.vitals || req.body;
  const result = await recordNursingVitals({
    hospitalId: req.staff.hospitalId,
    admissionId: req.params.admissionId,
    vitals: vitalsPayload,
    actor: {
      staffId: req.staff.id,
      role: req.staff.role,
      name: req.staff.name,
    },
  });
  res.status(201).json(result);
});

export const administerMedicationHandler = asyncHandler(async (req, res) => {
  const result = await administerMedication({
    hospitalId: req.staff.hospitalId,
    emarId: req.params.emarId,
    fiveRightsVerified: req.body.fiveRightsVerified,
    dualWitnessStaffId: req.body.dualWitnessStaffId,
    dualWitnessSignature: req.body.dualWitnessSignature,
    injectionSite: req.body.injectionSite,
    actor: {
      staffId: req.staff.id,
      role: req.staff.role,
      name: req.staff.name,
    },
  });
  res.json(result);
});

export const recordMedicationOmissionHandler = asyncHandler(async (req, res) => {
  const result = await recordMedicationOmission({
    hospitalId: req.staff.hospitalId,
    emarId: req.params.emarId,
    omissionReason: req.body.omissionReason,
    omissionNote: req.body.omissionNote,
    actor: {
      staffId: req.staff.id,
      role: req.staff.role,
      name: req.staff.name,
    },
  });
  res.json(result);
});

export const recordShiftHandoverHandler = asyncHandler(async (req, res) => {
  const result = await recordShiftHandover({
    hospitalId: req.staff.hospitalId,
    wardId: req.body.wardId,
    shiftDate: req.body.shiftDate,
    shiftType: req.body.shiftType,
    outgoingNurseStaffId: req.body.outgoingNurseStaffId || req.staff.id,
    incomingNurseStaffId: req.body.incomingNurseStaffId,
    patientSummaries: req.body.patientSummaries,
    codeBlueEvents: req.body.codeBlueEvents,
    handoverNotes: req.body.handoverNotes,
    actor: {
      staffId: req.staff.id,
      role: req.staff.role,
      name: req.staff.name,
    },
  });
  res.status(201).json(result);
});

export const getInpatientFlowsheetHandler = asyncHandler(async (req, res) => {
  const result = await getInpatientFlowsheet({
    hospitalId: req.staff.hospitalId,
    admissionId: req.params.admissionId,
  });
  res.json(result);
});

export const getShiftHandoversHandler = asyncHandler(async (req, res) => {
  const handovers = await getShiftHandovers({
    hospitalId: req.staff.hospitalId,
    wardId: req.query.wardId,
    shiftDate: req.query.shiftDate,
    limit: req.query.limit,
  });
  res.json({ handovers });
});

export const getInpatientOrdersHandler = asyncHandler(async (req, res) => {
  const orders = await getInpatientOrders({
    hospitalId: req.staff.hospitalId,
    admissionId: req.params.admissionId || req.query.admissionId,
    status: req.query.status,
    orderType: req.query.orderType,
  });
  res.json({ orders });
});

export const getNursingVitalsHandler = asyncHandler(async (req, res) => {
  const vitals = await getNursingVitals({
    hospitalId: req.staff.hospitalId,
    admissionId: req.params.admissionId,
    limit: req.query.limit,
  });
  res.json({ vitals });
});

export const getEmarScheduleHandler = asyncHandler(async (req, res) => {
  const emar = await getEmarSchedule({
    hospitalId: req.staff.hospitalId,
    admissionId: req.params.admissionId,
    status: req.query.status,
  });
  res.json({ emar });
});

export default {
  createInpatientOrderHandler,
  discontinueInpatientOrderHandler,
  recordNursingVitalsHandler,
  administerMedicationHandler,
  recordMedicationOmissionHandler,
  recordShiftHandoverHandler,
  getInpatientFlowsheetHandler,
  getShiftHandoversHandler,
  getInpatientOrdersHandler,
  getNursingVitalsHandler,
  getEmarScheduleHandler,
};
