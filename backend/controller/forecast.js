import { validateForecast } from "../services/forecastValidation.js";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";
import Department from "../model/department.js";
import Forecast from "../model/forecast.js";
import { generateGeminiText } from "./gemini.js";

const requireAdmin = (req, res, hospitalId) => {
  if (String(req.staff?.hospitalId || "") !== String(hospitalId || "") || req.staff?.role !== "HOSPITAL_ADMIN") {
    res.status(403).json({ message: "Admin access required for AI forecasts" });
    return false;
  }
  return true;
};

export const getBedForecast = async (req, res) => {
  try {
    const { hospitalId } = req.params;
    if (!requireAdmin(req, res, hospitalId)) return;
    
    const forecast = await Forecast.findOne({ hospitalId, type: "beds" }).sort({ createdAt: -1 });
    return res.status(200).json(await storedForecastResponse(forecast, "beds", hospitalId));
  } catch (error) {
    return res.status(500).json({ message: "Error fetching forecast" });
  }
};

export const getBloodForecast = async (req, res) => {
  try {
    const { hospitalId } = req.params;
    if (!requireAdmin(req, res, hospitalId)) return;
    
    const forecast = await Forecast.findOne({ hospitalId, type: "blood" }).sort({ createdAt: -1 });
    return res.status(200).json(await storedForecastResponse(forecast, "blood", hospitalId));
  } catch (error) {
    return res.status(500).json({ message: "Error fetching forecast" });
  }
};

export const makeBedForecast = (generateText = generateGeminiText) => async (req, res) => {
  try {
    const { hospitalId } = req.params;
    if (!requireAdmin(req, res, hospitalId)) return;

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) return res.status(404).json({ message: "Hospital not found" });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const opdCounts = await OpdToken.aggregate([
      { $match: { hospitalId: hospital._id, date: { $gte: thirtyDaysAgo } } },
      { $group: { _id: "$departmentId", count: { $sum: 1 } } }
    ]);
    const opdVolume = opdCounts.reduce((sum, item) => sum + item.count, 0);
    const depts = await Department.find({ hospitalId }).lean();
    const deptStats = depts.map(d => {
      const stat = opdCounts.find(c => String(c._id) === String(d._id));
      return `${d.name} (${stat ? stat.count : 0} recent visits)`;
    }).join(", ") || "General";
    if (!depts.length) return res.status(409).json({ message: "Add departments before generating a forecast draft" });

    const prompt = `You are an AI forecasting model for a hospital management system. 
Hospital Name: ${hospital.name}
Departments & Recent 30-Day OPD Volume: ${deptStats}
City: ${hospital.address?.city || "Unknown"}
Recent 30-Day Total OPD Volume: ${opdVolume} visits

Ground your forecast scale to match the real recent hospital volume.

Ground your forecast in the real 30-day OPD volume provided above.

Admissions and occupancy are unknown. This is an unvalidated planning draft using OPD counts only.
Analyze seasonal trends and general healthcare patterns for these departments.
Predict the bed demand for the upcoming month.
Return ONLY a valid JSON string (without markdown blocks like \`\`\`json) with this exact schema:
[
  {
    "departmentId": { "name": "Department Name" },
    "bedType": "ICU or General Ward",
    "explanation": "Short 1 sentence reason",
    "confidence": "High, Medium, or Low",
    "predictedDemand": integer,
    "recommendedReserve": integer
  }
]
Generate 3 to 5 realistic items.`;

    const rawResponse = await generateText(prompt, "general");
    const jsonStr = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
    const forecastsData = validateForecast(jsonStr, "beds", depts);

    let forecast = await Forecast.findOne({ hospitalId, type: "beds" });
    if (forecast) {
      forecast.forecasts = forecastsData;
      forecast.reviewStatus = "unreviewed";
      forecast.generatedAt = new Date();
      forecast.observedOpdVisits = opdVolume;
      await forecast.save();
    } else {
      forecast = await Forecast.create({ hospitalId, type: "beds", forecasts: forecastsData, reviewStatus: "unreviewed", generatedAt: new Date(), observedOpdVisits: opdVolume });
    }

    return res.status(200).json(forecastResponse(forecast));
  } catch (error) {

    return res.status(error.status || 503).json({ message: "Forecast draft unavailable or invalid. Please try again." });
  }
};

export const makeBloodForecast = (generateText = generateGeminiText) => async (req, res) => {
  try {
    const { hospitalId } = req.params;
    if (!requireAdmin(req, res, hospitalId)) return;

    const hospital = await Hospital.findById(hospitalId);
    if (!hospital) return res.status(404).json({ message: "Hospital not found" });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const opdVolume = await OpdToken.countDocuments({ hospitalId: hospital._id, date: { $gte: thirtyDaysAgo } });
    const prompt = `You are an AI forecasting model for a hospital blood bank. 
Hospital Name: ${hospital.name}
City: ${hospital.address?.city || "Unknown"}
Recent 30-Day Total OPD Volume: ${opdVolume} visits
Only OPD counts are observed; admissions, occupancy, surgery and inventory are unknown. Treat this as an unvalidated planning draft.

Predict the blood bank demand for the upcoming month based on typical trauma and surgical patterns.
Return ONLY a valid JSON string (without markdown blocks like \`\`\`json) with this exact schema:
[
  {
    "bloodGroup": "O+, A-, etc.",
    "shortageRisk": "high, medium, or low",
    "predictedUnits": integer,
    "recommendedReserve": integer,
    "explanation": "Short 1 sentence reason"
  }
]
Generate 4 items for different blood groups.`;

    const rawResponse = await generateText(prompt, "general");
    const jsonStr = rawResponse.replace(/```json/g, "").replace(/```/g, "").trim();
    const forecastsData = validateForecast(jsonStr, "blood");

    let forecast = await Forecast.findOne({ hospitalId, type: "blood" });
    if (forecast) {
      forecast.forecasts = forecastsData;
      forecast.reviewStatus = "unreviewed";
      forecast.generatedAt = new Date();
      forecast.observedOpdVisits = opdVolume;
      await forecast.save();
    } else {
      forecast = await Forecast.create({ hospitalId, type: "blood", forecasts: forecastsData, reviewStatus: "unreviewed", generatedAt: new Date(), observedOpdVisits: opdVolume });
    }

    return res.status(200).json(forecastResponse(forecast));
  } catch (error) {

    return res.status(error.status || 503).json({ message: "Forecast draft unavailable or invalid. Please try again." });
  }
};

const forecastResponse = forecast => ({ forecasts: forecast?.forecasts || [], source: "ai_draft", reviewStatus: forecast?.reviewStatus || "unreviewed",
  generatedAt: forecast?.generatedAt || null, observedOpdVisits: forecast?.observedOpdVisits ?? null,
  notice: "Unvalidated planning draft using OPD volume only. Review against admissions, occupancy and inventory before use." });

export const generateBedForecast = makeBedForecast();
export const generateBloodForecast = makeBloodForecast();

const storedForecastResponse = async (forecast, type, hospitalId) => {
  if (!forecast) return forecastResponse(null);
  const departments = type === "beds" ? await Department.find({ hospitalId }).lean() : [];
  try { return { ...forecastResponse(forecast), forecasts: validateForecast(forecast.forecasts, type, departments) }; }
  catch { return { ...forecastResponse(forecast), forecasts: [], needsRegeneration: true, notice: "Stored draft is invalid. Generate a new draft and review it before use." }; }
};
