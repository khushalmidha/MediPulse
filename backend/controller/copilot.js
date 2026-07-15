import mongoose from "mongoose";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Appointment from "../model/appointment.js";
import { getIO } from "../socket.js";
import { getRedis } from "../services/redis.js";
import {
  checkDrugSafety,
  copilotToolHandlers,
  copilotTools,
  flagRedSymptoms,
  generateSoapNote,
  getPatientContext,
  getRelevantGuideline,
} from "../services/copilotTools.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const SESSION_TTL_SECONDS = 3 * 60 * 60;
const MAX_TOOL_ITERATIONS = 4;

const transcriptKey = (appointmentId) => `copilot:transcript:${appointmentId}`;
const suggestionsKey = (appointmentId) => `copilot:suggestions:${appointmentId}`;

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

const parseJsonArray = (text) => {
  const trimmed = String(text || "").trim();
  try {
    const parsed = JSON.parse(trimmed);
    return Array.isArray(parsed) ? parsed : parsed.suggestions || [];
  } catch {
    const match = trimmed.match(/\[[\s\S]*\]/);
    if (!match) return [];
    try {
      return JSON.parse(match[0]);
    } catch {
      return [];
    }
  }
};

const normalizeSuggestion = (suggestion) => ({
  id:
    suggestion.id ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  type: ["DRUG_ALERT", "RED_FLAG", "GUIDELINE", "INFO"].includes(suggestion.type)
    ? suggestion.type
    : "INFO",
  message: String(suggestion.message || "").slice(0, 600),
  severity: ["low", "medium", "high"].includes(suggestion.severity)
    ? suggestion.severity
    : "low",
  timestamp: suggestion.timestamp || new Date().toISOString(),
  disclaimer: "AI suggestion - clinical judgment required.",
});

const readSuggestions = async (appointmentId) => {
  const raw = await getRedis().get(suggestionsKey(appointmentId));
  return raw ? JSON.parse(raw) : [];
};

const saveSuggestions = async (appointmentId, suggestions) => {
  await getRedis().set(
    suggestionsKey(appointmentId),
    JSON.stringify(suggestions.slice(-30)),
    "EX",
    SESSION_TTL_SECONDS,
  );
};

const appendTranscript = async (appointmentId, chunk) => {
  const redis = getRedis();
  const current = (await redis.get(transcriptKey(appointmentId))) || "";
  const next = `${current}\n${chunk}`.trim().slice(-24000);
  await redis.set(transcriptKey(appointmentId), next, "EX", SESSION_TTL_SECONDS);
  return next;
};

const loadDoctorAppointment = async (appointmentId, doctorId, { activeOnly = false } = {}) => {
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return { status: 400, message: "Invalid appointment id" };
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) return { status: 404, message: "Appointment not found" };
  if (appointment.doctor.toString() !== doctorId.toString()) {
    return { status: 403, message: "You cannot access this appointment" };
  }
  if (activeOnly && appointment.status !== "active") {
    return { status: 400, message: "Co-Pilot is only available during active appointments" };
  }
  return { appointment };
};

const buildSuggestionsFromToolResult = (toolName, result) => {
  if (toolName === "check_drug_safety" && result?.concerns?.length) {
    return result.concerns.map((concern) =>
      normalizeSuggestion({
        type: result.severity === "high" ? "RED_FLAG" : "DRUG_ALERT",
        message: concern,
        severity: result.severity || "medium",
      }),
    );
  }

  if (toolName === "flag_red_symptoms" && result?.hasRedFlag) {
    return [
      normalizeSuggestion({
        type: "RED_FLAG",
        message: result.message,
        severity: result.severity || "high",
      }),
    ];
  }

  if (toolName === "get_relevant_guideline" && result?.guideline) {
    return [
      normalizeSuggestion({
        type: "GUIDELINE",
        message: `${result.guideline}\n${result.source || "Based on standard clinical guidelines"}`,
        severity: "low",
      }),
    ];
  }

  return [];
};

