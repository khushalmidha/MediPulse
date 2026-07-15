import { Router } from "express";
import validateUser from "../middleware/validateUser.js";
import { analyzeChunk, generateSoap, getSuggestions } from "../controller/copilot.js";

const copilotRouter = Router();

copilotRouter.post("/:appointmentId/analyze", validateUser, analyzeChunk);
copilotRouter.post("/:appointmentId/generate-soap", validateUser, generateSoap);
copilotRouter.get("/:appointmentId/suggestions", validateUser, getSuggestions);

export default copilotRouter;
