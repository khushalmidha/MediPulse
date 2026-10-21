import { flagRedSymptoms } from "../services/copilotTools.js";
import { GoogleGenerativeAI, GoogleGenerativeAIAbortError, SchemaType } from "@google/generative-ai";
import {
  evaluateTriageRedFlag,
  getSmartBookingModel,
  withBoundedTimeout,
  checkAiConsent,
  createAiProvenance,
  CLINICAL_SAFETY_DISCLAIMER,
} from "../services/aiReliabilityService.js";
import axios from "axios";
import User from "../model/user.js";
import { getIO } from "../socket.js";
import { getRedis } from "../services/redis.js";
import {
  classifyUrgency,
  generatePatientBrief,
  getPatientContext,
  triageToolHandlers,
  triageTools,
} from "../services/triageTools.js";
import { nlpManager } from "../services/huggingfaceAPI.js";
import { ranker } from "../services/ranker.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const TRIAGE_TTL_SECONDS = 30 * 60;
const MAX_TOOL_ITERATIONS = 2;
const MAX_PATIENT_MESSAGES = 10;
const ML_CONFIDENCE_THRESHOLD = Number(process.env.ML_CONFIDENCE_THRESHOLD || 0.3);

const conversationKey = (appointmentId) => `triage:conv:${appointmentId}`;

const systemPrompt = (patientContext) => `You are a pre-consultation medical triage assistant for MediPulse. 
You are talking to a patient before their telemedicine appointment.

Your job:
1. Begin by asking how you can help them today. 
2. Ask one question at a time to naturally explore their main complaint. If they already gave symptoms, follow up on them instead of asking generically.
3. Be empathetic, concise, and conversational. Do not sound like a robot reading a script.
4. After gathering enough information, call the classify_urgency tool, then call generate_patient_brief tool
4. If urgency is EMERGENCY, immediately tell the patient to seek emergency care (ER / call 112) before completing the brief

Rules:
- Do NOT diagnose. You are gathering information only.
  - Always communicate in ${patientContext.language || 'English'}.
- Do NOT suggest medications.
- If patient goes off-topic, gently redirect to their health concern.
- Keep questions simple — patient may not have medical knowledge.
- Language: Always respond exclusively in ${patientContext.language || 'English'} regardless of the patient's language.
- Brief must be professional and in English regardless of conversation language (it's for the doctor).

You already have this base context about the patient: ${JSON.stringify(patientContext.patient)}

IMPORTANT: The system has performed a Semantic Search (RAG) on the patient's past medical records based on their current symptoms.
Relevant Historical Medical Records:
${patientContext.relevantMedicalHistoryFromRAG || "No historical context available yet."}

If this history is relevant to their current complaint, use it to guide your questions (e.g. "I see you had chest pain two years ago...").`;

const buildModel = (patientContext) =>
  genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt(patientContext),
    tools: [{ functionDeclarations: triageTools }],
  });

const parseFunctionArgs = (args) => {
  if (!args) return {};
  if (typeof args === "string") {
    try {
      return JSON.parse(args);
    } catch {
      return {};
    }
  }
  return args;
};

const extractText = (response) => {
  try {
    const text = response.text();
    if (text) return text;
  } catch {
    // fall through to manual extraction
  }

  const parts = response.candidates?.[0]?.content?.parts || [];
  return parts
    .map((part) => part.text)
    .filter(Boolean)
    .join("\n")
    .trim();
};

const readConversation = async (userId) => {
  const raw = await getRedis().get(conversationKey(userId));
  return raw ? JSON.parse(raw) : null;
};

const saveConversation = async (appointmentId, state) => {
  await getRedis().set(
    conversationKey(appointmentId),
    JSON.stringify(state),
    "EX",
    TRIAGE_TTL_SECONDS,
  );
};

import Appointment from "../model/appointment.js";

const loadAuthorizedQueuedAppointment = async (userId, appointmentId) => {
  const user = await User.findById(userId);
  if (!user) {
    return { status: 404, message: "User not found" };
  }
  const appointment = await Appointment.findOne({ _id: appointmentId, user: userId });
  if (!appointment) {
    return { status: 404, message: "Appointment not found" };
  }
  if (appointment.status !== "queued") {
    return { status: 400, message: "Triage is only available for queued appointments" };
  }
  return { user, appointment };
};

