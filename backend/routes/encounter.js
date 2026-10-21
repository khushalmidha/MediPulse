import { Router } from "express";
import {
  getGuidance,
  getTicket,
  transitionStage,
  registerFile,
  handoffFile,
  acceptHandoff,
  refuseHandoff,
  getCustodyWorklistController,
  getCustodyDetails,
} from "../controller/encounterJourney.js";
import validateStaff from "../middleware/validateStaff.js";
import userValidation from "../middleware/validateUser.js";
import patientOrStaffAuth from "../middleware/patientOrStaffAuth.js";
import { requireEncounterRead, pendingEncounterRepair } from "../middleware/encounterAccess.js";

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

// Staff custody worklist (must precede :id params)
encounterRouter.get("/custody/worklist", validateStaff, asyncRoute(getCustodyWorklistController));

// Encounter queries
encounterRouter.get("/:id/guidance", patientOrStaffAuth, requireEncounterRead, asyncRoute(getGuidance));
encounterRouter.get("/:id/ticket", patientOrStaffAuth, requireEncounterRead, asyncRoute(getTicket));
encounterRouter.get("/:id/custody", validateStaff, asyncRoute(getCustodyDetails));

// AG03: transition stage
encounterRouter.post("/:id/transition", validateStaff, asyncRoute(transitionStage));

// AG04: physical file custody lifecycle with recipient acceptance
encounterRouter.post("/:id/file/register", validateStaff, asyncRoute(registerFile));
encounterRouter.post("/:id/register-file", validateStaff, asyncRoute(registerFile));
encounterRouter.post("/:id/handoff", validateStaff, asyncRoute(handoffFile));
encounterRouter.post("/:id/accept-handoff", validateStaff, asyncRoute(acceptHandoff));
encounterRouter.post("/:id/handoff/accept", validateStaff, asyncRoute(acceptHandoff));
encounterRouter.post("/:id/refuse", validateStaff, asyncRoute(refuseHandoff));
encounterRouter.post("/:id/handoff/refuse", validateStaff, asyncRoute(refuseHandoff));

// AG05: walk-in link account retains explicit containment until its phase
encounterRouter.post("/:id/link-account", userValidation, pendingEncounterRepair);

export default encounterRouter;
