import crypto from "crypto";

/**
 * AI Reliability, Truthful Claims & Clinical Safety Service (P18)
 *
 * Enforces:
 * 1. Strict schema validation on all AI inputs and outputs.
 * 2. Bounded timeouts and retries on external AI providers.
 * 3. Graceful offline fallback: clinical workflows never depend on AI availability.
 * 4. Data minimization: strips unnecessary PII before sending prompts to external APIs.
 * 5. Mandatory draft state: all AI-generated clinical notes or suggestions require qualified clinician approval.
 * 6. Audit of verified capabilities vs missing/roadmap external repositories.
 */

export const CLINICAL_SAFETY_DISCLAIMER =
  "AI-generated clinical draft for decision support only. Requires qualified clinician review, verification, and approval prior to clinical reliance or medical documentation.";

export const FORECAST_PLANNING_DISCLAIMER =
  "Hospital operational forecast generated for resource planning with limited evidence. Projections are indicative estimates and do not constitute validated predictions.";

/**
 * Verified AI system capabilities audit.
 * Accurately enumerates what is live in this repository checkout vs external/roadmap components.
 */
export const getAiSystemAudit = () => {
  return {
    verifiedCapabilities: {
      geminiTriageAssistant: {
        status: process.env.GEMINI_API_KEY ? "configured" : "unconfigured_fallback_active",
        model: "gemini-2.5-flash",
        role: "Conversational intake and rough note structuring (drafts only)",
        requiresClinicianApproval: true,
      },
      huggingFaceInferenceClient: {
        status: process.env.HF_TOKEN ? "configured" : "unconfigured_fallback_active",
        models: ["SHUB-8/Triage-BERT", "anaschahid/medical-specialty-classifier", "DinaSalama/symptom_to_disease_distb"],
        role: "Experimental symptom classification via external inference API",
        requiresClinicianApproval: true,
      },
      deterministicEmergencyOverrides: {
        status: "active",
        role: "Rule-based red-flag symptom detection (immediate high severity override)",
        autonomousOperation: true,
      },
      operationalForecasts: {
        status: "active",
        role: "Department-level draft planning estimates from recorded OPD volume",
        validatedAccuracyClaim: false,
        disclaimer: FORECAST_PLANNING_DISCLAIMER,
      },
    },
    missingExternalRepositories: [
      {
        component: "Python FastAPI Microservice",
        status: "absent_from_checkout",
        details: "README describes an external Python microservice with PyTorch/LightGBM. This repository uses Node.js with direct provider clients.",
        resolution: "Roadmap item documented in PRODUCTION_ROADMAP.md; Node.js deterministic fallback is primary.",
      },
      {
        component: "Local LightGBM LambdaMART Ranking Engine",
        status: "absent_from_checkout",
        details: "Doctor ranking is currently determined by availability, specialties, and explicit filters rather than learned pairwise ranking.",
        resolution: "Documented as future production milestone.",
      },
    ],
    truthfulClaimsPolicy: {
      zeroAutonomousDiagnosis: true,
      mandatoryHumanReview: true,
      gracefulOfflineOperation: true,
      noMedicalAccuracyGuarantees: true,
    },
  };
};

/**
 * Wraps an asynchronous AI promise with a strict bounded timeout.
 * Prevents third-party AI outages from hanging Node.js request threads.
 */
export const withBoundedTimeout = async (promise, timeoutMs = 6000, fallbackValue = null) => {
  let timer;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => {
      resolve({ isTimeout: true, value: fallbackValue });
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([
      promise.then((res) => ({ isTimeout: false, value: res })),
      timeoutPromise,
    ]);
    clearTimeout(timer);
    if (result.isTimeout) {
      return fallbackValue;
    }
    return result.value;
  } catch (err) {
    clearTimeout(timer);
    return fallbackValue;
  }
};

/**
 * Data Minimization: Strips PII (phone, full address, identification numbers)
 * while preserving necessary clinical descriptors (chief complaint, duration, age, relevant history).
 */