const fallbackFirstQuestion = (context) =>
  `Hi ${context.patient.name}. Before your appointment, what is the main health concern you want to discuss today?`;

const forceCompleteFromHistory = async (state) => {
  const patientMessages = state.messages
    .filter((message) => message.role === "patient")
    .map((message) => message.text);
  const symptomText = patientMessages.join(" ");
  const urgency = classifyUrgency({
    symptoms: [symptomText],
    duration: symptomText,
    severity: symptomText,
  });
  const brief = await generatePatientBrief({
    symptoms: [symptomText || "Not provided"],
    duration: "Not fully captured",
    severity: "Not fully captured",
    history: state.patientContext?.patient?.primaryCondition || "Not provided",
    urgencyLevel: urgency.urgencyLevel,
    conversationTurns: state.turnCount,
  });
  return { ...brief, urgencyLevel: urgency.urgencyLevel };
};

const getFallbackResponse = async (state) => {
  const patientTurns = state.messages.filter((message) => message.role === "patient").length;
  if (patientTurns >= 3) {
    return {
      text: "Thanks. I have enough information to prepare your doctor summary.",
      brief: await forceCompleteFromHistory(state),
    };
  }
  const questions = [
    "How long have you had these symptoms?",
    "On a scale of 1 to 10, how severe is it right now?",
    "Do you have any relevant medical history?",
  ];
  return { text: questions[Math.min(patientTurns, questions.length - 1)] };
};

const callAgent = async (state, { hasConsent = true } = {}) => {
  if (!hasConsent) {
    return getFallbackResponse(state);
  }
  if (!process.env.GEMINI_API_KEY) {
    return getFallbackResponse(state);
  }

  const model = buildModel(state.patientContext);
  let result;
  try {
    result = await withBoundedTimeout(
      model.generateContent({ contents: state.contents }),
      6000,
      null
    );
    if (!result) {
      console.warn("Gemini timed out, falling back to basic triage");
      return getFallbackResponse(state);
    }
  } catch (error) {
    console.warn("Gemini failed (e.g. rate limit), falling back to basic triage:", error.message);
    return getFallbackResponse(state);
  }
  let response = result.response;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const calls = response.functionCalls?.() || [];
    if (!calls.length) {
      return { text: extractText(response) || "Could you tell me a little more?" };
    }

    const modelParts = calls.map((call) => ({
      functionCall: {
        name: call.name,
        args: parseFunctionArgs(call.args),
      },
    }));
    state.contents.push({ role: "model", parts: modelParts });

    let generatedBrief = null;
    const functionResponseParts = [];
    
    for (const call of calls) {
      const args = parseFunctionArgs(call.args);
      const handler = triageToolHandlers[call.name];
      if (!handler) continue;
      const toolResult = await handler({
        ...args,
        userId: state.userId,
        conversationTurns: state.turnCount,
      });
      if (call.name === "generate_patient_brief") {
        generatedBrief = toolResult;
        state.brief = toolResult;
      }
      functionResponseParts.push({
        functionResponse: {
          name: call.name,
          response: toolResult,
        },
      });
    }

    if (functionResponseParts.length > 0) {
      state.contents.push({ role: "function", parts: functionResponseParts });
    }

    if (generatedBrief) {
      return {
        text:
          generatedBrief.urgencyLevel === "EMERGENCY"
            ? "Please seek emergency care immediately. Call 112 or go to the nearest ER. I have also prepared your doctor summary."
            : "Thanks. I have prepared your doctor summary for the appointment.",
        brief: generatedBrief,
      };
    }

    try {
      result = await withBoundedTimeout(
        model.generateContent({ contents: state.contents }),
        6000,
        null
      );
      if (!result) return getFallbackResponse(state);
      response = result.response;
    } catch (error) {
      console.warn("Gemini failed on subsequent turn:", error.message);
      return getFallbackResponse(state);
    }
  }

  return {
    text: "Thanks. I have enough information to prepare your doctor summary.",
    brief: await forceCompleteFromHistory(state),
  };
};

