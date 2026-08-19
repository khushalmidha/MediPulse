import { GoogleGenerativeAI } from "@google/generative-ai";
import OpdToken from "../model/opdToken.js";
import { getRedis } from "../services/redis.js";
import { getIO } from "../socket.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const TRIAGE_TTL_SECONDS = 45 * 60;
const triageKey = (tokenId) => `opd:triage:${tokenId}`;
const TRIAGE_QUESTION_COUNT = 10;

const intakeAreas = [
  { area: "Chief complaint", keywords: /pain|fever|cough|vomit|rash|breath|headache|concern|problem|symptom/i },
  { area: "Duration and onset", keywords: /day|week|month|hour|since|started|duration|long/i },
  { area: "Severity", keywords: /\b[1-9]\b|10|mild|moderate|severe|worst/i },
  { area: "Red flags", keywords: /chest pain|breathless|unconscious|bleeding|faint|seizure|weakness|vision/i },
  { area: "Current medicines", keywords: /medicine|tablet|dose|taking|insulin|bp|thyroid|antibiotic/i },
  { area: "Allergies", keywords: /allergy|allergic|reaction|rash after|penicillin/i },
  { area: "Chronic conditions", keywords: /diabetes|hypertension|asthma|heart|kidney|liver|thyroid/i },
  { area: "Past surgery or admission", keywords: /surgery|operation|admitted|hospitalized|procedure/i },
  { area: "Family history", keywords: /family|mother|father|genetic|parents|siblings/i },
  { area: "Lifestyle or pregnancy context", keywords: /smoke|alcohol|sleep|diet|exercise|pregnant|period|lifestyle/i },
];

const fallbackQuestion = (turn) => {
  const questions = [
    "What is the main health concern you want to discuss today?",
    "When did it start, and was the onset sudden or gradual?",
    "On a scale of 1 to 10, how severe is it right now?",
    "Do you have any red-flag symptoms like chest pain, breathing difficulty, fainting, severe bleeding, seizure, or sudden weakness?",
    "Which medicines, supplements, or home remedies are you currently taking?",
    "Do you have any allergies to medicines, food, or previous injections?",
    "Do you have chronic conditions such as diabetes, BP, asthma, thyroid, heart, kidney, or liver disease?",
    "Have you had any surgery, hospital admission, or major illness before?",
    "Does anyone in your family have similar illness or major conditions that may matter?",
    "Anything else the doctor should know, such as pregnancy, lifestyle, diet, sleep, stress, or a detail not covered above?",
  ];
  return questions[Math.min(turn, questions.length - 1)];
};

const buildCoverageChecklist = (patientText) => {
  const lower = patientText || "";
  return intakeAreas.map((item) => {
    const covered = item.keywords.test(lower);
    return {
      area: item.area,
      status: covered ? "covered" : "not_covered",
      note: covered ? "Captured from patient response." : "Ask directly if clinically relevant.",
    };
  });
};

const enrichBrief = (brief, patientText, messages) => {
  const coverageChecklist = Array.isArray(brief.coverageChecklist) && brief.coverageChecklist.length
    ? brief.coverageChecklist
    : buildCoverageChecklist(patientText);
  const uncoveredAreas = coverageChecklist.filter((item) => item.status !== "covered").map((item) => item.area);
  return {
    ...brief,
    coverageChecklist,
    uncoveredAreas,
    suggestedDoctorQuestions: Array.isArray(brief.suggestedDoctorQuestions) && brief.suggestedDoctorQuestions.length
      ? brief.suggestedDoctorQuestions
      : uncoveredAreas.slice(0, 4).map((area) => `Please confirm ${area.toLowerCase()}.`),
    generatedAt: new Date(),
    conversationTurns: messages.filter((item) => item.role === "patient").length,
  };
};

