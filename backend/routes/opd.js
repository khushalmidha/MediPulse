import { Router } from "express";
import {
  completeConsultation,
  checkIn,
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
    if (!error.status) console.error("OPD route failed:", error.name || "Error");
    if (!res.headersSent) {
      res.status(error.status || 500).json({ message: error.status ? error.message : "OPD service failed", ...(error.compensationStatus ? { compensationStatus: error.compensationStatus } : {}) });
    }
  }
};

opdRouter.post("/:hospitalId/:departmentId/book", userValidation, asyncRoute(issueToken));
opdRouter.post("/:hospitalId/:departmentId/token", validateStaff, requireRole("RECEPTIONIST", "HOSPITAL_ADMIN", "NURSE"), asyncRoute(issueToken));
opdRouter.get("/:hospitalId/:doctorId/queue", validateStaff, asyncRoute(getDoctorQueue));
opdRouter.patch("/tokens/:tokenId/check-in", validateStaff, requireRole("NURSE", "RECEPTIONIST", "HOSPITAL_ADMIN"), asyncRoute(checkIn));
opdRouter.patch("/tokens/:tokenId/vitals", validateStaff, requireRole("NURSE", "HOSPITAL_ADMIN"), asyncRoute(recordVitals));
opdRouter.patch("/tokens/:tokenId/start-consultation", validateStaff, requireRole("DOCTOR"), asyncRoute(startConsultation));
opdRouter.patch("/tokens/:tokenId/complete", validateStaff, requireRole("DOCTOR"), asyncRoute(completeConsultation));
opdRouter.patch("/tokens/:tokenId/no-show", validateStaff, asyncRoute(markNoShow));
opdRouter.get("/:hospitalId/my-token", userValidation, asyncRoute(getMyActiveToken));

opdRouter.get("/tokens/:tokenId/live-timeline", asyncRoute(async (req, res) => {
  const { getPatientLiveTimeline } = await import("../services/queueTrackingService.js");
  const timeline = await getPatientLiveTimeline(req.params.tokenId);
  res.json({ timeline });
}));

opdRouter.post("/tokens/:tokenId/priority-override", validateStaff, asyncRoute(async (req, res) => {
  const { recordPriorityOverride } = await import("../services/queueTrackingService.js");
  const result = await recordPriorityOverride({
    tokenId: req.params.tokenId,
    actor: req.staff,
    reason: req.body.reason,
    newPriorityIndex: req.body.priorityIndex,
  });
  res.json(result);
}));

opdRouter.post("/queue/pause", validateStaff, asyncRoute(async (req, res) => {
  const { pauseDoctorQueue } = await import("../services/queueTrackingService.js");
  const result = pauseDoctorQueue({
    queueKey: req.body.queueKey,
    doctorId: req.staff?._id || req.staff?.id,
    reason: req.body.reason,
  });
  res.json({ message: "Queue paused", pause: result });
}));

opdRouter.post("/queue/resume", validateStaff, asyncRoute(async (req, res) => {
  const { resumeDoctorQueue } = await import("../services/queueTrackingService.js");
  const result = resumeDoctorQueue({ queueKey: req.body.queueKey });
  res.json({ message: "Queue resumed", result });
}));

export default opdRouter;