const startTriage = async (req, res) => {
  try {
    if (req.auth.role !== "user") {
      return res.status(403).json({ message: "Only patients can start triage" });
    }

    const userId = req.auth.id;
    const { appointmentId } = req.params;
    const access = await loadAuthorizedQueuedAppointment(userId, appointmentId);
    if (access.status) return res.status(access.status).json({ message: access.message });

    const patientContext = await getPatientContext({ userId });
    patientContext.language = req.query.lang || req.body.lang || 'English';
    const firstPrompt = "Start the triage. Ask only the first focused question.";

    const consent = checkAiConsent({
      user: access.user,
      appointment: access.appointment,
      explicitConsent: req.body?.aiConsent,
    });

    const state = {
      userId,
      patientContext,
      turnCount: 0,
      messages: [],
      contents: [{ role: "user", parts: [{ text: firstPrompt }] }],
      brief: null,
      aiConsentRevoked: !consent.consentGranted,
    };

    let question = fallbackFirstQuestion(patientContext);
    if (process.env.GEMINI_API_KEY && consent.consentGranted) {
      try {
        const result = await withBoundedTimeout(
          buildModel(patientContext).generateContent({ contents: state.contents }),
          6000,
          null
        );
        if (result) {
          question = extractText(result.response) || question;
        }
      } catch (error) {
        console.error("Triage start Gemini failed:", error.message);
      }
    }

    state.contents.push({ role: "model", parts: [{ text: question }] });
    state.messages.push({ role: "agent", text: question });
    await saveConversation(appointmentId, state);

    return res.status(200).json({
      message: question,
      isBriefReady: false,
      patientContext,
      consentGranted: consent.consentGranted,
      fallbackActive: !consent.consentGranted,
      fallbackReason: consent.reason || null,
    });
  } catch (error) {
    // FIXED: The response leaked the internal message and full stack trace to the client.
    console.error("Triage start failed:", error);
    return res.status(500).json({
      message: "AI is temporarily unavailable, please try again shortly",
    });

  }
};

const sendMessage = async (req, res) => {
  try {
    if (req.auth.role !== "user") {
      return res.status(403).json({ message: "Only patients can use triage" });
    }
    const userId = req.auth.id;
    const { appointmentId } = req.params;
    const { message = "" } = req.body;
    const trimmed = message.trim();
    if (!trimmed) {
      return res.status(400).json({ message: "Message is required" });
    }

    const access = await loadAuthorizedQueuedAppointment(userId, appointmentId);
    if (access.status) return res.status(access.status).json({ message: access.message });

    let state = await readConversation(appointmentId);
    if (state && state.patientContext) {
      state.patientContext.language = req.query.lang || req.body.lang || state.patientContext.language;
    }
    if (!state) {
      const patientContext = await getPatientContext({ userId });
    patientContext.language = req.query.lang || req.body.lang || 'English';
      state = {
        userId,
        patientContext,
        turnCount: 0,
        messages: [],
        contents: [],
        brief: null,
        sessionExpired: true,
      };
    }

    state.turnCount += 1;
    state.messages.push({ role: "patient", text: trimmed });
    state.contents.push({ role: "user", parts: [{ text: trimmed }] });

    const consent = checkAiConsent({
      user: access.user,
      appointment: access.appointment,
      explicitConsent: req.body?.aiConsent,
    });
    const hasConsent = consent.consentGranted && !state.aiConsentRevoked;

    const patientMessageCount = state.messages.filter(
      (entry) => entry.role === "patient",
    ).length;
    const agentResult =
      patientMessageCount >= MAX_PATIENT_MESSAGES
        ? {
            text: "Thanks. I will prepare your doctor summary from what you shared.",
            brief: await forceCompleteFromHistory(state),
          }
        : await callAgent(state, { hasConsent });

    state.messages.push({ role: "agent", text: agentResult.text });
    state.contents.push({ role: "model", parts: [{ text: agentResult.text }] });

    if (agentResult.brief) {
      state.brief = {
        ...agentResult.brief,
        generatedAt: agentResult.brief.generatedAt || new Date(),
        conversationTurns: state.turnCount,
        isDraft: true,
        requiresClinicianApproval: true,
        disclaimer: CLINICAL_SAFETY_DISCLAIMER,
        provenance: createAiProvenance({
          provider: hasConsent && process.env.GEMINI_API_KEY ? "google_gemini" : "deterministic_rules",
          model: "gemini-2.5-flash",
          consentVerified: hasConsent,
          fallbackUsed: !hasConsent || !process.env.GEMINI_API_KEY,
          fallbackReason: !hasConsent ? consent.reason : (!process.env.GEMINI_API_KEY ? "provider_not_configured" : null),
        }),
      };
    }

    await saveConversation(appointmentId, state);

    return res.status(200).json({
      message: state.sessionExpired
        ? `Session expired, let's start over. ${agentResult.text}`
        : agentResult.text,
      isBriefReady: Boolean(state.brief),
      urgencyLevel: state.brief?.urgencyLevel || null,
    });
  } catch (error) {
    // FIXED: Removed a leftover debug hook that wrote triage_error.log on every failure
    // (it overwrote the file each time and leaked stack traces into the repo).
    console.error("Triage message failed:", error);
    return res.status(500).json({
      message: "AI is temporarily unavailable, your appointment is unaffected",
    });

  }
};

