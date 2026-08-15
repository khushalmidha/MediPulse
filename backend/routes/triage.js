import { Router } from "express";
import validateUser from "../middleware/validateUser.js";
import { completeTriage, sendMessage, startTriage } from "../controller/triage.js";

const triageRouter = Router();

triageRouter.get("/start/:appointmentId", validateUser, startTriage);
triageRouter.post("/message/:appointmentId", validateUser, sendMessage);
triageRouter.post("/complete/:appointmentId", validateUser, completeTriage);

export default triageRouter;