const buildBrief = async ({ token, messages }) => {
  const patientText = messages.filter((item) => item.role === "patient").map((item) => item.text).join("\n");

  if (!process.env.GEMINI_API_KEY) {
    return enrichBrief({
      chiefComplaint: token.chiefComplaint || "Not specified",
      symptomDuration: "Captured in triage conversation",
      severity: "Captured in triage conversation",
      relevantHistory: "Captured in triage conversation",
      urgencyLevel: /chest pain|breathless|unconscious|severe bleeding/i.test(patientText) ? "HIGH" : "ROUTINE",
      agentSummary: patientText || "Patient did not provide details.",
    }, patientText, messages);
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction:
      "You are a medical triage summarizer. Do not diagnose. Return strict JSON with chiefComplaint, symptomDuration, severity, relevantHistory, urgencyLevel, agentSummary, coverageChecklist, uncoveredAreas, suggestedDoctorQuestions. coverageChecklist items need area,status,note.",
  });
  let text = "";
  try {
    const result = await model.generateContent(`OPD token: ${token.displayToken}. Complaint: ${token.chiefComplaint || ""}. Conversation:\n${patientText}`);
    text = result.response.text();
  } catch (error) {
    // FIXED: A Gemini outage should not block OPD consultation; doctors still get a structured fallback brief.
    return enrichBrief({
      chiefComplaint: token.chiefComplaint || "Not specified",
      symptomDuration: "Captured in triage conversation",
      severity: "Captured in triage conversation",
      relevantHistory: "Captured in triage conversation",
      urgencyLevel: /chest pain|breathless|unconscious|severe bleeding/i.test(patientText) ? "HIGH" : "ROUTINE",
      agentSummary: patientText || error.message || "Patient triage completed.",
    }, patientText, messages);
  }

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    // FIXED: The old AI brief was a plain paragraph, so missed-history areas leaked into the consultation.
    return enrichBrief(parsed, patientText, messages);
  } catch {
    return enrichBrief({
      chiefComplaint: token.chiefComplaint || "Not specified",
      symptomDuration: "See summary",
      severity: "See summary",
      relevantHistory: "See summary",
      urgencyLevel: "ROUTINE",
      agentSummary: text,
    }, patientText, messages);
  }
};

const loadPatientToken = async (tokenId, patientId) => {
  const token = await OpdToken.findOne({
    _id: tokenId,
    patientId,
    status: { $in: ["waiting", "vitals_done", "in_consultation", "completed"] },
  });
  return token;
};

export const startOpdTriage = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Only patients can start OPD triage" });
    const token = await loadPatientToken(req.params.tokenId, req.auth.id);
    if (!token) return res.status(404).json({ message: "OPD token not found for this patient" });

    const state = { messages: [{ role: "agent", text: fallbackQuestion(0), createdAt: new Date() }] };
    await getRedis().set(triageKey(token._id), JSON.stringify(state), "EX", TRIAGE_TTL_SECONDS);

    token.aiTriage.status = "in_progress";
    token.aiTriage.messages = state.messages;
    await token.save();

    res.status(200).json({ message: state.messages[0].text, isBriefReady: false, token });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to start OPD triage" });
  }
};

export const sendOpdTriageMessage = async (req, res) => {
  try {
    if (req.auth.role !== "user") return res.status(403).json({ message: "Only patients can use OPD triage" });
    const token = await loadPatientToken(req.params.tokenId, req.auth.id);
    if (!token) return res.status(404).json({ message: "OPD token not found for this patient" });

    const trimmed = String(req.body.message || "").trim();
    if (!trimmed) return res.status(400).json({ message: "Message is required" });

    const raw = await getRedis().get(triageKey(token._id));
    const state = raw ? JSON.parse(raw) : { messages: token.aiTriage?.messages || [] };
    state.messages.push({ role: "patient", text: trimmed, createdAt: new Date() });
    const patientTurns = state.messages.filter((item) => item.role === "patient").length;

    if (patientTurns >= TRIAGE_QUESTION_COUNT) {
      const patientBrief = await buildBrief({ token, messages: state.messages });
      token.aiTriage = { status: "completed", messages: state.messages, patientBrief };
      await token.save();
      await getRedis().del(triageKey(token._id));

      const io = getIO();
      if (io) io.to(`doctor:${token.doctorId}`).emit("opd:brief-ready", { tokenId: token._id, displayToken: token.displayToken });

      return res.status(200).json({ message: "Thanks. Your doctor summary is ready.", isBriefReady: true, patientBrief });
    }

    const reply = fallbackQuestion(patientTurns);
    state.messages.push({ role: "agent", text: reply, createdAt: new Date() });
    token.aiTriage.status = "in_progress";
    token.aiTriage.messages = state.messages;
    await Promise.all([
      token.save(),
      getRedis().set(triageKey(token._id), JSON.stringify(state), "EX", TRIAGE_TTL_SECONDS),
    ]);

    res.status(200).json({ message: reply, isBriefReady: false });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to continue OPD triage" });
  }
};

