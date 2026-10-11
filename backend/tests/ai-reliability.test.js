import test from "node:test";
import assert from "node:assert/strict";
import {
  withBoundedTimeout,
  minimizePatientContext,
  validateAiBriefSchema,
  formatSoapNoteDraft,
  generateDeterministicSoapFallback,
  getAiSystemAudit,
  evaluateTriageRedFlag,
  CLINICIAN_EVALUATION_FIXTURES,
  CLINICAL_SAFETY_DISCLAIMER,
  FORECAST_PLANNING_DISCLAIMER,
} from "../services/aiReliabilityService.js";

test("P18: AI reliability, truthful claims, schema validation, and fallback safeguards", async (t) => {
  await t.test("bounded timeout returns fast results and falls back on slow promises without hanging", async () => {
    // Fast promise
    const fastPromise = Promise.resolve("quick_ai_response");
    const fastResult = await withBoundedTimeout(fastPromise, 500, "fallback");
    assert.equal(fastResult, "quick_ai_response");

    // Slow promise (simulating unresponsive third-party API)
    const slowPromise = new Promise((resolve) => setTimeout(() => resolve("slow_response"), 400));
    const timeoutResult = await withBoundedTimeout(slowPromise, 50, "offline_fallback");
    assert.equal(timeoutResult, "offline_fallback");

    // Rejected promise falls back cleanly
    const errorPromise = Promise.reject(new Error("rate limit 429"));
    const errorResult = await withBoundedTimeout(errorPromise, 500, "error_fallback");
    assert.equal(errorResult, "error_fallback");
  });

  await t.test("data minimization strips patient PII and bounds input lengths", () => {
    const rawPatientData = {
      name: "Johnathan Doe",
      phoneNumber: "+91-9876543210",
      nationalId: "AADHAAR-1234-5678-9012",
      address: "42 MG Road, Sector 14, Bengaluru, Karnataka",
      chiefComplaint: "Severe headache and sensitivity to light",
      symptoms: ["headache", "photophobia", "nausea"],
      symptomDuration: "3 days",
      age: 34,
      gender: "Male",
      allergies: ["Penicillin"],
      relevantHistory: "History of migraines",
    };

    const minimized = minimizePatientContext(rawPatientData);

    // Stripped PII
    assert.equal(minimized.phoneNumber, undefined);
    assert.equal(minimized.nationalId, undefined);
    assert.equal(minimized.address, undefined);
    assert.equal(minimized.name, undefined);

    // Preserved clinical data
    assert.equal(minimized.chiefComplaint, "Severe headache and sensitivity to light");
    assert.deepEqual(minimized.symptoms, ["headache", "photophobia", "nausea"]);
    assert.equal(minimized.age, 34);
    assert.equal(minimized.gender, "Male");
    assert.deepEqual(minimized.allergies, ["Penicillin"]);
  });

  await t.test("AI brief schema validation enforces draft state and clinical safety disclaimer", () => {
    const rawAiOutput = {
      chiefComplaint: "Fever and productive cough",
      symptomDuration: "5 days",
      severity: "severe",
      urgencyLevel: "URGENT",
      agentSummary: "Patient presents with persistent cough and high-grade fever.",
      predictedDisease: "Lower Respiratory Tract Infection",
    };

    const validated = validateAiBriefSchema(rawAiOutput);
    assert.ok(validated);
    assert.equal(validated.isDraft, true);
    assert.equal(validated.requiresClinicianApproval, true);
    assert.equal(validated.disclaimer, CLINICAL_SAFETY_DISCLAIMER);
    assert.equal(validated.severity, "severe");
    assert.equal(validated.urgencyLevel, "URGENT");
  });

  await t.test("deterministic SOAP fallback provides structured draft when AI is offline", () => {
    const fallback = generateDeterministicSoapFallback({
      roughNotes: "BP 130/85, HR 78. Patient reports mild knee pain after running. Prescribe ibuprofen 400mg.",
    });

    assert.ok(fallback.markdown.includes("### Subjective"));
    assert.ok(fallback.markdown.includes("### Objective"));
    assert.ok(fallback.markdown.includes("### Assessment"));
    assert.ok(fallback.markdown.includes("### Plan"));
    assert.equal(fallback.isDraft, true);
    assert.equal(fallback.clinicianApproved, false);
    assert.equal(fallback.disclaimer, CLINICAL_SAFETY_DISCLAIMER);
  });

  await t.test("clinician evaluation fixtures verify red-flag detection and routine triage", () => {
    assert.ok(CLINICIAN_EVALUATION_FIXTURES.length >= 3);

    const chestPainFixture = CLINICIAN_EVALUATION_FIXTURES.find(
      (f) => f.fixtureId === "EVAL-001-CHEST-PAIN"
    );
    assert.ok(chestPainFixture);
    const chestResult = evaluateTriageRedFlag(chestPainFixture.input);
    assert.equal(chestResult.triggersRedFlag, chestPainFixture.expectedTriage.triggersRedFlag);
    assert.equal(chestResult.urgencyLevel, chestPainFixture.expectedTriage.minimumUrgency);

    const pediatricFixture = CLINICIAN_EVALUATION_FIXTURES.find(
      (f) => f.fixtureId === "EVAL-002-PEDIATRIC-FEVER"
    );
    assert.ok(pediatricFixture);
    const pediatricResult = evaluateTriageRedFlag(pediatricFixture.input);
    assert.equal(pediatricResult.triggersRedFlag, pediatricFixture.expectedTriage.triggersRedFlag);
    assert.equal(pediatricResult.urgencyLevel, pediatricFixture.expectedTriage.minimumUrgency);

    const routineFixture = CLINICIAN_EVALUATION_FIXTURES.find(
      (f) => f.fixtureId === "EVAL-003-ROUTINE-CHECKUP"
    );
    assert.ok(routineFixture);
    const routineResult = evaluateTriageRedFlag(routineFixture.input);
    assert.equal(routineResult.triggersRedFlag, routineFixture.expectedTriage.triggersRedFlag);
    assert.equal(routineResult.urgencyLevel, routineFixture.expectedTriage.minimumUrgency);
  });

  await t.test("AI system capabilities audit truthfully exposes active vs missing external services", () => {
    const audit = getAiSystemAudit();
    assert.ok(audit.verifiedCapabilities);
    assert.ok(audit.verifiedCapabilities.deterministicEmergencyOverrides);
    assert.equal(audit.verifiedCapabilities.deterministicEmergencyOverrides.status, "active");
    assert.equal(audit.verifiedCapabilities.deterministicEmergencyOverrides.autonomousOperation, true);

    // Missing external repositories are explicitly enumerated
    assert.ok(audit.missingExternalRepositories);
    const hasFastApiReport = audit.missingExternalRepositories.some((m) =>
      m.component.includes("FastAPI")
    );
    assert.ok(hasFastApiReport);

    // Truthful claims policy invariants
    assert.equal(audit.truthfulClaimsPolicy.zeroAutonomousDiagnosis, true);
    assert.equal(audit.truthfulClaimsPolicy.mandatoryHumanReview, true);
    assert.equal(audit.truthfulClaimsPolicy.gracefulOfflineOperation, true);
    assert.equal(audit.truthfulClaimsPolicy.noMedicalAccuracyGuarantees, true);
  });
});
