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
const MAX_TOOL_ITERATIONS = 3;
const MAX_PATIENT_MESSAGES = 10;

const conversationKey = (userId) => `triage:conv:${userId}`;

const systemPrompt = (patientContext) => `You are a pre-consultation medical triage assistant for MediPulse. 
You are talking to a patient before their telemedicine appointment.

Your job:
1. Ask 4-5 focused questions to understand their main complaint, symptom duration, severity (1-10), and any relevant medical history
2. Ask one question at a time. Be empathetic but concise.
3. After gathering enough information, call the classify_urgency tool, then call generate_patient_brief tool
4. If urgency is EMERGENCY, immediately tell the patient to seek emergency care (ER / call 112) before completing the brief

Rules:
- Do NOT diagnose. You are gathering information only.
- Do NOT suggest medications.
- If patient goes off-topic, gently redirect to their health concern.
- Keep questions simple — patient may not have medical knowledge.
- Language: if patient writes in Hindi/Hinglish, respond in Hinglish. If English, respond in English.
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

const saveConversation = async (userId, state) => {
  await getRedis().set(
    conversationKey(userId),
    JSON.stringify(state),
    "EX",
    TRIAGE_TTL_SECONDS,
  );
};

const loadAuthorizedQueuedAppointment = async (userId) => {
  const user = await User.findById(userId);
  if (!user) {
    return { status: 404, message: "User not found" };
  }
  if (user.triageProfile?.agentSummary) {
    return { status: 409, message: "Health summary already submitted" };
  }
  return { user };
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

const callAgent = async (state) => {
  if (!process.env.GEMINI_API_KEY) {
    const patientTurns = state.messages.filter((message) => message.role === "patient").length;
    if (patientTurns >= 4) {
      return {
        text: "Thanks. I have enough information to prepare your doctor summary.",
        brief: await forceCompleteFromHistory(state),
      };
    }
    const questions = [
      "How long have you had these symptoms?",
      "On a scale of 1 to 10, how severe is it right now?",
      "Do you have any relevant medical history or ongoing condition?",
      "Is there anything that makes the symptom better or worse?",
    ];
    return { text: questions[Math.min(patientTurns, questions.length - 1)] };
  }

  const model = buildModel(state.patientContext);
  let result = await model.generateContent({ contents: state.contents });
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
      state.contents.push({
        role: "function",
        parts: [
          {
            functionResponse: {
              name: call.name,
              response: toolResult,
            },
          },
        ],
      });
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

    result = await model.generateContent({ contents: state.contents });
    response = result.response;
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
    const access = await loadAuthorizedQueuedAppointment(userId);
    if (access.status) return res.status(access.status).json({ message: access.message });

    const patientContext = await getPatientContext({ userId });
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
    await saveConversation(userId, state);

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
    const { message = "" } = req.body;
    const trimmed = message.trim();
    if (!trimmed) {
      return res.status(400).json({ message: "Message is required" });
    }

    const access = await loadAuthorizedQueuedAppointment(userId);
    if (access.status) return res.status(access.status).json({ message: access.message });

    let state = await readConversation(userId);
    if (!state) {
      const patientContext = await getPatientContext({ userId });
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

    await saveConversation(userId, state);

    return res.status(200).json({
      message: state.sessionExpired
        ? `Session expired, let's start over. ${agentResult.text}`
        : agentResult.text,
      isBriefReady: Boolean(state.brief),
      urgencyLevel: state.brief?.urgencyLevel || null,
    });
  } catch (error) {
    console.error("Triage message failed:", error.message);
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
    const access = await loadAuthorizedQueuedAppointment(userId);
    if (access.status) return res.status(access.status).json({ message: access.message });

    const state = await readConversation(userId);
    if (!state?.brief) {
      return res.status(400).json({ message: "Patient brief is not ready yet" });
    }

    let predictedDisease = "Unknown";
    try {
      // Call ML microservice
      const transcript = state.messages
        .map((m) => `${m.role}: ${m.text}`)
        .join("\n");
      const mlResponse = await axios.post("http://localhost:8003/predict", { text: transcript });
      predictedDisease = mlResponse.data.disease;
    } catch (mlError) {
      console.error("ML prediction failed:", mlError.message);
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

    const user = await User.findByIdAndUpdate(
      userId,
      { triageProfile },
      { new: true },
    );
    await getRedis().del(conversationKey(userId));

    return res.status(200).json({
      message: "Your doctor now has your health summary.",
      patientBrief: user.triageProfile,
    });
  } catch (error) {
    console.error("Triage complete failed:", error.message);
    return res.status(500).json({
      message: "AI is temporarily unavailable, your appointment is unaffected",
    });
  }
};

export { completeTriage, sendMessage, startTriage };