const fallbackAnalyze = async ({
  appointmentId,
  transcriptChunk,
  allMentionedMeds,
  allMentionedSymptoms,
}) => {
  const context = await getPatientContext({ appointmentId });
  const conditions = [
    context.patient?.primaryCondition,
    context.patientBrief?.relevantHistory,
    context.patientBrief?.chiefComplaint,
  ].filter(Boolean);
  const suggestions = [];

  const drugResult = await checkDrugSafety({
    medications: allMentionedMeds,
    patientConditions: conditions,
  });
  suggestions.push(...buildSuggestionsFromToolResult("check_drug_safety", drugResult));

  const redResult = await flagRedSymptoms({
    symptoms: allMentionedSymptoms?.length ? allMentionedSymptoms : [transcriptChunk],
    patientAge: context.patient?.age,
    existingConditions: conditions,
  });
  suggestions.push(...buildSuggestionsFromToolResult("flag_red_symptoms", redResult));

  const condition = context.patientBrief?.chiefComplaint || context.patient?.primaryCondition;
  if (condition && transcriptChunk.length > 80 && suggestions.length < 2) {
    const guideline = await getRelevantGuideline({
      condition,
      context: transcriptChunk.slice(0, 500),
    });
    suggestions.push(...buildSuggestionsFromToolResult("get_relevant_guideline", guideline));
  }

  return suggestions.slice(0, 3);
};

const buildModel = () =>
  genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: `You are a medical AI co-pilot assisting a doctor during a live consultation.
Analyze the latest transcript and decide which tools to call.
Only call tools when genuinely useful. Do not spam suggestions.
Do not diagnose. Use wording like "consider evaluating" and "verify".
Return final output as JSON array only:
[{"type":"DRUG_ALERT|RED_FLAG|GUIDELINE|INFO","message":"...","severity":"low|medium|high"}]`,
    tools: [
      {
        functionDeclarations: copilotTools.filter(
          (tool) => tool.name !== "generate_soap_note",
        ),
      },
    ],
  });