export const getOpdTokenAiContext = async (req, res) => {
  try {
    const token = await OpdToken.findOne({ _id: req.params.tokenId, hospitalId: req.staff.hospitalId }).lean();
    if (!token) return res.status(404).json({ message: "Token not found" });
    if (req.staff.role === "DOCTOR" && String(token.doctorId) !== req.staff.id) {
      return res.status(403).json({ message: "Only assigned doctor can view this OPD AI context" });
    }
    res.status(200).json({ aiTriage: token.aiTriage || null, doctorCopilot: token.doctorCopilot || null });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load AI context" });
  }
};

/**
 * ARCHITECTURAL NOTE: Asymmetric AI Copilot Systems
 * 
 * We intentionally maintain two asymmetric AI copilot systems:
 * 1. Telehealth (Appointment) Copilot: Uses a full, autonomous tool-calling Gemini agent 
 *    (drug-safety, red-flag checks, auto-SOAP) because remote doctors lack direct physical 
 *    examination capabilities and need extensive automated safeguards.
 * 2. Physical OPD (OpdToken) Copilot (Implemented here): Uses a simpler, single-shot 
 *    generation pattern without autonomous tools or auto-SOAP. 
 *    Reasoning: Physical hospital consultations involve direct examinations where doctors 
 *    rely on their native EMRs. The AI acts only as a quick reference/second-opinion tool 
 *    to reduce latency and token cost for high-volume physical OPD traffic.
 */
export const askDoctorCopilot = async (req, res) => {
  try {
    const token = await OpdToken.findOne({ _id: req.params.tokenId, hospitalId: req.staff.hospitalId });
    if (!token) return res.status(404).json({ message: "Token not found" });
    if (req.staff.role === "DOCTOR" && String(token.doctorId) !== req.staff.id) {
      return res.status(403).json({ message: "Only assigned doctor can use co-pilot" });
    }

    const prompt = String(req.body.prompt || "Suggest focused consultation questions").trim();
    const context = {
      displayToken: token.displayToken,
      chiefComplaint: token.chiefComplaint,
      vitals: token.vitals,
      patientBrief: token.aiTriage?.patientBrief,
    };

    let suggestion = "Review the chief complaint, confirm symptom duration and severity, check vitals, ask red-flag questions, and document follow-up advice.";
    if (process.env.GEMINI_API_KEY) {
      const model = genAI.getGenerativeModel({
        model: "gemini-2.5-flash",
        systemInstruction: "You are a doctor co-pilot. Give concise clinical workflow support. Do not diagnose. Suggest questions, red flags, and documentation points.",
      });
      const result = await model.generateContent(`Doctor request: ${prompt}\nOPD context: ${JSON.stringify(context)}`);
      suggestion = result.response.text();
    }

    token.doctorCopilot = { lastPrompt: prompt, lastSuggestion: suggestion, updatedAt: new Date() };
    await token.save();
    res.status(200).json({ suggestion, context });
  } catch (error) {
    res.status(500).json({ message: error.message || "Doctor co-pilot unavailable" });
  }
};
