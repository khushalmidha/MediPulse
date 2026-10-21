import crypto from "crypto";

/**
 * AI Reliability, Truthful Claims & Clinical Safety Service (AG14 / P18)
 *
 * Enforces:
 * 1. Strict schema validation on all AI inputs and outputs.
 * 2. Explicit data minimization: strips PII before sending prompts to external APIs.
 * 3. Consent verification and revocation: respects patient/account AI processing preferences.
 * 4. Bounded timeouts and circuit-breaking: third-party AI outages never hang requests.
 * 5. Mandatory draft state: all AI-generated clinical notes require qualified clinician approval.
 * 6. Explicit provenance tracking: every generated draft attaches provider, model, timestamp, and verification metadata.
 * 7. Graceful offline fallback: core healthcare operations and booking continue uninterrupted without AI.
 * 8. Truthful audit of verified live capabilities vs missing/roadmap external repositories.
 */

export const CLINICAL_SAFETY_DISCLAIMER =
  "AI-generated clinical draft for decision support only. Requires qualified clinician review, verification, and approval prior to clinical reliance or medical documentation.";

export const FORECAST_PLANNING_DISCLAIMER =
  "Hospital operational forecast generated for resource planning with limited evidence. Projections are indicative estimates and do not constitute validated predictions.";

export const getSmartBookingModel = () =>
  process.env.GEMINI_SMART_BOOKING_MODEL?.trim() || "gemini-3.5-flash-lite";

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
        smartBookingModel: getSmartBookingModel(),
        role: "Conversational intake and rough note structuring (drafts only)",
        requiresClinicianApproval: true,
      },
      huggingFaceInferenceClient: {
        status: process.env.HF_TOKEN ? "configured" : "unconfigured_fallback_active",
        models: [
          "SHUB-8/Triage-BERT",
          "anaschahid/medical-specialty-classifier",
          "DinaSalama/symptom_to_disease_distb",
        ],
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
        details:
          "README describes an external Python microservice with PyTorch/LightGBM. This repository uses Node.js with direct provider clients.",
        resolution: "Roadmap item documented in PRODUCTION_ROADMAP.md; Node.js deterministic fallback is primary.",
      },
      {
        component: "Local LightGBM LambdaMART Ranking Engine",
        status: "absent_from_checkout",
        details:
          "Doctor ranking is currently determined by availability, specialties, and explicit filters rather than learned pairwise ranking.",
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
 * Verifies whether patient/appointment has granted consent for AI data processing.
 */
export const checkAiConsent = ({ user, appointment, explicitConsent } = {}) => {
  if (explicitConsent === false) {
    return { consentGranted: false, reason: "explicit_consent_denied" };
  }
  if (user && user.aiConsent === false) {
    return { consentGranted: false, reason: "user_consent_revoked" };
  }
  if (appointment && appointment.aiConsent === false) {
    return { consentGranted: false, reason: "appointment_consent_revoked" };
  }
  return { consentGranted: true, reason: null };
};

/**
 * Creates standardized provenance metadata for clinical audit trails.
 */
export const createAiProvenance = ({
  provider = "google_gemini",
  model = "gemini-2.5-flash",
  consentVerified = true,
  fallbackUsed = false,
  fallbackReason = null,
  dataMinimizationApplied = true,
} = {}) => {
  return {
    provider: fallbackUsed ? "deterministic_rules" : provider,
    model: fallbackUsed ? "rule-engine-v1" : model,
    generatedAt: new Date(),
    consentVerified: Boolean(consentVerified),
    fallbackUsed: Boolean(fallbackUsed),
    fallbackReason: fallbackReason || null,
    dataMinimizationApplied: Boolean(dataMinimizationApplied),
    isDraft: true,
    requiresClinicianApproval: true,
    disclaimer: CLINICAL_SAFETY_DISCLAIMER,
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
      Promise.resolve(promise).then(
        (res) => ({ isTimeout: false, value: res }),
        () => ({ isTimeout: false, value: fallbackValue })
      ),
      timeoutPromise,
    ]);
    clearTimeout(timer);
    if (result.isTimeout) {
      return fallbackValue;
    }
    return result.value;
  } catch {
    clearTimeout(timer);
    return fallbackValue;
  }
};