export const minimizePatientContext = (patientData = {}) => {
  const {
    chiefComplaint,
    symptoms,
    symptomDuration,
    age,
    gender,
    allergies,
    relevantHistory,
    currentMedications,
  } = patientData;

  return {
    chiefComplaint: typeof chiefComplaint === "string" ? chiefComplaint.slice(0, 500) : "",
    symptoms: Array.isArray(symptoms) ? symptoms.slice(0, 10).map((s) => String(s).slice(0, 100)) : [],
    symptomDuration: typeof symptomDuration === "string" ? symptomDuration.slice(0, 100) : "",
    age: typeof age === "number" && age >= 0 && age <= 130 ? age : null,
    gender: ["male", "female", "other"].includes(String(gender).toLowerCase()) ? gender : "unspecified",
    allergies: Array.isArray(allergies) ? allergies.slice(0, 10).map((a) => String(a).slice(0, 100)) : [],
    relevantHistory: typeof relevantHistory === "string" ? relevantHistory.slice(0, 500) : "",
    currentMedications: Array.isArray(currentMedications) ? currentMedications.slice(0, 10).map((m) => String(m).slice(0, 100)) : [],
  };
};

/**
 * Schema Validation for AI Intake Output.
 */
export const validateAiBriefSchema = (brief) => {
  if (!brief || typeof brief !== "object") return null;

  const validSeverities = ["mild", "moderate", "severe"];
  const validUrgencies = ["ROUTINE", "URGENT", "EMERGENCY"];

  return {
    chiefComplaint: String(brief.chiefComplaint || "").slice(0, 500),
    symptomDuration: String(brief.symptomDuration || "").slice(0, 200),
    severity: validSeverities.includes(brief.severity) ? brief.severity : "moderate",
    urgencyLevel: validUrgencies.includes(brief.urgencyLevel) ? brief.urgencyLevel : "ROUTINE",
    agentSummary: String(brief.agentSummary || "").slice(0, 1000),
    predictedDisease: brief.predictedDisease ? String(brief.predictedDisease).slice(0, 200) : undefined,
    isDraft: true,
    requiresClinicianApproval: true,
    disclaimer: CLINICAL_SAFETY_DISCLAIMER,
  };
};

/**
 * Formats an AI-generated SOAP note draft with explicit clinician verification flags.
 */
export const formatSoapNoteDraft = ({ subjective = "", objective = "", assessment = "", plan = "", markdown = "" }) => {
  return {
    subjective: String(subjective || "").trim(),
    objective: String(objective || "").trim(),
    assessment: String(assessment || "").trim(),
    plan: String(plan || "").trim(),
    markdown: String(markdown || "").trim(),
    isDraft: true,
    clinicianApproved: false,
    generatedAt: new Date(),
    disclaimer: CLINICAL_SAFETY_DISCLAIMER,
  };
};

/**
 * Safe offline fallback for SOAP note generation when AI model is unconfigured or unreachable.
 */
export const generateDeterministicSoapFallback = ({ roughNotes = "", chiefComplaint = "", transcript = "" }) => {
  const content = roughNotes || chiefComplaint || transcript || "Clinical consultation recorded.";
  const fallbackMarkdown = `### Subjective\n- Patient reported: ${content}\n\n### Objective\n- Vitals and physical examination pending clinician recording.\n\n### Assessment\n- Preliminary evaluation based on consultation notes.\n\n### Plan\n- Clinician to review and finalize treatment plan.`;

  return formatSoapNoteDraft({
    subjective: content,
    objective: "Pending clinician entry",
    assessment: "Awaiting clinician diagnosis",
    plan: "Review and formulate prescription / follow-up",
    markdown: fallbackMarkdown,
  });
};

/**
 * Clinician-reviewable evaluation fixtures for automated regression testing.
 * Standardized test cases verifying that triage and fallback behave reliably.
 */
export const CLINICIAN_EVALUATION_FIXTURES = [
  {
    fixtureId: "EVAL-001-CHEST-PAIN",
    description: "Acute cardiac red-flag symptom",
    input: {
      chiefComplaint: "Crushing chest pain radiating to left arm and shortness of breath for 30 minutes",
      age: 58,
      gender: "male",
    },
    expectedTriage: {
      minimumUrgency: "EMERGENCY",
      triggersRedFlag: true,
    },
  },
  {
    fixtureId: "EVAL-002-PEDIATRIC-FEVER",
    description: "Pediatric fever without red-flag emergency",
    input: {
      chiefComplaint: "Mild fever 100.2F and runny nose for 2 days, active and feeding well",
      age: 4,
      gender: "female",
    },
    expectedTriage: {
      minimumUrgency: "ROUTINE",
      triggersRedFlag: false,
    },
  },
  {
    fixtureId: "EVAL-003-ROUTINE-CHECKUP",
    description: "Routine health screening / consultation",
    input: {
      chiefComplaint: "Annual health checkup and routine blood pressure screening",
      age: 35,
      gender: "other",
    },
    expectedTriage: {
      minimumUrgency: "ROUTINE",
      triggersRedFlag: false,
    },
  },
];
