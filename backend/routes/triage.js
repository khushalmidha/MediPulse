import { Router } from "express";
import validateUser from "../middleware/validateUser.js";
import { completeTriage, sendMessage, startTriage } from "../controller/triage.js";

const triageRouter = Router();

triageRouter.get("/start", validateUser, startTriage);
triageRouter.post("/message", validateUser, sendMessage);
triageRouter.post("/complete", validateUser, completeTriage);

export default triageRouter;