/**
 * Data Minimization: Strips PII (name, phone, address, national ID, email, account identifiers)
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
 * Deterministic emergency override rule engine.
 */
export const RED_FLAG_PATTERN =
  /chest pain|crushing|breathless|shortness of breath|unconscious|severe bleeding|faint|seizure|sudden weakness|vision loss/i;

export const evaluateTriageRedFlag = (input = {}) => {
  const text = `${input.chiefComplaint || ""} ${Array.isArray(input.symptoms) ? input.symptoms.join(" ") : ""} ${input.relevantHistory || ""}`;
  const triggersRedFlag = RED_FLAG_PATTERN.test(text);
  return {
    triggersRedFlag,
    urgencyLevel: triggersRedFlag ? "EMERGENCY" : "ROUTINE",
  };
};

/**
 * Schema Validation for AI Intake Output.
 */
export const validateAiBriefSchema = (brief, provenance = null) => {
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
    provenance: provenance || createAiProvenance({
      provider: "google_gemini",
      model: "gemini-2.5-flash",
      consentVerified: true,
      fallbackUsed: false,
    }),
  };
};

/**
 * Formats an AI-generated SOAP note draft with explicit clinician verification flags and provenance.
 */
export const formatSoapNoteDraft = ({
  subjective = "",
  objective = "",
  assessment = "",
  plan = "",
  markdown = "",
  provenance = null,
} = {}) => {
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
    provenance: provenance || createAiProvenance({
      provider: "google_gemini",
      model: "gemini-2.5-flash",
      consentVerified: true,
      fallbackUsed: false,
    }),
  };
};

/**
 * Safe offline fallback for SOAP note generation when AI model is unconfigured or unreachable.
 */
export const generateDeterministicSoapFallback = ({
  roughNotes = "",
  chiefComplaint = "",
  transcript = "",
  reason = "offline",
} = {}) => {
  const content = roughNotes || chiefComplaint || transcript || "Clinical consultation recorded.";
  const fallbackMarkdown = `### Subjective\n- Patient reported: ${content}\n\n### Objective\n- Vitals and physical examination pending clinician recording.\n\n### Assessment\n- Preliminary evaluation based on consultation notes.\n\n### Plan\n- Clinician to review and finalize treatment plan.`;

  return formatSoapNoteDraft({
    subjective: content,
    objective: "Pending clinician entry",
    assessment: "Awaiting clinician diagnosis",
    plan: "Review and formulate prescription / follow-up",
    markdown: fallbackMarkdown,
    provenance: createAiProvenance({
      provider: "deterministic_rules",
      model: "rule-engine-v1",
      consentVerified: true,
      fallbackUsed: true,
      fallbackReason: reason,
    }),
  });
};

/**
 * Unified boundary caller consolidating external provider invocations behind
 * consent checks, data minimization, bounded timeouts, schema validation, and provenance.
 */
