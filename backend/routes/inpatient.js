import { Router } from "express";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";
import {
  getWardsHandler,
  createWardHandler,
  getRoomsHandler,
  createRoomHandler,
  getBedsHandler,
  createBedHandler,
  updateBedStatusHandler,
  admitPatientHandler,
  transferBedHandler,
  recordClearanceHandler,
  finalizeDischargeHandler,
  getInpatientTimelineHandler,
} from "../controller/inpatient.js";

const inpatientRouter = Router();
inpatientRouter.use(nosqlGuard);

// Ward administration
inpatientRouter.get("/wards", validateStaff, getWardsHandler);
inpatientRouter.post("/wards", validateStaff, requireRole("HOSPITAL_ADMIN"), createWardHandler);

// Room administration
inpatientRouter.get("/rooms", validateStaff, getRoomsHandler);
inpatientRouter.post("/rooms", validateStaff, requireRole("HOSPITAL_ADMIN"), createRoomHandler);

// Bed administration & state machine
inpatientRouter.get("/beds", validateStaff, getBedsHandler);
inpatientRouter.post("/beds", validateStaff, requireRole("HOSPITAL_ADMIN"), createBedHandler);
inpatientRouter.patch("/beds/:bedId/status", validateStaff, requireRole("NURSE", "HOSPITAL_ADMIN"), updateBedStatusHandler);

// Inpatient ADT clinical workflows
inpatientRouter.post("/admit", validateStaff, requireRole("DOCTOR", "RECEPTIONIST", "NURSE", "HOSPITAL_ADMIN"), admitPatientHandler);
inpatientRouter.post("/admissions/:admissionId/transfer", validateStaff, requireRole("NURSE", "DOCTOR", "HOSPITAL_ADMIN"), transferBedHandler);
inpatientRouter.post("/admissions/:admissionId/clearance", validateStaff, recordClearanceHandler);
inpatientRouter.post("/admissions/:admissionId/discharge", validateStaff, requireRole("DOCTOR", "HOSPITAL_ADMIN"), finalizeDischargeHandler);
inpatientRouter.get("/admissions/:admissionId/timeline", validateStaff, getInpatientTimelineHandler);

export default inpatientRouter;
