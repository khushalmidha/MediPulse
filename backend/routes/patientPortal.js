import express from "express";
import {
  addFamilyMember,
  getFamilyMembers,
  getHealthTimeline,
  getVisitedHospitals,
  removeFamilyMember,
} from "../controller/patientPortal.js";
import validateUser from "../middleware/validateUser.js";

const patientPortalRouter = express.Router();

patientPortalRouter.get("/me/health-timeline", validateUser, getHealthTimeline);
patientPortalRouter.get("/me/hospitals", validateUser, getVisitedHospitals);
patientPortalRouter.get("/me/family", validateUser, getFamilyMembers);
patientPortalRouter.post("/me/family", validateUser, addFamilyMember);
patientPortalRouter.delete("/me/family/:memberId", validateUser, removeFamilyMember);

export default patientPortalRouter;