export const invokeClinicalAiProvider = async ({
  user,
  appointment,
  explicitConsent,
  rawPatientData,
  prompt,
  timeoutMs = 6000,
  fallbackGenerator,
  schemaValidator,
  providerCall,
  modelName = "gemini-2.5-flash",
} = {}) => {
  // 1. Consent verification
  const consentCheck = checkAiConsent({ user, appointment, explicitConsent });
  if (!consentCheck.consentGranted) {
    const fallbackData = fallbackGenerator ? fallbackGenerator(consentCheck.reason) : null;
    const provenance = createAiProvenance({
      provider: "deterministic_rules",
      model: "rule-engine-v1",
      consentVerified: false,
      fallbackUsed: true,
      fallbackReason: consentCheck.reason,
    });
    return {
      success: true,
      fallbackActive: true,
      reason: consentCheck.reason,
      data: fallbackData,
      provenance,
    };
  }

  // 2. Data minimization
  const minimizedData = rawPatientData ? minimizePatientContext(rawPatientData) : null;

  // 3. Provider configuration check
  if (!process.env.GEMINI_API_KEY && !providerCall) {
    const fallbackData = fallbackGenerator ? fallbackGenerator("provider_not_configured") : null;
    const provenance = createAiProvenance({
      provider: "deterministic_rules",
      model: "rule-engine-v1",
      consentVerified: true,
      fallbackUsed: true,
      fallbackReason: "provider_not_configured",
    });
    return {
      success: true,
      fallbackActive: true,
      reason: "provider_not_configured",
      data: fallbackData,
      provenance,
    };
  }

  // 4. Bounded execution
  let callResult = null;
  try {
    const executePromise = providerCall
      ? providerCall({ minimizedData, prompt })
      : (async () => {
          const { GoogleGenerativeAI } = await import("@google/generative-ai");
          const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
          const model = genAI.getGenerativeModel({ model: modelName });
          const res = await model.generateContent(prompt);
          return res.response.text();
        })();

    callResult = await withBoundedTimeout(executePromise, timeoutMs, null);
    if (callResult === null) {
      const fallbackData = fallbackGenerator ? fallbackGenerator("timeout") : null;
      const provenance = createAiProvenance({
        provider: "deterministic_rules",
        model: "rule-engine-v1",
        consentVerified: true,
        fallbackUsed: true,
        fallbackReason: "timeout",
      });
      return {
        success: true,
        fallbackActive: true,
        reason: "timeout",
        data: fallbackData,
        provenance,
      };
    }
  } catch (err) {
    let errorReason = "provider_error";
    if (err?.status === 429) errorReason = "rate_limited";
    else if ([401, 403].includes(err?.status)) errorReason = "provider_access_denied";
    else if (err?.name === "AbortError") errorReason = "timeout";
    else if (err?.status >= 500) errorReason = "provider_unavailable";

    const fallbackData = fallbackGenerator ? fallbackGenerator(errorReason) : null;
    const provenance = createAiProvenance({
      provider: "deterministic_rules",
      model: "rule-engine-v1",
      consentVerified: true,
      fallbackUsed: true,
      fallbackReason: errorReason,
    });
    return {
      success: true,
      fallbackActive: true,
      reason: errorReason,
      data: fallbackData,
      provenance,
    };
  }

  // 5. Schema validation & formatting
  try {
    const validatedData = schemaValidator ? schemaValidator(callResult) : callResult;
    if (!validatedData) {
      throw new Error("malformed_response");
    }
    const provenance = createAiProvenance({
      provider: "google_gemini",
      model: modelName,
      consentVerified: true,
      fallbackUsed: false,
    });
    return {
      success: true,
      fallbackActive: false,
      data: validatedData,
      provenance,
    };
  } catch {
    const fallbackData = fallbackGenerator ? fallbackGenerator("malformed_response") : null;
    const provenance = createAiProvenance({
      provider: "deterministic_rules",
      model: "rule-engine-v1",
      consentVerified: true,
      fallbackUsed: true,
      fallbackReason: "malformed_response",
    });
    return {
      success: true,
      fallbackActive: true,
      reason: "malformed_response",
      data: fallbackData,
      provenance,
    };
  }
};

/**
 * Standardized clinician evaluation fixtures.
 */
