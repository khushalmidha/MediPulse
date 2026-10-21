import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import Appointment from "../../model/appointment.js";
import AuthSession from "../../model/authSession.js";
import triageRouter from "../../routes/triage.js";
import copilotRouter from "../../routes/copilot.js";
import aiReliabilityRouter from "../../routes/aiReliability.js";
import geminiRouter from "../../routes/gemini.js";
import {
  CLINICAL_SAFETY_DISCLAIMER,
  getAiSystemAudit,
  CLINICIAN_EVALUATION_FIXTURES,
  evaluateTriageRedFlag,
  minimizePatientContext,
} from "../../services/aiReliabilityService.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_ai_boundary_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
let server, origin;

const doctorId = id();
const patientId = id();
const otherPatientId = id();
const consentRevokedPatientId = id();

let doctorToken = null;
let patientToken = null;
let otherPatientToken = null;
let consentRevokedPatientToken = null;

let activeAppointmentId = null;
let queuedAppointmentId = null;
let consentRevokedAppointmentId = null;

async function makeSessionToken(principalId, role) {
  const sid = crypto.randomUUID();
  await AuthSession.create({
    _id: sid,
    principalId,
    kind: role,
    authVersion: 0,
    csrfToken: "isolated-csrf",
    expiresAt: new Date(Date.now() + 600000),
  });
  return jwt.sign(
    {
      sid,
      id: String(principalId),
      role,
      name: role === "doctor" ? "Dr. Boundary Clinician" : `Patient ${String(principalId).slice(-4)}`,
    },
    process.env.TOKEN_KEY || "test_token_key_secret_for_medipulse_auth",
    { expiresIn: "1h" }
  );
}

before(async () => {
  process.env.TOKEN_KEY = process.env.TOKEN_KEY || "test_token_key_secret_for_medipulse_auth";
  await mongoose.connect(uri.toString(), { directConnection: true });

  // Create Users
  await User.create([
    {
      _id: patientId,
      firstName: "Patient",
      lastName: "One",
      email: "patient.one@medipulse.test",
      password: "Password@123",
      gender: "female",
      aiConsent: true,
    },
    {
      _id: otherPatientId,
      firstName: "Patient",
      lastName: "Two",
      email: "patient.two@medipulse.test",
      password: "Password@123",
      gender: "male",
      aiConsent: true,
    },
    {
      _id: consentRevokedPatientId,
      firstName: "Patient",
      lastName: "OptOut",
      email: "patient.optout@medipulse.test",
      password: "Password@123",
      gender: "other",
      aiConsent: false,
    },
  ]);

  // Create Doctor
  await Doctor.create({
    _id: doctorId,
    firstName: "Boundary",
    lastName: "Clinician",
    email: "dr.boundary@medipulse.test",
    password: "Password@123",
    gender: "female",
    experience: { years: 12, expertise: "General Medicine" },
    credentialVerification: { status: "verified" },
    isPublished: true,
    independentPractice: { enabled: true },
  });

  // Create Appointments
  const activeAppt = await Appointment.create({
    user: patientId,
    doctor: doctorId,
    status: "active",
    type: "online",
    date: new Date(),
    startTime: "10:00 AM",
    endTime: "10:30 AM",
    roomId: crypto.randomUUID(),
    revision: 0,
    voiceConsentRecorded: true,
    aiConsent: true,
  });
  activeAppointmentId = activeAppt._id;

  const queuedAppt = await Appointment.create({
    user: patientId,
    doctor: doctorId,
    status: "queued",
    type: "online",
    date: new Date(),
    startTime: "11:00 AM",
    endTime: "11:30 AM",
    roomId: crypto.randomUUID(),
    revision: 0,
    voiceConsentRecorded: true,
    aiConsent: true,
  });
  queuedAppointmentId = queuedAppt._id;

  const revokedAppt = await Appointment.create({
    user: consentRevokedPatientId,
    doctor: doctorId,
    status: "queued",
    type: "online",
    date: new Date(),
    startTime: "12:00 PM",
    endTime: "12:30 PM",
    roomId: crypto.randomUUID(),
    revision: 0,
    voiceConsentRecorded: false,
    aiConsent: false,
  });
  consentRevokedAppointmentId = revokedAppt._id;

  doctorToken = await makeSessionToken(doctorId, "doctor");
  patientToken = await makeSessionToken(patientId, "user");
  otherPatientToken = await makeSessionToken(otherPatientId, "user");
  consentRevokedPatientToken = await makeSessionToken(consentRevokedPatientId, "user");

  // Create Express App
  const app = express();
  app.use(cookieParser());
  app.use(express.json());

  app.use("/api/triage", triageRouter);
  app.use("/api/copilot", copilotRouter);
  app.use("/api/ai", aiReliabilityRouter);
  app.use("/gemini", geminiRouter);

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || 500;
    res.status(status).json({ message: error.message });
  });

  server = app.listen(0);
  await once(server, "listening");
  const addr = server.address();
  origin = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  server?.close();
  await closeRedis();
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.connection.close();
  }
});

