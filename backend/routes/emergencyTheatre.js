import { Router } from "express";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";
import {
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
} from "../controller/emergencyTheatre.js";

const emergencyTheatreRouter = Router();
emergencyTheatreRouter.use(nosqlGuard);

// 1. Emergency Department Registrations & Triage
emergencyTheatreRouter.post(
  "/registrations",
  validateStaff,
  requireRole("DOCTOR", "NURSE", "HOSPITAL_ADMIN"),
  registerEmergencyPatientHandler
);
emergencyTheatreRouter.get(
  "/registrations",
  validateStaff,
  requireRole("DOCTOR", "NURSE", "HOSPITAL_ADMIN", "RECEPTIONIST"),
  getEmergencyRegistrationsHandler
);
emergencyTheatreRouter.get(
  "/registrations/:id",
  validateStaff,
  requireRole("DOCTOR", "NURSE", "HOSPITAL_ADMIN", "RECEPTIONIST"),
  getEmergencyRegistrationByIdHandler
);
emergencyTheatreRouter.patch(
  "/registrations/:id/status",
  validateStaff,
  requireRole("DOCTOR", "NURSE", "HOSPITAL_ADMIN"),
  updateEmergencyStatusHandler
);

// 2. Theatre Room Management
emergencyTheatreRouter.post(
  "/theatres",
  validateStaff,
  requireRole("HOSPITAL_ADMIN"),
  createTheatreRoomHandler
);
emergencyTheatreRouter.get(
  "/theatres",
  validateStaff,
  requireRole("DOCTOR", "NURSE", "HOSPITAL_ADMIN"),
  getTheatreRoomsHandler
);

// 3. Operation Theatre Booking & Schedules
emergencyTheatreRouter.post(
  "/bookings",
  validateStaff,
  requireRole("DOCTOR", "HOSPITAL_ADMIN"),
  bookTheatreCaseHandler
);
emergencyTheatreRouter.get(
  "/bookings",
  validateStaff,
  requireRole("DOCTOR", "NURSE", "HOSPITAL_ADMIN"),
  getOtSchedulesHandler
);
emergencyTheatreRouter.get(
  "/bookings/:id",
  validateStaff,
  requireRole("DOCTOR", "NURSE", "HOSPITAL_ADMIN"),
  getOtScheduleByIdHandler
);
emergencyTheatreRouter.post(
  "/bookings/:id/cancel",
  validateStaff,
  requireRole("DOCTOR", "HOSPITAL_ADMIN"),
  cancelTheatreCaseHandler
);

// 4. WHO Surgical Safety Checklist & PACU
emergencyTheatreRouter.post(
  "/bookings/:id/who-checklist",
  validateStaff,
  requireRole("DOCTOR", "NURSE"),
  recordWhoChecklistStageHandler
);
emergencyTheatreRouter.post(
  "/bookings/:id/pacu",
  validateStaff,
  requireRole("DOCTOR", "NURSE"),
  recordPacuRecoveryHandler
);

export default emergencyTheatreRouter;
