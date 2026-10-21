import {
  getAiSystemAudit,
  CLINICIAN_EVALUATION_FIXTURES,
  minimizePatientContext,
  validateAiBriefSchema,
  generateDeterministicSoapFallback,
  withBoundedTimeout,
  evaluateTriageRedFlag,
  checkAiConsent,
  createAiProvenance,
  runHonestEvaluationSuite,
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
 * Evaluates a patient intake case with data minimization, consent checks, and deterministic safety nets.
 */
export const evaluateAiCase = async (req, res) => {
  const { input, explicitConsent } = req.body;
  if (!input) {
    return res.status(400).json({ message: "Intake input is required" });
  }

  // 1. Consent verification
  const consent = checkAiConsent({ explicitConsent: explicitConsent !== undefined ? explicitConsent : input.aiConsent });
  if (!consent.consentGranted) {
    return res.status(200).json({
      evaluatedAt: new Date(),
      consentGranted: false,
      fallbackActive: true,
      reason: consent.reason,
      recommendedUrgency: "ROUTINE",
      isDraft: true,
      requiresClinicianApproval: true,
      disclaimer: "Deterministic guidance: AI consent not granted or was revoked.",
      provenance: createAiProvenance({
        provider: "deterministic_rules",
        model: "rule-engine-v1",
        consentVerified: false,
        fallbackUsed: true,
        fallbackReason: consent.reason,
      }),
    });
  }

  // 2. Apply data minimization
  const minimized = minimizePatientContext(input);

  // 3. Check for red flags deterministically
  const redFlag = evaluateTriageRedFlag(minimized);

  const evaluationResult = {
    evaluatedAt: new Date(),
    minimizedInput: minimized,
    consentGranted: true,
    isEmergencyRedFlag: redFlag.triggersRedFlag,
    recommendedUrgency: redFlag.urgencyLevel,
    isDraft: true,
    requiresClinicianApproval: true,
    disclaimer: "AI evaluation draft for intake guidance only. Not a medical diagnosis.",
    provenance: createAiProvenance({
      provider: redFlag.triggersRedFlag ? "deterministic_emergency_rules" : "rule-engine-v1",
      model: "rule-engine-v1",
      consentVerified: true,
      fallbackUsed: redFlag.triggersRedFlag,
    }),
  };

  return res.status(200).json(evaluationResult);
};

/**
 * POST /api/ai/evaluate-suite
 * Runs the honest evaluation suite over the actual deterministic / provider boundary.
 */
export const evaluateEvaluationSuite = async (req, res) => {
  try {
    const report = await runHonestEvaluationSuite();
    return res.status(200).json(report);
  } catch (error) {
    console.error("Evaluation suite execution failed:", error);
    return res.status(500).json({ message: "Failed to execute evaluation suite", error: error.message });
  }
};
