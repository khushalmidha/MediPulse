import express from "express";
import { askDoctorCopilot, getOpdTokenAiContext, sendOpdTriageMessage, startOpdTriage } from "../controller/opdAi.js";
import validateStaff from "../middleware/validateStaff.js";
import validateUser from "../middleware/validateUser.js";

const opdAiRouter = express.Router();

opdAiRouter.get("/tokens/:tokenId/triage/start", validateUser, startOpdTriage);
opdAiRouter.post("/tokens/:tokenId/triage/message", validateUser, sendOpdTriageMessage);
opdAiRouter.get("/tokens/:tokenId/context", validateStaff, getOpdTokenAiContext);
opdAiRouter.post("/tokens/:tokenId/copilot", validateStaff, askDoctorCopilot);

export default opdAiRouter;
