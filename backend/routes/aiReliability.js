import { Router } from "express";
import {
  getAiAudit,
  getEvaluationFixtures,
  evaluateAiCase,
  evaluateEvaluationSuite,
} from "../controller/aiReliability.js";

const aiRouter = Router();

aiRouter.get("/audit", getAiAudit);
aiRouter.get("/fixtures", getEvaluationFixtures);
aiRouter.post("/evaluate-case", evaluateAiCase);
aiRouter.post("/evaluate-suite", evaluateEvaluationSuite);

export default aiRouter;
