import { Router } from "express";
import {
  getGuidance,
  getTicket,
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

encounterRouter.get("/:id/guidance", patientOrStaffAuth, requireEncounterRead, asyncRoute(getGuidance));
encounterRouter.get("/:id/ticket", patientOrStaffAuth, requireEncounterRead, asyncRoute(getTicket));
// These new commands lack durable identity/recipient/CAS safeguards (A07/A08).
// Keep established OPD transitions working; do not expose an unsafe claim repair.
encounterRouter.post("/:id/transition", validateStaff, pendingEncounterRepair);
encounterRouter.post("/:id/handoff", validateStaff, pendingEncounterRepair);
encounterRouter.post("/:id/refuse", validateStaff, pendingEncounterRepair);
encounterRouter.post("/:id/link-account", userValidation, pendingEncounterRepair);

export default encounterRouter;