const callAgent = async ({
  appointmentId,
  transcriptChunk,
  fullTranscript,
  isFirstChunk,
  allMentionedMeds,
  allMentionedSymptoms,
}) => {
  if (!process.env.GEMINI_API_KEY) {
    return fallbackAnalyze({
      appointmentId,
      transcriptChunk,
      allMentionedMeds,
      allMentionedSymptoms,
    });
  }

  const contents = [
    {
      role: "user",
      parts: [
        {
          text: `Latest transcript chunk:
${transcriptChunk}

Context summary so far:
${fullTranscript.slice(-4000)}

isFirstChunk: ${Boolean(isFirstChunk)}
Mentioned medications: ${(allMentionedMeds || []).join(", ") || "none"}
Mentioned symptoms: ${(allMentionedSymptoms || []).join(", ") || "none"}
Appointment id for get_patient_context: ${appointmentId}

Decide whether tools are needed. If nothing actionable, return [].`,
        },
      ],
    },
  ];

  const model = buildModel();
  let result = await model.generateContent({ contents });
  let response = result.response;
  let toolSuggestions = [];
  let toolCallCount = 0;

  for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
    const calls = response.functionCalls?.() || [];
    if (!calls.length) break;
    toolCallCount += calls.length;

    contents.push({
      role: "model",
      parts: calls.map((call) => ({
        functionCall: { name: call.name, args: parseFunctionArgs(call.args) },
      })),
    });

    for (const call of calls) {
      const handler = copilotToolHandlers[call.name];
      if (!handler) continue;
      const args = {
        ...parseFunctionArgs(call.args),
        appointmentId:
          call.name === "get_patient_context"
            ? appointmentId
            : parseFunctionArgs(call.args).appointmentId,
      };
      const toolResult = await handler(args);
      toolSuggestions = [
        ...toolSuggestions,
        ...buildSuggestionsFromToolResult(call.name, toolResult),
      ];
      contents.push({
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

    result = await model.generateContent({ contents });
    response = result.response;
  }

  const finalSuggestions = parseJsonArray(response.text?.() || "").map(normalizeSuggestion);
  return [...toolSuggestions, ...finalSuggestions].slice(0, 4).map((suggestion) => ({
    ...suggestion,
    toolCallCount,
  }));
};

const analyzeChunk = async (req, res) => {
  try {
    if (req.auth.role !== "doctor") {
      return res.status(403).json({ message: "Only doctors can use Co-Pilot" });
    }

    const { appointmentId } = req.params;
    const access = await loadDoctorAppointment(appointmentId, req.auth.id, {
      activeOnly: true,
    });
    if (access.status) return res.status(access.status).json({ message: access.message });

    const {
      transcriptChunk = "",
      isFirstChunk = false,
      allMentionedMeds = [],
      allMentionedSymptoms = [],
    } = req.body;
    const chunk = String(transcriptChunk || "").trim();
    if (!chunk) return res.status(200).json({ suggestions: [], toolCallCount: 0 });

    const fullTranscript = await appendTranscript(appointmentId, chunk);
    const suggestions = await callAgent({
      appointmentId,
      transcriptChunk: chunk,
      fullTranscript,
      isFirstChunk,
      allMentionedMeds,
      allMentionedSymptoms,
    });

    const normalized = suggestions.filter((suggestion) => suggestion.message).map(normalizeSuggestion);
    if (normalized.length) {
      const stored = await readSuggestions(appointmentId);
      await saveSuggestions(appointmentId, [...stored, ...normalized]);

      const io = getIO();
      if (io) {
        const payload = { appointmentId, suggestions: normalized };
        io.to(`doctor:${req.auth.id}`).emit("copilot:suggestion", payload);
        io.to(`copilot:${appointmentId}`).emit("copilot:suggestion", payload);
      }
    }

    return res.status(200).json({
      suggestions: normalized,
      toolCallCount: suggestions.reduce((sum, item) => sum + (item.toolCallCount || 0), 0),
    });
  } catch (error) {
    console.error("Copilot analyze failed:", error.message);
    return res.status(200).json({
      suggestions: [],
      message: "Co-Pilot temporarily unavailable; appointment is unaffected",
    });
  }
};

const generateSoap = async (req, res) => {
  try {
    if (req.auth.role !== "doctor") {
      return res.status(403).json({ message: "Only doctors can generate SOAP notes" });
    }

    const { appointmentId } = req.params;
    const access = await loadDoctorAppointment(appointmentId, req.auth.id);
    if (access.status) return res.status(access.status).json({ message: access.message });

    const { doctorNotes = "" } = req.body;
    const redis = getRedis();
    const [transcript, storedSuggestions] = await Promise.all([
      redis.get(transcriptKey(appointmentId)),
      readSuggestions(appointmentId),
    ]);

    const soapNote = await generateSoapNote({
      transcript: transcript || "",
      doctorNotes,
      patientBrief: access.appointment.patientBrief || null,
      agentInsights: storedSuggestions.map((suggestion) => suggestion.message),
    });

    access.appointment.soapNote = {
      ...soapNote,
      generatedAt: new Date(),
      generatedBy: "ai-copilot",
    };
    if (doctorNotes.trim()) access.appointment.doctorNotes = doctorNotes.trim();
    await access.appointment.save();
    await redis.del(transcriptKey(appointmentId), suggestionsKey(appointmentId));

    const io = getIO();
    if (io) {
      const payload = { appointmentId, soapNote: access.appointment.soapNote };
      io.to(`doctor:${req.auth.id}`).emit("copilot:soap-ready", payload);
      io.to(`copilot:${appointmentId}`).emit("copilot:soap-ready", payload);
    }

    return res.status(200).json({
      message: "SOAP note generated",
      appointmentId,
      soapNote: access.appointment.soapNote,
    });
  } catch (error) {
    console.error("Copilot SOAP failed:", error.message);
    return res.status(500).json({ message: "Could not generate SOAP note right now" });
  }
};

const getSuggestions = async (req, res) => {
  try {
    if (req.auth.role !== "doctor") {
      return res.status(403).json({ message: "Only doctors can view Co-Pilot suggestions" });
    }

    const { appointmentId } = req.params;
    const access = await loadDoctorAppointment(appointmentId, req.auth.id);
    if (access.status) return res.status(access.status).json({ message: access.message });

    return res.status(200).json({
      suggestions: await readSuggestions(appointmentId),
      soapNote: access.appointment.soapNote || null,
    });
  } catch (error) {
    console.error("Copilot suggestions failed:", error.message);
    return res.status(500).json({ message: "Could not load Co-Pilot suggestions" });
  }
};

export { analyzeChunk, generateSoap, getSuggestions };
