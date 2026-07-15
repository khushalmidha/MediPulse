import crypto from "crypto";
import { GoogleGenerativeAI } from "@google/generative-ai";
import Appointment from "../model/appointment.js";
import { getRedis } from "./redis.js";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const CONTEXT_TTL_SECONDS = 30 * 60;
const GUIDELINE_TTL_SECONDS = 24 * 60 * 60;

const normalizeText = (value) => String(value || "").toLowerCase();
const contextKey = (appointmentId) => `copilot:ctx:${appointmentId}`;
const guidelineKey = (condition, context = "") =>
  `copilot:guideline:${crypto
    .createHash("sha256")
    .update(`${condition}:${context}`.toLowerCase())
    .digest("hex")}`;

const calculateAge = (dob) => {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (Number.isNaN(birthDate.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const monthDiff = today.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) age -= 1;
  return age;
};

const parseJsonObject = (text, fallback = {}) => {
  const trimmed = String(text || "").trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return fallback;
    try {
      return JSON.parse(match[0]);
    } catch {
      return fallback;
    }
  }
};

const asArray = (value) => (Array.isArray(value) ? value.filter(Boolean) : []);

const getPatientContext = async ({ appointmentId }) => {
  const redis = getRedis();
  const cached = await redis.get(contextKey(appointmentId));
  if (cached) return JSON.parse(cached);

  const appointment = await Appointment.findById(appointmentId)
    .populate("user", "firstName lastName email medicalHistory dob dateOfBirth allergies")
    .populate("doctor", "firstName lastName email experience");

  if (!appointment) throw new Error("Appointment not found");

  const patientName =
    [appointment.user?.firstName, appointment.user?.lastName].filter(Boolean).join(" ") ||
    "Patient";
  const doctorName =
    [appointment.doctor?.firstName, appointment.doctor?.lastName].filter(Boolean).join(" ") ||
    "Doctor";

  const previousAppointments = await Appointment.find({
    user: appointment.user?._id,
    _id: { $ne: appointment._id },
    status: "completed",
  })
    .sort({ endedAt: -1, updatedAt: -1 })
    .limit(3)
    .select("doctorNotes receiptText soapNote endedAt createdAt");

  const context = {
    appointmentId: appointment._id.toString(),
    patient: {
      id: appointment.user?._id?.toString(),
      name: patientName,
      age: calculateAge(appointment.user?.dob || appointment.user?.dateOfBirth),
      primaryCondition: appointment.user?.medicalHistory?.primaryCondition || "Not provided",
      allergies: asArray(appointment.user?.allergies),
      medicalHistory: appointment.user?.medicalHistory || {},
    },
    doctor: {
      id: appointment.doctor?._id?.toString(),
      name: doctorName,
      expertise: appointment.doctor?.experience?.expertise || "General Medicine",
    },
    patientBrief: appointment.patientBrief || null,
    previousVisits: previousAppointments.map((visit) => ({
      date: visit.endedAt || visit.createdAt,
      doctorNotes: visit.doctorNotes || "",
      receiptText: visit.receiptText || "",
      soapNote: visit.soapNote || null,
    })),
  };

  await redis.set(contextKey(appointmentId), JSON.stringify(context), "EX", CONTEXT_TTL_SECONDS);
  return context;
};

const checkDrugSafety = async ({ medications = [], patientConditions = [] }) => {
  const meds = asArray(medications).map(normalizeText);
  const conditions = asArray(patientConditions).map(normalizeText);
  const joined = `${meds.join(" ")} ${conditions.join(" ")}`;

  const fallbackConcerns = [];
  if (
    (joined.includes("aspirin") || joined.includes("ibuprofen") || joined.includes("nsaid")) &&
    (joined.includes("warfarin") ||
      joined.includes("blood thinner") ||
      joined.includes("anticoagulant") ||
      joined.includes("bleeding"))
  ) {
    fallbackConcerns.push(
      "NSAID or aspirin mention with anticoagulant/bleeding context. Flag for doctor review.",
    );
  }
  if (joined.includes("metformin") && (joined.includes("kidney") || joined.includes("renal"))) {
    fallbackConcerns.push("Metformin mentioned with kidney/renal context. Verify renal status.");
  }

  const fallback = {
    safe: fallbackConcerns.length === 0,
    concerns: fallbackConcerns,
    severity: fallbackConcerns.length ? "high" : "low",
  };

  if (!process.env.GEMINI_API_KEY) return fallback;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `You are flagging medication safety issues for a doctor during a live consult.
Return ONLY JSON: {"safe": boolean, "concerns": string[], "severity": "low"|"medium"|"high"}.
This is a flag for doctor's attention only, not a definitive pharmaceutical interaction check.
Be specific, concise, and do not invent unavailable patient facts.

Medications mentioned: ${meds.join(", ") || "None"}
Known conditions/context: ${conditions.join(", ") || "None"}`;
    const result = await model.generateContent(prompt);
    const parsed = parseJsonObject(result.response.text(), fallback);
    return {
      safe: Boolean(parsed.safe),
      concerns: asArray(parsed.concerns),
      severity: ["low", "medium", "high"].includes(parsed.severity)
        ? parsed.severity
        : fallback.severity,
    };
  } catch (error) {
    console.error("Copilot drug safety failed:", error.message);
    return fallback;
  }
};

