import { flagRedSymptoms } from "../services/copilotTools.js";
import { GoogleGenerativeAI } from "@google/generative-ai";
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

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const TRIAGE_TTL_SECONDS = 30 * 60;
const MAX_TOOL_ITERATIONS = 2;
const MAX_PATIENT_MESSAGES = 10;

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

You already have this context about the patient: ${JSON.stringify(patientContext.patient)}`;

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

const callAgent = async (state) => {
  if (!process.env.GEMINI_API_KEY) {
    return getFallbackResponse(state);
  }

  const model = buildModel(state.patientContext);
  let result;
  try {
    result = await model.generateContent({ contents: state.contents });
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
      result = await model.generateContent({ contents: state.contents });
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
    const state = {
      userId,
      patientContext,
      turnCount: 0,
      messages: [],
      contents: [{ role: "user", parts: [{ text: firstPrompt }] }],
      brief: null,
    };

    let question = fallbackFirstQuestion(patientContext);
    if (process.env.GEMINI_API_KEY) {
      try {
        const result = await buildModel(patientContext).generateContent({
          contents: state.contents,
        });
        question = extractText(result.response) || question;
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
    });
  } catch (error) {
    console.error("Triage start failed:", error.message);
    return res.status(500).json({
      message: `AI is temporarily unavailable: ${error.message}`,
      details: error.stack,
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

    const patientMessageCount = state.messages.filter(
      (entry) => entry.role === "patient",
    ).length;
    const agentResult =
      patientMessageCount >= MAX_PATIENT_MESSAGES
        ? {
            text: "Thanks. I will prepare your doctor summary from what you shared.",
            brief: await forceCompleteFromHistory(state),
          }
        : await callAgent(state);

    state.messages.push({ role: "agent", text: agentResult.text });
    state.contents.push({ role: "model", parts: [{ text: agentResult.text }] });

    if (agentResult.brief) {
      state.brief = {
        ...agentResult.brief,
        generatedAt: agentResult.brief.generatedAt || new Date(),
        conversationTurns: state.turnCount,
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
    console.error("Triage message failed:", error.message);
    import('fs').then(fs => fs.writeFileSync('triage_error.log', 'sendMessage error: ' + error.stack));
    return res.status(500).json({
      message: "AI is temporarily unavailable, your appointment is unaffected (from sendMessage)",
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

    let predictedDisease = "Unknown";
    try {
      // Call ML microservice
      const transcript = state.messages
        .map((m) => `${m.role}: ${m.text}`)
        .join("\n");
      
      // Use Gemini to predict disease from conversation transcript
      try {
        const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
        const model = ai.getGenerativeModel({ model: "gemini-2.5-flash" });
        const result = await model.generateContent({
          contents: [{ role: "user", parts: [{ text: `Based on this patient-doctor triage conversation, predict the most likely disease or medical condition in 2-5 words only. No explanation needed.\n\nConversation:\n${transcript}` }] }]
        });
        const prediction = result.response.text().trim();
        if (prediction && prediction.length < 100) {
          predictedDisease = prediction;
        }
      } catch (geminiErr) {
        console.error("Gemini disease prediction failed:", geminiErr.message);
      }
    } catch (mlError) {
      console.error("ML prediction failed:", mlError.message);
      predictedDisease = "Unable to predict";
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
    console.error("Triage complete failed:", error.message);
    import('fs').then(fs => fs.writeFileSync('triage_error.log', 'completeTriage error: ' + error.stack));
    return res.status(500).json({
      message: "AI is temporarily unavailable, your appointment is unaffected (from completeTriage)",
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

    // 2. Specialty Pipeline
    let specialty = "General Medicine";
    let disease = "Unknown";
    const mlBaseUrl = process.env.ML_MICROSERVICE_URL || "http://127.0.0.1:8000";
    try {
      const specRes = await axios.post(`${mlBaseUrl}/v2/specialty`, patientContext);
      specialty = specRes.data.specialty || specialty;
      disease = specRes.data.disease || disease;
    } catch (e) {
      console.warn("FastAPI /v2/specialty failed or unreachable:", e.message);
    }

    // 3. Severity Model (XGBoost/extended ESI)
    let severity = "LOW";
    let esi_level = 4;
    try {
      const sevRes = await axios.post(`${mlBaseUrl}/v2/severity`, patientContext);
      severity = sevRes.data.severity || severity;
      esi_level = sevRes.data.esi_level || esi_level;
    } catch (e) {
      console.warn("FastAPI /v2/severity failed or unreachable:", e.message);
    }

    // Deterministic override if severity model says HIGH
    if (severity === "HIGH" || esi_level <= 2) {
      return res.status(200).json({
        disclaimer: "SEEK EMERGENCY CARE IMMEDIATELY. Your symptoms indicate high severity.",
        severity: severity,
        esi_level: esi_level,
        specialty: "Emergency Medicine",
        disease: disease,
        ranked_doctors: []
      });
    }

    // Filter available doctors by specialty (mock logic, if empty fallback to all)
    // Normally you would fetch doctors from DB where specialty matches
    
    const candidates = availableDoctors.map(d => ({ id: d, features: {} }));

    // 4. LambdaMART Ranker
    let ranked_doctors = candidates;
    try {
      const rankRes = await axios.post(`${mlBaseUrl}/v2/recommend-doctors`, {
        patient: patientContext,
        doctors: candidates
      });
      ranked_doctors = rankRes.data.ranked_doctors || ranked_doctors;
    } catch (e) {
      console.warn("FastAPI /v2/recommend-doctors failed or unreachable:", e.message);
    }

    return res.status(200).json({
      disclaimer: "This is an AI assessment, not a clinical diagnosis.",
      disease,
      specialty,
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

export const smartBookingAssessment = async (req, res) => {
  try {
    const { symptoms } = req.body;
    if (!symptoms) {
      return res.status(400).json({ message: "Symptoms are required for assessment." });
    }

    const ai = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
    const model = ai.getGenerativeModel({
      model: "gemini-2.5-flash",
      systemInstruction: `You are an AI diagnostic routing agent for a hospital booking system. Analyze the provided symptoms and return a JSON object with:
