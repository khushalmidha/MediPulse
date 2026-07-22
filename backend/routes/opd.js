import { Router } from "express";
import {
  completeConsultation,
  getDoctorQueue,
  getMyActiveToken,
  issueToken,
  markNoShow,
  recordVitals,
  startConsultation,
} from "../controller/opdToken.js";
import validateStaff, { requireRole } from "../middleware/validateStaff.js";
import userValidation from "../middleware/validateUser.js";

const opdRouter = Router();

opdRouter.post("/:hospitalId/:departmentId/token", validateStaff, requireRole("RECEPTIONIST", "HOSPITAL_ADMIN", "NURSE"), issueToken);
opdRouter.get("/:hospitalId/:doctorId/queue", validateStaff, getDoctorQueue);
opdRouter.patch("/tokens/:tokenId/vitals", validateStaff, requireRole("NURSE", "HOSPITAL_ADMIN"), recordVitals);
opdRouter.patch("/tokens/:tokenId/start-consultation", validateStaff, requireRole("DOCTOR"), startConsultation);
opdRouter.patch("/tokens/:tokenId/complete", validateStaff, requireRole("DOCTOR"), completeConsultation);
opdRouter.patch("/tokens/:tokenId/no-show", validateStaff, markNoShow);
opdRouter.get("/:hospitalId/my-token", userValidation, getMyActiveToken);

export default opdRouter;
