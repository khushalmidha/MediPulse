import { GoogleGenerativeAI } from "@google/generative-ai";
import OpdToken from "../model/opdToken.js";
import { getRedis } from "../services/redis.js";
import { getIO } from "../socket.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const TRIAGE_TTL_SECONDS = 45 * 60;
const triageKey = (tokenId) => `opd:triage:${tokenId}`;

const fallbackQuestion = (turn) => {
  const questions = [
    "What is the main health concern you want to discuss today?",
    "How long have you had these symptoms?",
    "On a scale of 1 to 10, how severe is it right now?",
    "Do you have any relevant medical history or current medicines?",
  ];
  return questions[Math.min(turn, questions.length - 1)];
};

const buildBrief = async ({ token, messages }) => {
  const patientText = messages.filter((item) => item.role === "patient").map((item) => item.text).join("\n");

  if (!process.env.GEMINI_API_KEY) {
    return {
      chiefComplaint: token.chiefComplaint || "Not specified",
      symptomDuration: "Captured in triage conversation",
      severity: "Captured in triage conversation",
      relevantHistory: "Captured in triage conversation",
      urgencyLevel: /chest pain|breathless|unconscious|severe bleeding/i.test(patientText) ? "HIGH" : "ROUTINE",
      agentSummary: patientText || "Patient did not provide details.",
      generatedAt: new Date(),
      conversationTurns: messages.filter((item) => item.role === "patient").length,
    };
  }

  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction:
      "You are a medical triage summarizer. Do not diagnose. Return concise JSON with chiefComplaint, symptomDuration, severity, relevantHistory, urgencyLevel, agentSummary.",
  });
  const result = await model.generateContent(`OPD token: ${token.displayToken}. Complaint: ${token.chiefComplaint || ""}. Conversation:\n${patientText}`);
  const text = result.response.text();

  try {
    const parsed = JSON.parse(text.replace(/```json|```/g, "").trim());
    return { ...parsed, generatedAt: new Date(), conversationTurns: messages.filter((item) => item.role === "patient").length };
  } catch {
    return {
      chiefComplaint: token.chiefComplaint || "Not specified",
      symptomDuration: "See summary",
      severity: "See summary",
      relevantHistory: "See summary",
      urgencyLevel: "ROUTINE",
      agentSummary: text,
      generatedAt: new Date(),
      conversationTurns: messages.filter((item) => item.role === "patient").length,
    };
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

    if (patientTurns >= 4) {
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
