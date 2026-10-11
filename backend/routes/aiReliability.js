import { Router } from "express";
import { getAiAudit, getEvaluationFixtures, evaluateAiCase } from "../controller/aiReliability.js";

const aiRouter = Router();

aiRouter.get("/audit", getAiAudit);
aiRouter.get("/fixtures", getEvaluationFixtures);
aiRouter.post("/evaluate-case", evaluateAiCase);

export default aiRouter;
