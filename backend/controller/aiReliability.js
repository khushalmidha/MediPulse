import {
  getAiSystemAudit,
  CLINICIAN_EVALUATION_FIXTURES,
  minimizePatientContext,
  validateAiBriefSchema,
  generateDeterministicSoapFallback,
  withBoundedTimeout,
} from "../services/aiReliabilityService.js";

/**
 * GET /api/ai/audit
 * Returns verified AI system capabilities and truthful claims audit.
 */
export const getAiAudit = async (req, res) => {
  const audit = getAiSystemAudit();
  return res.status(200).json(audit);
};

/**
 * GET /api/ai/fixtures
 * Returns clinician-reviewable evaluation fixtures for regression checks.
 */
export const getEvaluationFixtures = async (req, res) => {
  return res.status(200).json({
    count: CLINICIAN_EVALUATION_FIXTURES.length,
    fixtures: CLINICIAN_EVALUATION_FIXTURES,
  });
};

/**
 * POST /api/ai/evaluate-case
 * Evaluates a patient intake case with data minimization and deterministic safety nets.
 */
export const evaluateAiCase = async (req, res) => {
  const { input } = req.body;
  if (!input) {
    return res.status(400).json({ message: "Intake input is required" });
  }

  // 1. Apply data minimization
  const minimized = minimizePatientContext(input);

  // 2. Check for red flags deterministically
  const redFlagKeywords = ["chest pain", "breathing difficulty", "stroke", "unconscious", "profuse bleeding", "heart attack"];
  const lowerText = String(minimized.chiefComplaint || "").toLowerCase();
  const hasRedFlag = redFlagKeywords.some((kw) => lowerText.includes(kw));

  const evaluationResult = {
    evaluatedAt: new Date(),
    minimizedInput: minimized,
    isEmergencyRedFlag: hasRedFlag,
    recommendedUrgency: hasRedFlag ? "EMERGENCY" : "ROUTINE",
    isDraft: true,
    requiresClinicianApproval: true,
    disclaimer: "AI evaluation draft for intake guidance only. Not a medical diagnosis.",
  };

  return res.status(200).json(evaluationResult);
};