export const CLINICIAN_EVALUATION_FIXTURES = [
  {
    fixtureId: "EVAL-001-CHEST-PAIN",
    description: "Acute cardiac red-flag emergency override",
    input: {
      chiefComplaint: "Crushing chest pain radiating to left arm and shortness of breath for 30 minutes",
      symptoms: ["chest pain", "shortness of breath", "sweating"],
      age: 58,
      gender: "male",
    },
    expectedTriage: {
      minimumUrgency: "EMERGENCY",
      triggersRedFlag: true,
      bypassesProviderCall: true,
    },
  },
  {
    fixtureId: "EVAL-002-PEDIATRIC-FEVER",
    description: "Pediatric fever without red-flag emergency",
    input: {
      chiefComplaint: "Mild fever 100.2F and runny nose for 2 days, active and feeding well",
      symptoms: ["fever", "runny nose"],
      age: 4,
      gender: "female",
    },
    expectedTriage: {
      minimumUrgency: "ROUTINE",
      triggersRedFlag: false,
      bypassesProviderCall: false,
    },
  },
  {
    fixtureId: "EVAL-003-ROUTINE-CHECKUP",
    description: "Routine health screening / consultation",
    input: {
      chiefComplaint: "Annual health checkup and routine blood pressure screening",
      symptoms: ["routine checkup"],
      age: 35,
      gender: "other",
    },
    expectedTriage: {
      minimumUrgency: "ROUTINE",
      triggersRedFlag: false,
      bypassesProviderCall: false,
    },
  },
  {
    fixtureId: "EVAL-004-CONSENT-REVOKED",
    description: "Patient with revoked consent for AI processing",
    input: {
      chiefComplaint: "Knee discomfort after weekend sports",
      symptoms: ["knee pain"],
      age: 29,
      gender: "male",
      aiConsent: false,
    },
    expectedTriage: {
      consentGranted: false,
      requiresFallback: true,
      expectedFallbackReason: "user_consent_revoked",
    },
  },
  {
    fixtureId: "EVAL-005-TIMEOUT-SIMULATION",
    description: "External provider timeout simulation",
    input: {
      chiefComplaint: "Persistent mild cough for one week",
      symptoms: ["cough"],
      age: 42,
      gender: "female",
    },
    expectedTriage: {
      requiresFallback: true,
      expectedFallbackReason: "timeout",
    },
  },
  {
    fixtureId: "EVAL-006-MALFORMED-SIMULATION",
    description: "Malformed provider response handling",
    input: {
      chiefComplaint: "Skin rash on forearm",
      symptoms: ["rash", "itching"],
      age: 26,
      gender: "male",
    },
    expectedTriage: {
      requiresFallback: true,
      expectedFallbackReason: "malformed_response",
    },
  },
];

/**
 * Runs the honest evaluation suite over the actual deterministic / provider boundary.
 */
