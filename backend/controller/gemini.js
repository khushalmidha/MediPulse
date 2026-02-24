import { GoogleGenerativeAI } from "@google/generative-ai";
import { configDotenv } from "dotenv";

configDotenv();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

/**
 * POST /gemini/chat
 * Body: { prompt: string, type: "general" | "doctor" | "community" }
 */
const geminiChat = async (req, res) => {
  try {
    const { prompt, type } = req.body;
    if (!prompt) {
      return res.status(400).json({ message: "Prompt is required" });
    }

    let systemInstruction = "";
    if (type === "general") {
      systemInstruction = `You are MediPulse AI, a healthcare assistant.
Give short, concise answers only not too long.
Try to be point wise not more than 2-3 points.
Only respond to health-related queries or questions about MediPulse services.
If asked about non-health topics, politely redirect the conversation to healthcare.
Keep responses focused on medical information, health advice, and MediPulse platform features.
Do not provide specific medical diagnoses but can offer general health information.`;
    }

    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      ...(systemInstruction && { systemInstruction }),
    });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    return res.status(200).json({ text });
  } catch (error) {
    console.error("Gemini API error:", error?.message || error);
    return res.status(500).json({
      message: "AI service unavailable. Please try again later.",
      error: error?.message,
    });
  }
};

export { geminiChat };
