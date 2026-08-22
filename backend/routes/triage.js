import { Router } from "express";
import validateUser from "../middleware/validateUser.js";
import { completeTriage, sendMessage, startTriage, fullAssessmentV2, smartBookingAssessment } from "../controller/triage.js";

const triageRouter = Router();

triageRouter.get("/start/:appointmentId", validateUser, startTriage);
triageRouter.post("/message/:appointmentId", validateUser, sendMessage);
triageRouter.post("/complete/:appointmentId", validateUser, completeTriage);

triageRouter.post("/v2/full-assessment", validateUser, fullAssessmentV2);

export default triageRouter;

triageRouter.post("/smart-booking", validateUser, smartBookingAssessment);

