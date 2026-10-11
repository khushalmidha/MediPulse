import { Router } from "express";
import {
  getGuidance,
  transitionStage,
  handoffFile,
  refuseHandoff,
  linkWalkIn,
  getTicket,
} from "../controller/encounterJourney.js";
import validateStaff from "../middleware/validateStaff.js";
import userValidation from "../middleware/validateUser.js";
import patientOrStaffAuth from "../middleware/patientOrStaffAuth.js";

const encounterRouter = Router();

const asyncRoute = (handler) => async (req, res, next) => {
  try {
    await handler(req, res, next);
  } catch (error) {
    if (!error.status) console.error("Encounter route error:", error.name || "Error");
    if (!res.headersSent) {
      res.status(error.status || 500).json({ message: error.status ? error.message : "Encounter service failed" });
    }
  }
};

encounterRouter.get("/:id/guidance", patientOrStaffAuth, asyncRoute(getGuidance));
encounterRouter.get("/:id/ticket", patientOrStaffAuth, asyncRoute(getTicket));
encounterRouter.post("/:id/transition", validateStaff, asyncRoute(transitionStage));
encounterRouter.post("/:id/handoff", validateStaff, asyncRoute(handoffFile));
encounterRouter.post("/:id/refuse", validateStaff, asyncRoute(refuseHandoff));
encounterRouter.post("/:id/link-account", userValidation, asyncRoute(linkWalkIn));

export default encounterRouter;
