import { Router } from "express";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";
import {
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
} from "../controller/nursingCare.js";

const nursingRouter = Router();
nursingRouter.use(nosqlGuard);

// Clinician Orders: Doctors & Hospital Admins
nursingRouter.post("/orders", validateStaff, requireRole("DOCTOR", "HOSPITAL_ADMIN"), createInpatientOrderHandler);
nursingRouter.get("/orders", validateStaff, getInpatientOrdersHandler);
nursingRouter.post("/orders/:orderId/discontinue", validateStaff, requireRole("DOCTOR", "HOSPITAL_ADMIN"), discontinueInpatientOrderHandler);

// Vitals & NEWS2: Nurses & Hospital Admins
nursingRouter.post("/admissions/:admissionId/vitals", validateStaff, requireRole("NURSE", "HOSPITAL_ADMIN"), recordNursingVitalsHandler);
nursingRouter.get("/admissions/:admissionId/vitals", validateStaff, getNursingVitalsHandler);

// Bedside Medication Administration (eMAR): Nurses only
nursingRouter.post("/emar/:emarId/administer", validateStaff, requireRole("NURSE"), administerMedicationHandler);
nursingRouter.post("/emar/:emarId/omit", validateStaff, requireRole("NURSE", "DOCTOR", "HOSPITAL_ADMIN"), recordMedicationOmissionHandler);
nursingRouter.get("/admissions/:admissionId/emar", validateStaff, getEmarScheduleHandler);

// Shift Handovers: Nurses & Hospital Admins
nursingRouter.post("/handover", validateStaff, requireRole("NURSE", "HOSPITAL_ADMIN"), recordShiftHandoverHandler);
nursingRouter.get("/handovers", validateStaff, getShiftHandoversHandler);

// Comprehensive Flowsheet: Authenticated Hospital Staff
nursingRouter.get("/admissions/:admissionId/flowsheet", validateStaff, getInpatientFlowsheetHandler);

export default nursingRouter;