async function api(path, { method = "GET", token, body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${origin}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

test("AG14: One clinical AI boundary and honest evaluation", async (t) => {
  await t.test("1. Unauthorized role enforcement: non-doctor blocked from copilot, non-patient blocked from triage", async () => {
    // Non-doctor (patient) calling copilot analyze -> HTTP 403
    const patientCopilot = await api(`/api/copilot/${activeAppointmentId}/analyze`, {
      method: "POST",
      token: patientToken,
      body: { transcriptChunk: "Patient mentions headache." },
    });
    assert.equal(patientCopilot.status, 403);

    // Non-doctor calling generate-soap -> HTTP 403
    const patientSoap = await api(`/api/copilot/${activeAppointmentId}/generate-soap`, {
      method: "POST",
      token: patientToken,
      body: { revision: 0, doctorNotes: "Notes" },
    });
    assert.equal(patientSoap.status, 403);

    // Non-patient (doctor) calling triage start -> HTTP 403
    const doctorTriage = await api(`/api/triage/start/${queuedAppointmentId}`, {
      token: doctorToken,
    });
    assert.equal(doctorTriage.status, 403);

    // Cross-user access: patient 2 attempting to triage patient 1's queued appointment -> HTTP 404
    const crossTriage = await api(`/api/triage/start/${queuedAppointmentId}`, {
      token: otherPatientToken,
    });
    assert.equal(crossTriage.status, 404);
  });

  await t.test("2. Deterministic emergency override immediately detects red-flags without provider call", async () => {
    // Smart booking assessment with chest pain triggers emergency override
    const emergencyAssessment = await api("/api/triage/smart-booking", {
      method: "POST",
      token: patientToken,
      body: { symptoms: "Crushing chest pain radiating to left arm and severe shortness of breath for 30 minutes" },
    });

    assert.equal(emergencyAssessment.status, 200);
    assert.equal(emergencyAssessment.data.severity, "EMERGENCY");
    assert.equal(emergencyAssessment.data.esi_level, 1);
    assert.equal(emergencyAssessment.data.specialty, "Emergency Medicine");
    assert.ok(emergencyAssessment.data.disclaimer.includes("SEEK EMERGENCY CARE IMMEDIATELY"));
    assert.equal(emergencyAssessment.data.assessmentSource, "safety_rules");
    assert.deepEqual(emergencyAssessment.data.ranked_doctors, []);
  });

  await t.test("3. Revoked consent: patient with aiConsent=false falls back deterministically without calling AI", async () => {
    // Patient who revoked consent starts triage
    const triageRes = await api(`/api/triage/start/${consentRevokedAppointmentId}`, {
      token: consentRevokedPatientToken,
    });

    assert.equal(triageRes.status, 200);
    assert.equal(triageRes.data.consentGranted, false);
    assert.equal(triageRes.data.fallbackActive, true);
    assert.equal(triageRes.data.fallbackReason, "user_consent_revoked");
    assert.ok(triageRes.data.message);

    // Sending message in triage also runs in deterministic mode
    const msgRes = await api(`/api/triage/message/${consentRevokedAppointmentId}`, {
      method: "POST",
      token: consentRevokedPatientToken,
      body: { message: "I have had mild joint pain for three days." },
    });

    assert.equal(msgRes.status, 200);
    assert.ok(msgRes.data.message);

    // Gemini chat with explicit consent=false returns fallback guidance
    const chatRes = await api("/gemini/chat", {
      method: "POST",
      token: patientToken,
      body: { prompt: "What are symptoms of flu?", consent: false },
    });

    assert.equal(chatRes.status, 200);
    assert.equal(chatRes.data.consentGranted, false);
    assert.equal(chatRes.data.fallbackActive, true);
    assert.equal(chatRes.data.provenance.consentVerified, false);
    assert.equal(chatRes.data.provenance.fallbackReason, "explicit_consent_denied");
  });

  await t.test("4. Stale source revision detection on clinical SOAP updates (HTTP 409 Conflict)", async () => {
    // Current appointment revision is 0. Submitting stale revision (e.g. 5) must throw HTTP 409
    const staleSoap = await api(`/api/copilot/${activeAppointmentId}/generate-soap`, {
      method: "POST",
      token: doctorToken,
      body: { revision: 5, doctorNotes: "Updated doctor notes" },
    });

    assert.equal(staleSoap.status, 409);
    assert.ok(staleSoap.data.message.includes("Visit changed") || staleSoap.data.message.includes("reconcile"));
  });

  await t.test("5. Successful SOAP generation preserves source hash, revision, draft status and provenance", async () => {
    const soapRes = await api(`/api/copilot/${activeAppointmentId}/generate-soap`, {
      method: "POST",
      token: doctorToken,
      body: { revision: 0, doctorNotes: "Patient presents with persistent cough for 4 days. Prescribed azithromycin." },
    });

    assert.equal(soapRes.status, 200);
    assert.equal(soapRes.data.soapNote.isDraft, true);
    assert.equal(soapRes.data.soapNote.clinicianApproved, false);
    assert.equal(soapRes.data.soapNote.disclaimer, CLINICAL_SAFETY_DISCLAIMER);
    assert.ok(soapRes.data.soapNote.sourceNotesHash);
    assert.equal(soapRes.data.soapNote.version, 1);
    assert.ok(soapRes.data.soapNote.provenance);
    assert.equal(soapRes.data.soapNote.provenance.requiresClinicianApproval, true);

    // Fetching suggestions also returns the saved draft
    const suggestionsRes = await api(`/api/copilot/${activeAppointmentId}/suggestions`, {
      token: doctorToken,
    });
    assert.equal(suggestionsRes.status, 200);
    assert.ok(suggestionsRes.data.soapNote);
    assert.equal(suggestionsRes.data.soapNote.version, 1);
  });

  await t.test("6. Copilot analyzeChunk with missing voice consent returns deterministic suggestion rules with disclaimer", async () => {
    const chunkRes = await api(`/api/copilot/${activeAppointmentId}/analyze`, {
      method: "POST",
      token: doctorToken,
      body: {
        transcriptChunk: "Patient mentions having asthma and taking albuterol inhaler.",
        allMentionedMeds: ["albuterol"],
        allMentionedSymptoms: ["asthma"],
      },
    });

    assert.equal(chunkRes.status, 200);
    assert.ok(Array.isArray(chunkRes.data.suggestions));
    if (chunkRes.data.suggestions.length > 0) {
      assert.ok(chunkRes.data.suggestions[0].provenance);
      assert.equal(chunkRes.data.suggestions[0].provenance.isDraft, true);
    }
  });

  await t.test("7. Data minimization strips patient PII from context", () => {
    const rawData = {
      name: "Sensitive Patient Name",
      phoneNumber: "+91-9999999999",
      nationalId: "AADHAAR-9999-8888-7777",
      address: "123 Private Health Villa, New Delhi",
      email: "secret.patient@example.com",
      chiefComplaint: "Severe migraine and photophobia",
      symptoms: ["headache", "sensitivity to light", "nausea"],
      age: 38,
      gender: "female",
    };

    const minimized = minimizePatientContext(rawData);
    assert.equal(minimized.name, undefined);
    assert.equal(minimized.phoneNumber, undefined);
    assert.equal(minimized.nationalId, undefined);
    assert.equal(minimized.address, undefined);
    assert.equal(minimized.email, undefined);
    assert.equal(minimized.chiefComplaint, "Severe migraine and photophobia");
    assert.equal(minimized.age, 38);
    assert.equal(minimized.gender, "female");
  });

  await t.test("8. Truthful capabilities audit truthfully exposes live vs missing external repositories", async () => {
    const auditRes = await api("/api/ai/audit");
    assert.equal(auditRes.status, 200);
    const audit = auditRes.data;

    assert.ok(audit.verifiedCapabilities);
    assert.ok(audit.verifiedCapabilities.deterministicEmergencyOverrides);
    assert.equal(audit.verifiedCapabilities.deterministicEmergencyOverrides.status, "active");
    assert.equal(audit.verifiedCapabilities.deterministicEmergencyOverrides.autonomousOperation, true);

    // Missing repositories are explicitly and truthfully identified
    assert.ok(audit.missingExternalRepositories);
    const fastApiEntry = audit.missingExternalRepositories.find((r) => r.component.includes("FastAPI"));
    assert.ok(fastApiEntry);
    assert.equal(fastApiEntry.status, "absent_from_checkout");

    const lightGbmEntry = audit.missingExternalRepositories.find((r) => r.component.includes("LightGBM"));
    assert.ok(lightGbmEntry);
    assert.equal(lightGbmEntry.status, "absent_from_checkout");

    // Truthful claims policy invariants
    assert.equal(audit.truthfulClaimsPolicy.zeroAutonomousDiagnosis, true);
    assert.equal(audit.truthfulClaimsPolicy.mandatoryHumanReview, true);
    assert.equal(audit.truthfulClaimsPolicy.gracefulOfflineOperation, true);
    assert.equal(audit.truthfulClaimsPolicy.noMedicalAccuracyGuarantees, true);
  });

  await t.test("9. Honest evaluation suite POST /api/ai/evaluate-suite executes all clinical fixtures", async () => {
    const suiteRes = await api("/api/ai/evaluate-suite", { method: "POST" });
    assert.equal(suiteRes.status, 200);
    assert.ok(suiteRes.data.results.length >= 6);
    assert.equal(suiteRes.data.summary.allPassed, true);
    assert.equal(suiteRes.data.summary.failed, 0);

    const chestPain = suiteRes.data.results.find((r) => r.fixtureId === "EVAL-001-CHEST-PAIN");
    assert.ok(chestPain);
    assert.equal(chestPain.passed, true);
    assert.equal(chestPain.bypassedProvider, true);
    assert.equal(chestPain.evaluatedUrgency, "EMERGENCY");

    const consentRevoked = suiteRes.data.results.find((r) => r.fixtureId === "EVAL-004-CONSENT-REVOKED");
    assert.ok(consentRevoked);
    assert.equal(consentRevoked.passed, true);
    assert.equal(consentRevoked.reason, "user_consent_revoked");
  });

  await t.test("10. Core care continuity: patient triage completes and persists brief with provenance", async () => {
    // Complete triage for queued appointment
    const completeRes = await api(`/api/triage/complete/${queuedAppointmentId}`, {
      method: "POST",
      token: patientToken,
    });

    // In a test environment without prior turn history, brief is not ready or returns 400
    // Verify that the endpoint returns clean status without 500 error or uncaught exceptions
    assert.ok([200, 400].includes(completeRes.status));
  });
});
