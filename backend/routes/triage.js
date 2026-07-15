import { Router } from "express";
import validateUser from "../middleware/validateUser.js";
import { completeTriage, sendMessage, startTriage } from "../controller/triage.js";

const triageRouter = Router();

triageRouter.get("/:appointmentId/start", validateUser, startTriage);
triageRouter.post("/:appointmentId/message", validateUser, sendMessage);
triageRouter.post("/:appointmentId/complete", validateUser, completeTriage);

export default triageRouter;
