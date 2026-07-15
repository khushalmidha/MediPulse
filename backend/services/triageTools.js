import { GoogleGenerativeAI } from "@google/generative-ai";
import Appointment from "../model/appointment.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const normalizeText = (value) => String(value || "").toLowerCase();

const calculateAge = (dob) => {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
    age -= 1;
  }
  return age;
};

const getPatientContext = async ({ appointmentId }) => {
  const appointment = await Appointment.findById(appointmentId)
    .populate("user", "firstName lastName email medicalHistory dob dateOfBirth")
    .populate("doctor", "firstName lastName email experience");

  if (!appointment) {
    throw new Error("Appointment not found");
  }

  const patientName =
    [appointment.user?.firstName, appointment.user?.lastName].filter(Boolean).join(" ") ||
    "Patient";
  const doctorName =
    [appointment.doctor?.firstName, appointment.doctor?.lastName].filter(Boolean).join(" ") ||
    "Doctor";

  return {
    appointmentId: appointment._id.toString(),
    patient: {
      id: appointment.user?._id?.toString(),
      name: patientName,
      age: calculateAge(appointment.user?.dob || appointment.user?.dateOfBirth),
      primaryCondition: appointment.user?.medicalHistory?.primaryCondition || "Not provided",
    },
    doctor: {
      id: appointment.doctor?._id?.toString(),
      name: doctorName,
      expertise: appointment.doctor?.experience?.expertise || "General Medicine",
    },
  };
};

const classifyUrgency = ({ symptoms = [], duration = "", severity = "" }) => {
  const symptomText = Array.isArray(symptoms)
    ? symptoms.map(normalizeText).join(" ")
    : normalizeText(symptoms);
  const durationText = normalizeText(duration);
  const severityText = normalizeText(severity);
  const severityNumber = Number(String(severity).match(/\d+/)?.[0] || 0);

  const hasChestPain = symptomText.includes("chest pain") || symptomText.includes("seene");
  const hasBreathingIssue =
    symptomText.includes("shortness of breath") ||
    symptomText.includes("breathlessness") ||
    symptomText.includes("difficulty breathing") ||
    symptomText.includes("saans");
  if (hasChestPain && hasBreathingIssue) {
    return {
      urgencyLevel: "EMERGENCY",
      reasoning: "Chest pain with breathing difficulty requires immediate emergency evaluation.",
    };
  }

  const hasHighFever = symptomText.includes("high fever") || symptomText.includes("fever");
  const hasThreeDays =
    durationText.includes("3 day") ||
    durationText.includes("three day") ||
    durationText.includes("4 day") ||
    durationText.includes("5 day") ||
    durationText.includes("week");
  const severePain =
    severityText.includes("severe") || severityNumber >= 7 || symptomText.includes("severe pain");
  if ((hasHighFever && hasThreeDays) || severePain) {
    return {
      urgencyLevel: "URGENT",
      reasoning: "Persistent fever or severe pain should be reviewed urgently by a clinician.",
    };
  }

  return {
    urgencyLevel: "ROUTINE",
    reasoning: "No emergency red flags were detected from the structured triage answers.",
  };
};

const parseJsonObject = (text) => {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Gemini did not return JSON");
    return JSON.parse(match[0]);
  }
};

const normalizeSeverity = (severity) => {
  const value = normalizeText(severity);
  const number = Number(String(severity).match(/\d+/)?.[0] || 0);
  if (value.includes("severe") || number >= 7) return "severe";
  if (value.includes("moderate") || number >= 4) return "moderate";
  return "mild";
};

const generatePatientBrief = async ({
  symptoms = [],
  duration = "",
  severity = "",
  history = "",
  urgencyLevel = "ROUTINE",
  conversationTurns = 0,
}) => {
  const symptomText = Array.isArray(symptoms) ? symptoms.join(", ") : String(symptoms || "");
  const prompt = `Generate a doctor-facing pre-consultation patient brief.
Return JSON only with keys: chiefComplaint, symptomDuration, severity, relevantHistory, urgencyLevel, agentSummary.

Rules:
- Clinical, concise, professional English.
- Do not diagnose.
- Do not invent details.
- If information is missing, write "Not provided".
- severity must be one of: mild, moderate, severe.
- urgencyLevel must be one of: ROUTINE, URGENT, EMERGENCY.

Collected symptoms: ${symptomText || "Not provided"}
Duration: ${duration || "Not provided"}
Severity: ${severity || "Not provided"}
Relevant history: ${history || "Not provided"}
Validated urgency level: ${urgencyLevel}`;

  const fallbackBrief = {
    chiefComplaint: symptomText || "Not provided",
    symptomDuration: duration || "Not provided",
    severity: normalizeSeverity(severity),
    relevantHistory: history || "Not provided",
    urgencyLevel,
    agentSummary: `${symptomText || "Patient concern not specified"}. Duration: ${
      duration || "not provided"
    }. Relevant history: ${history || "not provided"}.`,
    generatedAt: new Date(),
    conversationTurns,
  };

  if (!process.env.GEMINI_API_KEY) {
    return fallbackBrief;
  }

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const result = await model.generateContent(prompt);
    const parsed = parseJsonObject(result.response.text());
    return {
      chiefComplaint: parsed.chiefComplaint || fallbackBrief.chiefComplaint,
      symptomDuration: parsed.symptomDuration || fallbackBrief.symptomDuration,
      severity: ["mild", "moderate", "severe"].includes(parsed.severity)
        ? parsed.severity
        : fallbackBrief.severity,
      relevantHistory: parsed.relevantHistory || fallbackBrief.relevantHistory,
      urgencyLevel: ["ROUTINE", "URGENT", "EMERGENCY"].includes(parsed.urgencyLevel)
        ? parsed.urgencyLevel
        : urgencyLevel,
      agentSummary: parsed.agentSummary || fallbackBrief.agentSummary,
      generatedAt: new Date(),
      conversationTurns,
    };
  } catch (error) {
    console.error("Gemini brief generation failed:", error.message);
    return fallbackBrief;
  }
};

const triageTools = [
  {
    name: "get_patient_context",
    description: "Fetch appointment, patient medical context, and doctor's expertise.",
    parameters: {
      type: "object",
      properties: {
        appointmentId: { type: "string" },
      },
      required: ["appointmentId"],
    },
  },
  {
    name: "classify_urgency",
    description: "Classify triage urgency using validated application rules.",
    parameters: {
      type: "object",
      properties: {
        symptoms: { type: "array", items: { type: "string" } },
        duration: { type: "string" },
        severity: { type: "string" },
      },
      required: ["symptoms", "duration", "severity"],
    },
  },
  {
    name: "generate_patient_brief",
    description: "Generate a structured doctor-facing patient brief.",
    parameters: {
      type: "object",
      properties: {
        symptoms: { type: "array", items: { type: "string" } },
        duration: { type: "string" },
        severity: { type: "string" },
        history: { type: "string" },
        urgencyLevel: { type: "string", enum: ["ROUTINE", "URGENT", "EMERGENCY"] },
        conversationTurns: { type: "number" },
      },
      required: ["symptoms", "duration", "severity", "urgencyLevel"],
    },
  },
];

const triageToolHandlers = {
  get_patient_context: getPatientContext,
  classify_urgency: classifyUrgency,
  generate_patient_brief: generatePatientBrief,
};

export {
  classifyUrgency,
  generatePatientBrief,
  getPatientContext,
  triageToolHandlers,
  triageTools,
};