const completeTriage = async (req, res) => {
  try {
    if (req.auth.role !== "user") {
      return res.status(403).json({ message: "Only patients can complete triage" });
    }
    const userId = req.auth.id;
    const { appointmentId } = req.params;
    const access = await loadAuthorizedQueuedAppointment(userId, appointmentId);
    if (access.status) return res.status(access.status).json({ message: access.message });

    const state = await readConversation(appointmentId);
    if (!state?.brief) {
      return res.status(400).json({ message: "Patient brief is not ready yet" });
    }

    // FIXED: Despite the "Call ML microservice" comment, the trained model at
    // DISEASE_PREDICTION_SERVICE_URL was never called - only Gemini was. So whenever Gemini hit
    // its free-tier 429 quota the prediction silently stayed "Unknown". The ML service is now
    // the primary predictor (it has no quota), with Gemini only as a fallback.
    let predictedDisease = "Unknown";
    const transcript = state.messages
      .map((m) => `${m.role}: ${m.text}`)
      .join("\n");
    const symptomText = [state.brief.chiefComplaint, state.brief.agentSummary]
      .filter(Boolean)
      .join(". ") || transcript;

    const consent = checkAiConsent({
      user: access.user,
      appointment: access.appointment,
      explicitConsent: req.body?.aiConsent,
    });

    // Use the Node.js Hugging Face API integration to predict disease
    if (symptomText.trim() && consent.consentGranted) {
      try {
        const mlData = await withBoundedTimeout(nlpManager.predictDisease(symptomText), 5000, null);
        const disease = String(mlData?.disease || "").trim();
        const confidence = Number(mlData?.confidence);
        
        if (disease && disease !== "Unknown Condition") {
          const confidencePercent = Number.isFinite(confidence)
            ? `${Math.round(confidence * 100)}%`
            : null;
          const isLowConfidence = Number.isFinite(confidence) && confidence < ML_CONFIDENCE_THRESHOLD;

          const differentials = Array.isArray(mlData?.differentials)
            ? mlData.differentials
                .slice(0, 2)
                .map((item) => String(item?.disease || "").trim())
                .filter((name) => name && name !== "Unknown Condition")
            : [];

          let label = confidencePercent ? `${disease} (${confidencePercent})` : disease;
          if (isLowConfidence) label = `${label} - low confidence, please verify`;
          if (differentials.length) label = `${label}. Also consider: ${differentials.join(", ")}`;
          predictedDisease = label;
        }
      } catch (mlError) {
        console.warn("ML disease prediction service failed:", mlError.message);
      }
    }

    if (predictedDisease === "Unknown" && consent.consentGranted) {
      try {
        const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
        const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await withBoundedTimeout(
          model.generateContent({
            contents: [{ role: "user", parts: [{ text: `Based on this patient-doctor triage conversation, predict the most likely disease or medical condition in 2-5 words only. No explanation needed.\n\nConversation:\n${transcript}` }] }]
          }),
          5000,
          null
        );
        const prediction = result ? result.response.text().trim() : "";
        if (prediction && prediction.length < 100) {
          predictedDisease = prediction;
        }
      } catch (geminiErr) {
        console.error("Gemini disease prediction failed:", geminiErr.message);
      }
    }

    if (predictedDisease === "Unknown" && state.brief.chiefComplaint) {
      // Never show a bare "Unknown" to the doctor when we at least know the complaint.
      predictedDisease = `Pending review - reported: ${state.brief.chiefComplaint}`;
    }

    const triageProfile = {
      chiefComplaint: state.brief.chiefComplaint,
      symptomDuration: state.brief.symptomDuration,
      severity: state.brief.severity,
      relevantHistory: state.brief.relevantHistory,
      urgencyLevel: state.brief.urgencyLevel,
      agentSummary: state.brief.agentSummary,
      generatedAt: new Date(state.brief.generatedAt || Date.now()),
      conversationTurns: state.brief.conversationTurns || state.turnCount,
      predictedDisease,
      isDraft: true,
      disclaimer: CLINICAL_SAFETY_DISCLAIMER,
      provenance: createAiProvenance({
        provider: consent.consentGranted && process.env.GEMINI_API_KEY ? "huggingface_gemini" : "deterministic_rules",
        model: "gemini-2.5-flash",
        consentVerified: consent.consentGranted,
        fallbackUsed: !consent.consentGranted || predictedDisease.startsWith("Pending"),
        fallbackReason: !consent.consentGranted ? consent.reason : null,
      }),
    };

    const appointment = await Appointment.findByIdAndUpdate(
      appointmentId,
      { patientBrief: triageProfile },
      { new: true },
    );
    await getRedis().del(conversationKey(appointmentId));

    return res.status(200).json({
      message: "Your doctor now has your health summary.",
      patientBrief: appointment.patientBrief,
    });
  } catch (error) {
    // FIXED: Same leftover triage_error.log debug hook removed here.
    console.error("Triage complete failed:", error);
    return res.status(500).json({
      message: "AI is temporarily unavailable, your appointment is unaffected",
    });

  }
};

