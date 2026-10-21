import { GoogleGenerativeAI } from "@google/generative-ai";
import { loadRuntimeEnv } from "../util/runtimeEnv.js";
import {
  withBoundedTimeout,
  generateDeterministicSoapFallback,
  createAiProvenance,
  CLINICAL_SAFETY_DISCLAIMER,
} from "../services/aiReliabilityService.js";

loadRuntimeEnv();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

const buildGeminiModel = (type) => {
  let systemInstruction = "";
  if (type === "general") {
    systemInstruction = `You are MediPulse AI, an assistive healthcare guide.
Give short, concise answers only not too long.
Try to be point wise not more than 2-3 points.
Only respond to health-related queries or questions about MediPulse services.
If asked about non-health topics, politely redirect the conversation to healthcare.
Keep responses focused on general medical information, health education, and platform features.
Do not provide definitive medical diagnoses or autonomous prescriptions. All outputs are educational drafts requiring qualified clinician confirmation.`;
  }

  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    ...(systemInstruction && { systemInstruction }),
  });
};

const generateGeminiText = async (prompt, type = "general") => {
  if (!process.env.GEMINI_API_KEY) throw new Error("AI is not configured");

  const runCall = async () => {
    const model = buildGeminiModel(type);
    const result = await model.generateContent(prompt);
    return result.response.text();
  };

  const text = await withBoundedTimeout(runCall(), 7000, null);
  if (!text) {
    throw new Error("AI service response timed out or unavailable");
  }
  return text;
};

/**
 * POST /gemini/chat
 * Body: { prompt: string, type: "general" | "doctor" | "community", consent?: boolean }
 */
const geminiChat = async (req, res) => {
  try {
    const { prompt, type, consent } = req.body;
    if (!prompt || typeof prompt !== "string" || !prompt.trim()) {
      return res.status(400).json({ message: "Prompt is required" });
    }

    if (consent === false) {
      return res.status(200).json({
        text: "AI processing consent was not granted. Healthcare and booking operations remain fully operational.",
        isDraft: true,
        consentGranted: false,
        fallbackActive: true,
        disclaimer: CLINICAL_SAFETY_DISCLAIMER,
        provenance: createAiProvenance({
          provider: "deterministic_rules",
          model: "rule-engine-v1",
          consentVerified: false,
          fallbackUsed: true,
          fallbackReason: "explicit_consent_denied",
        }),
      });
    }

    const safePrompt = prompt.trim().slice(0, 1000);
    const safeType = ["general", "doctor", "community"].includes(type) ? type : "general";

    const text = await generateGeminiText(safePrompt, safeType);

    return res.status(200).json({
      text,
      isDraft: true,
      disclaimer: CLINICAL_SAFETY_DISCLAIMER,
      provenance: createAiProvenance({
        provider: "google_gemini",
        model: "gemini-2.5-flash",
        consentVerified: true,
        fallbackUsed: false,
      }),
    });
  } catch (error) {
    console.error("Gemini API error:", error?.message || error);
    return res.status(503).json({
      message: "AI service unavailable. Healthcare and booking operations remain fully operational.",
      fallbackActive: true,
    });
  }
};

const generateSoapNote = async (roughNotes) => {
  const safeNotes = typeof roughNotes === "string" ? roughNotes.trim().slice(0, 4000) : "";
  if (!safeNotes) {
    return generateDeterministicSoapFallback({ roughNotes: "" }).markdown;
  }

  if (!process.env.GEMINI_API_KEY) {
    const fallback = generateDeterministicSoapFallback({ roughNotes: safeNotes });
    return fallback.markdown;
  }

  try {
    const prompt = `You are a clinical documentation assistant. Please format the following rough consultation notes into a structured SOAP (Subjective, Objective, Assessment, Plan) format. Return only the structured SOAP note in Markdown format without any extra explanation or text.\n\nRough Notes: ${safeNotes}`;
    return await generateGeminiText(prompt, "soap");
  } catch (err) {
    console.warn("Gemini SOAP generation failed, applying deterministic clinical fallback:", err.message);
    const fallback = generateDeterministicSoapFallback({ roughNotes: safeNotes });
    return fallback.markdown;
  }
};

export { geminiChat, generateGeminiText, generateSoapNote };