const flagRedSymptoms = async ({ symptoms = [], patientAge = null, existingConditions = [] }) => {
  const symptomText = asArray(symptoms).map(normalizeText).join(" ");
  const conditionText = asArray(existingConditions).map(normalizeText).join(" ");
  const combined = `${symptomText} ${conditionText}`;

  const rules = [
    {
      match:
        (combined.includes("chest pain") || combined.includes("chest tightness")) &&
        (combined.includes("left arm") || combined.includes("jaw")),
      flagType: "cardiac",
      message: "Chest discomfort with left arm or jaw pain mentioned. Consider cardiac evaluation.",
    },
    {
      match:
        combined.includes("sudden") &&
        combined.includes("severe headache") &&
        combined.includes("vision"),
      flagType: "neurological",
      message: "Sudden severe headache with vision changes mentioned. Consider urgent neuro evaluation.",
    },
    {
      match:
        (combined.includes("difficulty breathing") || combined.includes("shortness of breath")) &&
        (combined.includes("lip swelling") || combined.includes("swollen lips")),
      flagType: "allergic reaction",
      message: "Breathing difficulty with lip swelling mentioned. Consider allergic reaction evaluation.",
    },
    {
      match:
        (combined.includes("high fever") || combined.includes("fever")) &&
        combined.includes("stiff neck"),
      flagType: "meningitis concern",
      message: "Fever with stiff neck mentioned. Consider urgent evaluation.",
    },
  ];

  const rule = rules.find((candidate) => candidate.match);
  if (rule) {
    return { hasRedFlag: true, flagType: rule.flagType, message: rule.message, severity: "high" };
  }

  const fallback = {
    hasRedFlag: false,
    flagType: "none",
    message: "No urgent symptom combination detected from available transcript.",
    severity: "low",
  };
  if (!process.env.GEMINI_API_KEY || !symptomText.trim()) return fallback;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Identify whether this symptom context includes a red flag requiring doctor's attention.
Return ONLY JSON: {"hasRedFlag": boolean, "flagType": string, "message": string, "severity": "low"|"medium"|"high"}.
Use wording like "Consider evaluating for..." and do not diagnose.

Symptoms: ${symptomText}
Age: ${patientAge || "unknown"}
Known conditions: ${conditionText || "none"}`;
    const result = await model.generateContent(prompt);
    const parsed = parseJsonObject(result.response.text(), fallback);
    return {
      hasRedFlag: Boolean(parsed.hasRedFlag),
      flagType: parsed.flagType || fallback.flagType,
      message: parsed.message || fallback.message,
      severity: ["low", "medium", "high"].includes(parsed.severity)
        ? parsed.severity
        : fallback.severity,
    };
  } catch (error) {
    console.error("Copilot red flag failed:", error.message);
    return fallback;
  }
};

const getRelevantGuideline = async ({ condition = "", context = "" }) => {
  const cacheKey = guidelineKey(condition, context);
  const redis = getRedis();
  const cached = await redis.get(cacheKey);
  if (cached) return JSON.parse(cached);

  const fallback = {
    guideline: "Use clinical judgment and current local protocols for this discussion.",
    source: "Based on standard clinical guidelines",
  };
  if (!process.env.GEMINI_API_KEY || !condition.trim()) return fallback;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `In 3 bullet points max, what are current clinical guidelines for ${condition} regarding ${context || "this visit"}?
Be concise, doctor-facing, and avoid fabricated source names.
Return ONLY JSON: {"guideline": string, "source": "Based on standard clinical guidelines"}`;
    const result = await model.generateContent(prompt);
    const parsed = parseJsonObject(result.response.text(), fallback);
    const guideline = {
      guideline: parsed.guideline || fallback.guideline,
      source: "Based on standard clinical guidelines",
    };
    await redis.set(cacheKey, JSON.stringify(guideline), "EX", GUIDELINE_TTL_SECONDS);
    return guideline;
  } catch (error) {
    console.error("Copilot guideline failed:", error.message);
    return fallback;
  }
};

const generateSoapNote = async ({
  transcript = "",
  doctorNotes = "",
  patientBrief = null,
  agentInsights = [],
}) => {
  const fallback = {
    subjective: transcript.trim() || patientBrief?.agentSummary || "Not discussed",
    objective: "Not discussed",
    assessment: "Preliminary AI assessment: Not clearly established.",
    plan: doctorNotes.trim() || "Not discussed",
  };

  if (!process.env.GEMINI_API_KEY) return fallback;

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Generate a clinical SOAP note. Return ONLY valid JSON:
{
  "subjective": string,
  "objective": string,
  "assessment": string,
  "plan": string
}

STRICT RULES:
- Only include what was actually discussed. Do not invent.
- If information is missing for a section, write "Not discussed".
- Assessment must start with "Preliminary AI assessment:" and is not a confirmed diagnosis.
- Do not infer symptoms not mentioned.
- Do not suggest diagnoses beyond what was discussed. If unsure, write "Not clearly established."
- Keep each section under 100 words.

Transcript: ${transcript || "Not available"}
Doctor notes: ${doctorNotes || "Not available"}
Patient brief: ${JSON.stringify(patientBrief || {})}
Co-pilot insights: ${asArray(agentInsights).join("; ") || "None"}`;
    const result = await model.generateContent(prompt);
    const parsed = parseJsonObject(result.response.text(), fallback);
    return {
      subjective: parsed.subjective || fallback.subjective,
      objective: parsed.objective || fallback.objective,
      assessment: String(parsed.assessment || fallback.assessment).startsWith(
        "Preliminary AI assessment:",
      )
        ? parsed.assessment
        : `Preliminary AI assessment: ${parsed.assessment || "Not clearly established."}`,
      plan: parsed.plan || fallback.plan,
    };
  } catch (error) {
    console.error("Copilot SOAP generation failed:", error.message);
    return fallback;
  }
};