export { completeTriage, sendMessage, startTriage };


export const fullAssessmentV2 = async (req, res) => {
  try {
    const { symptoms, vitals = {}, history = "", availableDoctors = [] } = req.body;
    
    if (!symptoms) {
      return res.status(400).json({ message: "Symptoms are required for assessment." });
    }

    const patientContext = { symptoms, vitals, history };

    // 1. Deterministic Safety Layer (build this first)
    const safetyCheck = await flagRedSymptoms({ symptoms, existingConditions: history });
    if (safetyCheck && safetyCheck.length > 0) {
      return res.status(200).json({
        disclaimer: "SEEK EMERGENCY CARE IMMEDIATELY. Your symptoms suggest a potentially critical condition.",
        safetyFlags: safetyCheck,
        severity: "HIGH",
        esi_level: 1,
        specialty: "Emergency Medicine",
        ranked_doctors: []
      });
    }

    // 2. Triage & Specialty Pipeline (Unified AI Assessment via Hugging Face)
    let specialty = "General Medicine";
    let severity = "LOW";
    let esi_level = 4;
    let disclaimer = "This is an AI-assisted pre-triage tool, not a diagnostic system.";
    
    try {
      const severityData = await nlpManager.predictSeverity(patientContext.symptoms + " " + patientContext.history);
      severity = severityData.level;
      esi_level = severityData.esi;

      const specialtyData = await nlpManager.predictSpecialty(patientContext.symptoms + " " + patientContext.history);
      specialty = specialtyData.name;
    } catch (e) {
      console.warn("Hugging Face API assessment failed:", e.message);
    }

    // Deterministic override if severity model says HIGH
    if (severity === "HIGH" || esi_level <= 2) {
      return res.status(200).json({
        disclaimer: "SEEK EMERGENCY CARE IMMEDIATELY. Your symptoms indicate high severity.",
        severity: severity,
        esi_level: esi_level,
        specialty: specialty === "General Medicine" ? "Emergency Medicine" : specialty,
        ranked_doctors: []
      });
    }

    // Filter available doctors by specialty (mock logic, if empty fallback to all)
    // Normally you would fetch doctors from DB where specialty matches
    // Here we map mock doctors to the schema expected by the ranker
    const candidates = availableDoctors.map(d => ({ 
      id: typeof d === "string" ? d : d._id || d.id, 
      rating: d.rating || 4.0,
      experience_years: d.experience_years || 10,
      price: d.price || 1000.0,
      is_available_today: d.is_available_today || true
    }));

    // 3. Heuristic Ranker
    let ranked_doctors = candidates;
    try {
      ranked_doctors = ranker.rankDoctors(candidates, severity);
    } catch (e) {
      console.warn("Node Ranker failed:", e.message);
    }

    return res.status(200).json({
      disclaimer,
      specialty,
      disease: "Pending Doctor Evaluation",
      severity,
      esi_level,
      ranked_doctors,
      safetyFlags: []
    });

  } catch (error) {
    return res.status(500).json({ message: "V2 assessment failed", error: error.message });
  }
};






