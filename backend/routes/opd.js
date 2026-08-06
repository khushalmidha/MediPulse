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

const asyncRoute = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    // FIXED: Express 4 does not catch async controller failures, which made OPD requests hang as "Failed to fetch".
    console.error("OPD route failed:", error);
    if (!res.headersSent) {
      res.status(500).json({ message: error.message || "OPD service failed" });
    }
  }
};

opdRouter.post("/:hospitalId/:departmentId/book", userValidation, asyncRoute(issueToken));
opdRouter.post("/:hospitalId/:departmentId/token", validateStaff, requireRole("RECEPTIONIST", "HOSPITAL_ADMIN", "NURSE"), asyncRoute(issueToken));
opdRouter.get("/:hospitalId/:doctorId/queue", validateStaff, asyncRoute(getDoctorQueue));
opdRouter.patch("/tokens/:tokenId/vitals", validateStaff, requireRole("NURSE", "HOSPITAL_ADMIN"), asyncRoute(recordVitals));
opdRouter.patch("/tokens/:tokenId/start-consultation", validateStaff, requireRole("DOCTOR"), asyncRoute(startConsultation));
opdRouter.patch("/tokens/:tokenId/complete", validateStaff, requireRole("DOCTOR"), asyncRoute(completeConsultation));
opdRouter.patch("/tokens/:tokenId/no-show", validateStaff, asyncRoute(markNoShow));
opdRouter.get("/:hospitalId/my-token", userValidation, asyncRoute(getMyActiveToken));

export default opdRouter;