- "predictedDisease": best guess of the medical condition (string).
- "specialty": the precise medical department needed (e.g. Cardiology, Dermatology, General Medicine, Orthopedics, Neurology, Pediatrics, etc.).
- "severity": "LOW", "MEDIUM", "HIGH", or "EMERGENCY".
- "esi_level": number from 1 (most severe) to 5 (least severe).
Always format your response as valid JSON without markdown formatting.`
    });

    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: symptoms }] }]
    });

    let rawText = result.response.text().trim();
    const jsonMatch = rawText.match(/```json\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      rawText = jsonMatch[1].trim();
    } else {
      const codeMatch = rawText.match(/```\s*([\s\S]*?)\s*```/);
      if (codeMatch) rawText = codeMatch[1].trim();
    }

    let aiData;
    try {
      aiData = JSON.parse(rawText);
    } catch(e) {
      console.error("Failed to parse Gemini JSON:", rawText);
      aiData = { predictedDisease: "Unknown", specialty: "General Medicine", severity: "MEDIUM", esi_level: 4 };
    }

    // Determine safety flags
    const disclaimer = (aiData.severity === "EMERGENCY" || aiData.severity === "HIGH" || aiData.esi_level <= 2) 
      ? "SEEK EMERGENCY CARE IMMEDIATELY. Your symptoms suggest a potentially critical condition."
      : "This is an AI assessment, not a clinical diagnosis. Please proceed to book your appointment.";

    // Normalize specialty to match database terminology
    const normalizedSpecialty = normalizeSpecialty(aiData.specialty);

    // Fetch doctors for this specialty (Doctor model uses experience.expertise, not specialty)
    let matchedDoctors = await Doctor.find({ 'experience.expertise': normalizedSpecialty })
      .select('firstName lastName experience profilePhoto clinic rating')
      .lean();

    // If no exact match, fallback to General Medicine
    if (matchedDoctors.length === 0) {
      matchedDoctors = await Doctor.find({ 'experience.expertise': 'General Medicine' })
        .select('firstName lastName experience profilePhoto clinic rating')
        .lean();
    }
    
    // If STILL empty, just return a few doctors
    if (matchedDoctors.length === 0) {
      matchedDoctors = await Doctor.find({})
        .limit(5)
        .select('firstName lastName experience profilePhoto clinic rating')
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
        fee: 500,
        profilePicture: d.profilePhoto || null,
        clinic: d.clinic || {},
        rating: d.rating || null,
      })),
      safetyFlags: []
    });

  } catch (error) {
    console.error("Smart Booking error:", error);
    return res.status(500).json({ message: "Failed to run AI assessment", error: error.message });
  }
};