import Doctor from '../model/doctor.js';
import { normalizeSpecialty } from '../util/normalizeSpecialty.js';
import { resolveConsultationFee } from '../config/fees.js';

export const smartBookingAssessment = async (req, res) => {
  try {
    const input = req.body?.symptoms;
    if (typeof input !== "string" || !input.trim() || input.length > 4000) {
      return res.status(400).json({ message: "Enter symptoms as text, up to 4,000 characters." });
    }
    const symptoms = input.trim();
    const safetyFlags = evaluateTriageRedFlag({ chiefComplaint: symptoms }).triggersRedFlag
      ? ["Potentially critical symptom flagged for urgent clinician review."] : [];
    if (safetyFlags.length) return res.status(200).json({
      disclaimer: "SEEK EMERGENCY CARE IMMEDIATELY. A safety rule flagged potentially critical symptoms; this is not a diagnosis.",
      disease: null, specialty: "Emergency Medicine", severity: "EMERGENCY", esi_level: 1,
      ranked_doctors: [], safetyFlags, assessmentSource: "safety_rules",
    });

    let aiData, failureReason = "provider_error";
    try {
      if (!process.env.GEMINI_API_KEY?.trim()) {
        failureReason = "not_configured";
        throw new Error("AI is not configured");
      }
      const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY.trim());
      const model = ai.getGenerativeModel({
        model: getSmartBookingModel(),
        systemInstruction: `You are an AI diagnostic routing agent for a hospital booking system. Analyze the provided symptoms and return a JSON object with:
  - "predictedDisease": best guess of the medical condition (string).
  - "specialty": the precise medical department needed (e.g. Cardiology, Dermatology, General Medicine, Orthopedics, Neurology, Pediatrics, etc.).
  - "severity": "LOW", "MEDIUM", "HIGH", or "EMERGENCY".
  - "esi_level": number from 1 (most severe) to 5 (least severe).
  Always format your response as valid JSON without markdown formatting. Your suggestion is not a confirmed diagnosis; do not recommend medications.`,
        generationConfig: { responseMimeType: "application/json", responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            predictedDisease: { type: SchemaType.STRING }, specialty: { type: SchemaType.STRING },
            severity: { type: SchemaType.STRING, enum: ["LOW", "MEDIUM", "HIGH", "EMERGENCY"] },
            esi_level: { type: SchemaType.INTEGER },
          },
          required: ["predictedDisease", "specialty", "severity", "esi_level"],
        } },
      }, { timeout: 25000 });

      const result = await withBoundedTimeout(model.generateContent({
        contents: [{ role: "user", parts: [{ text: symptoms }] }]
      }).then(value => ({ value }), error => ({ error })), 26000, null);
      if (!result) {
        failureReason = "timeout";
        throw new Error("AI response unavailable");
      }
      if (result.error) throw result.error;

      failureReason = "invalid_response";
      const rawText = result.value.response.text().trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/i, "$1");
      aiData = JSON.parse(rawText);
      if (!aiData || Array.isArray(aiData) || typeof aiData.predictedDisease !== "string" || !aiData.predictedDisease.trim()
        || typeof aiData.specialty !== "string" || !aiData.specialty.trim()
        || !["LOW", "MEDIUM", "HIGH", "EMERGENCY"].includes(aiData.severity)
        || !Number.isInteger(aiData.esi_level) || aiData.esi_level < 1 || aiData.esi_level > 5) {
        throw new Error("Invalid AI assessment");
      }
    } catch (error) {
      if (error?.status === 429) failureReason = "rate_limited";
      else if (error instanceof GoogleGenerativeAIAbortError || error?.name === "AbortError") failureReason = "timeout";
      else if ([401, 403].includes(error?.status)) failureReason = "provider_access_denied";
      else if (error?.status === 400) failureReason = "provider_request_rejected";
      else if (error?.status === 404) failureReason = "model_unavailable";
      else if (error?.status >= 500) failureReason = "provider_unavailable";
      console.error("Smart booking AI unavailable", { reason: failureReason, status: Number.isInteger(error?.status) ? error.status : null });
      return res.status(503).json({ code: "AI_ASSESSMENT_UNAVAILABLE", reason: failureReason, fallbackActive: true,
        message: (failureReason === "rate_limited" ? "AI symptom guidance has reached its provider request limit. " : "AI symptom guidance is temporarily unavailable. ")
          + "No urgency assessment was completed. Please retry later or browse doctors directly; booking remains available." });
    }

    // Determine safety flags
    const disclaimer = (aiData.severity === "EMERGENCY" || aiData.severity === "HIGH" || aiData.esi_level <= 2)
      ? "SEEK EMERGENCY CARE IMMEDIATELY. Your symptoms suggest a potentially critical condition."
      : "This is an AI assessment, not a clinical diagnosis. Please proceed to book your appointment.";

    // Normalize specialty to match database terminology
    const normalizedSpecialty = normalizeSpecialty(aiData.specialty);
    if (aiData.severity === "EMERGENCY" || aiData.severity === "HIGH" || aiData.esi_level <= 2) {
      return res.status(200).json({ disclaimer, disease: aiData.predictedDisease, specialty: normalizedSpecialty,
        severity: aiData.severity, esi_level: aiData.esi_level, ranked_doctors: [], safetyFlags: [] });
    }

    // Fetch doctors for this specialty (Doctor model uses experience.expertise, not specialty)
    let matchedDoctors = await Doctor.find({ 'experience.expertise': normalizedSpecialty })
      .select('firstName lastName experience profilePhoto clinic rating consultationFee')
      .lean();

    // If no exact match, fallback to General Medicine
    if (matchedDoctors.length === 0) {
      matchedDoctors = await Doctor.find({ 'experience.expertise': 'General Medicine' })
        .select('firstName lastName experience profilePhoto clinic rating consultationFee')
        .lean();
    }

    // If STILL empty, just return a few doctors
    if (matchedDoctors.length === 0) {
      matchedDoctors = await Doctor.find({})
        .limit(5)
        .select('firstName lastName experience profilePhoto clinic rating consultationFee')
        .lean();
    }

    return res.status(200).json({
      disclaimer,
      disease: aiData.predictedDisease || "Unknown",
      specialty: normalizedSpecialty,
      severity: aiData.severity || "MEDIUM",
      esi_level: aiData.esi_level || 4,
      ranked_doctors: matchedDoctors.map(d => ({
        _id: d._id,
        name: [d.firstName, d.lastName].filter(Boolean).join(' '),
        specialty: d.experience?.expertise || 'General Medicine',
        experience: d.experience?.years || 0,
        // FIXED: This was hardcoded to 500 while booking charged a different flat amount, so the
        // fee shown in Smart Booking never matched what was actually debited.
        fee: resolveConsultationFee(d),
        profilePicture: d.profilePhoto || null,
        clinic: d.clinic || {},
        rating: d.rating || null,
      })),
      safetyFlags: []
    });

  } catch {
    console.error("Smart booking directory unavailable");
    return res.status(503).json({ code: "DOCTOR_DIRECTORY_UNAVAILABLE",
      message: "Doctor profiles could not be loaded. Please retry or browse doctors directly." });
  }
};