const copilotTools = [
  {
    name: "get_patient_context",
    description: "Fetch complete patient profile and recent appointment context.",
    parameters: {
      type: "object",
      properties: { appointmentId: { type: "string" } },
      required: ["appointmentId"],
    },
  },
  {
    name: "check_drug_safety",
    description: "Flag potential medication concerns for doctor review.",
    parameters: {
      type: "object",
      properties: {
        medications: { type: "array", items: { type: "string" } },
        patientConditions: { type: "array", items: { type: "string" } },
      },
      required: ["medications"],
    },
  },
  {
    name: "flag_red_symptoms",
    description: "Identify urgent symptom combinations that may need attention.",
    parameters: {
      type: "object",
      properties: {
        symptoms: { type: "array", items: { type: "string" } },
        patientAge: { type: "number" },
        existingConditions: { type: "array", items: { type: "string" } },
      },
      required: ["symptoms"],
    },
  },
  {
    name: "get_relevant_guideline",
    description: "Return a concise doctor-facing guideline note.",
    parameters: {
      type: "object",
      properties: {
        condition: { type: "string" },
        context: { type: "string" },
      },
      required: ["condition"],
    },
  },
  {
    name: "generate_soap_note",
    description: "Generate structured SOAP note JSON from the consultation.",
    parameters: {
      type: "object",
      properties: {
        transcript: { type: "string" },
        doctorNotes: { type: "string" },
        patientBrief: { type: "object" },
        agentInsights: { type: "array", items: { type: "string" } },
      },
      required: ["transcript"],
    },
  },
];

const copilotToolHandlers = {
  get_patient_context: getPatientContext,
  check_drug_safety: checkDrugSafety,
  flag_red_symptoms: flagRedSymptoms,
  get_relevant_guideline: getRelevantGuideline,
  generate_soap_note: generateSoapNote,
};

export {
  checkDrugSafety,
  copilotToolHandlers,
  copilotTools,
  flagRedSymptoms,
  generateSoapNote,
  getPatientContext,
  getRelevantGuideline,
};