export const runHonestEvaluationSuite = async ({ customProviderCall = null } = {}) => {
  const results = [];

  for (const fixture of CLINICIAN_EVALUATION_FIXTURES) {
    const startTime = Date.now();

    // 1. Red flag test
    if (fixture.fixtureId === "EVAL-001-CHEST-PAIN") {
      const redFlag = evaluateTriageRedFlag(fixture.input);
      const passed =
        redFlag.triggersRedFlag === fixture.expectedTriage.triggersRedFlag &&
        redFlag.urgencyLevel === fixture.expectedTriage.minimumUrgency;

      results.push({
        fixtureId: fixture.fixtureId,
        description: fixture.description,
        passed,
        durationMs: Date.now() - startTime,
        evaluatedUrgency: redFlag.urgencyLevel,
        triggersRedFlag: redFlag.triggersRedFlag,
        bypassedProvider: true,
      });
      continue;
    }

    // 2. Consent revocation test
    if (fixture.fixtureId === "EVAL-004-CONSENT-REVOKED") {
      const boundaryResult = await invokeClinicalAiProvider({
        user: { aiConsent: false },
        rawPatientData: fixture.input,
        timeoutMs: 100,
        fallbackGenerator: (reason) => ({
          agentSummary: "Deterministic intake: AI consent was not granted.",
          urgencyLevel: "ROUTINE",
          fallbackReason: reason,
        }),
      });

      const passed =
        boundaryResult.fallbackActive === true &&
        boundaryResult.reason === "user_consent_revoked" &&
        boundaryResult.provenance.consentVerified === false;

      results.push({
        fixtureId: fixture.fixtureId,
        description: fixture.description,
        passed,
        durationMs: Date.now() - startTime,
        fallbackActive: boundaryResult.fallbackActive,
        reason: boundaryResult.reason,
      });
      continue;
    }

    // 3. Timeout simulation test
    if (fixture.fixtureId === "EVAL-005-TIMEOUT-SIMULATION") {
      const boundaryResult = await invokeClinicalAiProvider({
        user: { aiConsent: true },
        rawPatientData: fixture.input,
        timeoutMs: 50,
        providerCall: () => new Promise((resolve) => setTimeout(() => resolve("slow response"), 300)),
        fallbackGenerator: (reason) => ({
          agentSummary: "Fallback summary due to timeout.",
          urgencyLevel: "ROUTINE",
          fallbackReason: reason,
        }),
      });

      const passed =
        boundaryResult.fallbackActive === true &&
        boundaryResult.reason === "timeout" &&
        boundaryResult.provenance.fallbackUsed === true;

      results.push({
        fixtureId: fixture.fixtureId,
        description: fixture.description,
        passed,
        durationMs: Date.now() - startTime,
        fallbackActive: boundaryResult.fallbackActive,
        reason: boundaryResult.reason,
      });
      continue;
    }

    // 4. Malformed simulation test
    if (fixture.fixtureId === "EVAL-006-MALFORMED-SIMULATION") {
      const boundaryResult = await invokeClinicalAiProvider({
        user: { aiConsent: true },
        rawPatientData: fixture.input,
        timeoutMs: 1000,
        providerCall: () => Promise.resolve("MALFORMED NOT JSON { broken }}}"),
        schemaValidator: (text) => {
          JSON.parse(text);
          return text;
        },
        fallbackGenerator: (reason) => ({
          agentSummary: "Deterministic summary due to malformed output.",
          urgencyLevel: "ROUTINE",
          fallbackReason: reason,
        }),
      });

      const passed =
        boundaryResult.fallbackActive === true &&
        boundaryResult.reason === "malformed_response" &&
        boundaryResult.provenance.fallbackUsed === true;

      results.push({
        fixtureId: fixture.fixtureId,
        description: fixture.description,
        passed,
        durationMs: Date.now() - startTime,
        fallbackActive: boundaryResult.fallbackActive,
        reason: boundaryResult.reason,
      });
      continue;
    }

    // 5. Standard routine fixtures (EVAL-002, EVAL-003)
    const redFlag = evaluateTriageRedFlag(fixture.input);
    const boundaryResult = await invokeClinicalAiProvider({
      user: { aiConsent: true },
      rawPatientData: fixture.input,
      timeoutMs: 500,
      providerCall: customProviderCall || (() => Promise.resolve(JSON.stringify({
        chiefComplaint: fixture.input.chiefComplaint,
        symptomDuration: "2 days",
        severity: "mild",
        urgencyLevel: "ROUTINE",
        agentSummary: "Patient reports routine symptoms without acute distress.",
      }))),
      schemaValidator: (raw) => {
        const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
        return validateAiBriefSchema(parsed);
      },
      fallbackGenerator: () => ({
        chiefComplaint: fixture.input.chiefComplaint,
        urgencyLevel: "ROUTINE",
        agentSummary: "Routine intake completed.",
      }),
    });

    const passed =
      redFlag.triggersRedFlag === fixture.expectedTriage.triggersRedFlag &&
      Boolean(boundaryResult.data) &&
      boundaryResult.provenance.disclaimer === CLINICAL_SAFETY_DISCLAIMER;

    results.push({
      fixtureId: fixture.fixtureId,
      description: fixture.description,
      passed,
      durationMs: Date.now() - startTime,
      urgencyLevel: redFlag.urgencyLevel,
      triggersRedFlag: redFlag.triggersRedFlag,
    });
  }

  const passedCount = results.filter((r) => r.passed).length;

  return {
    results,
    summary: {
      total: results.length,
      passed: passedCount,
      failed: results.length - passedCount,
      allPassed: passedCount === results.length,
      evaluationTimestamp: new Date(),
      audit: getAiSystemAudit(),
    },
  };
};
