import mongoose from "mongoose";
import BedDemandForecast from "../model/bedDemandForecast.js";
import BedInventory from "../model/bedInventory.js";
import BloodBankInventory from "../model/bloodBankInventory.js";
import BloodDemandForecast from "../model/bloodDemandForecast.js";
import Department from "../model/department.js";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";

const bloodGroups = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const nextMonthStart = () => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
};

const daysInMonth = (date) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();

const confidenceFromSamples = (sampleSize) => {
  if (sampleSize >= 120) return "high";
  if (sampleSize >= 40) return "medium";
  return "low";
};

const ensureHospitalAccess = async (req, res) => {
  if (String(req.staff.hospitalId) !== String(req.params.hospitalId)) {
    res.status(403).json({ message: "You can only manage forecasts for your hospital" });
    return null;
  }
  if (!mongoose.Types.ObjectId.isValid(req.params.hospitalId)) {
    res.status(400).json({ message: "Invalid hospital id" });
    return null;
  }
  const hospital = await Hospital.findById(req.params.hospitalId).lean();
  if (!hospital) {
    res.status(404).json({ message: "Hospital not found" });
    return null;
  }
  return hospital;
};

const bedTypeForDepartment = (name = "") => {
  if (/icu|critical|cardio|neuro|emergency|trauma/i.test(name)) return "icu";
  if (/maternity|gyn|obstetric/i.test(name)) return "maternity";
  if (/pediatric|child/i.test(name)) return "pediatric";
  if (/emergency|trauma/i.test(name)) return "emergency";
  return "general";
};

const buildBedForecastRows = async (hospitalId, month) => {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const departments = await Department.find({ hospitalId, status: "active" }).lean();
  const visits = await OpdToken.aggregate([
    { $match: { hospitalId: new mongoose.Types.ObjectId(hospitalId), date: { $gte: since } } },
    { $group: { _id: "$departmentId", visits90: { $sum: 1 }, emergencies: { $sum: { $cond: [{ $eq: ["$visitType", "emergency"] }, 1, 0] } } } },
  ]);
  const visitMap = new Map(visits.map((item) => [String(item._id), item]));

  return departments.map((department) => {
    const data = visitMap.get(String(department._id)) || { visits90: 0, emergencies: 0 };
    const bedType = bedTypeForDepartment(department.name);
    const dailyVisits = data.visits90 / 90;
    const conversion = bedType === "icu" ? 0.08 : bedType === "maternity" ? 0.18 : bedType === "emergency" ? 0.14 : 0.11;
    const emergencyBoost = data.emergencies > 0 ? 1.15 : 1;
    const predictedDemand = Math.max(1, Math.ceil(dailyVisits * daysInMonth(month) * conversion * emergencyBoost));
    const recommendedReserve = Math.max(1, Math.ceil(predictedDemand * 0.25));
    return {
      hospitalId,
      departmentId: department._id,
      month,
      bedType,
      predictedDemand,
      recommendedReserve,
      sampleSize: data.visits90,
      confidence: confidenceFromSamples(data.visits90),
      // FIXED: Admin dashboard had no demand signal, so hospitals could not plan beds before a new month started.
      explanation: `Based on ${data.visits90} OPD visits in the last 90 days for ${department.name}; emergency visits and department type adjust the reserve.`,
    };
  });
};

export const generateBedForecast = async (req, res) => {
  try {
    const hospital = await ensureHospitalAccess(req, res);
    if (!hospital) return;

    const month = nextMonthStart();
    const rows = await buildBedForecastRows(hospital._id, month);
    await Promise.all(
      rows.map((row) =>
        BedDemandForecast.findOneAndUpdate(
          { hospitalId: row.hospitalId, departmentId: row.departmentId, month: row.month, bedType: row.bedType },
          row,
          { upsert: true, new: true, setDefaultsOnInsert: true },
        ),
      ),
    );
    const forecasts = await BedDemandForecast.find({ hospitalId: hospital._id, month }).populate("departmentId", "name").lean();
    res.status(200).json({ month, forecasts });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to generate bed forecast" });
  }
};

export const getBedForecast = async (req, res) => {
  try {
    const hospital = await ensureHospitalAccess(req, res);
    if (!hospital) return;
    const month = nextMonthStart();
    let forecasts = await BedDemandForecast.find({ hospitalId: hospital._id, month }).populate("departmentId", "name").lean();
    if (!forecasts.length) {
      const rows = await buildBedForecastRows(hospital._id, month);
      await Promise.all(rows.map((row) => BedDemandForecast.findOneAndUpdate(
        { hospitalId: row.hospitalId, departmentId: row.departmentId, month: row.month, bedType: row.bedType },
        row,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )));
      forecasts = await BedDemandForecast.find({ hospitalId: hospital._id, month }).populate("departmentId", "name").lean();
    }
    const inventory = await BedInventory.find({ hospitalId: hospital._id }).populate("departmentId", "name").lean();
    res.status(200).json({ month, forecasts, inventory });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load bed forecast" });
  }
};

const buildBloodForecastRows = async (hospitalId, month) => {
  const since = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const tokens = await OpdToken.find({ hospitalId, date: { $gte: since } }).select("visitType chiefComplaint").lean();
  const emergencySignals = tokens.filter((token) => token.visitType === "emergency" || /accident|trauma|surgery|bleeding|delivery/i.test(token.chiefComplaint || "")).length;
  const baseline = Math.max(1, Math.ceil((tokens.length * 0.035 + emergencySignals * 0.35) * (daysInMonth(month) / 30)));
  const distribution = { "O+": 0.34, "A+": 0.28, "B+": 0.22, "AB+": 0.06, "O-": 0.04, "A-": 0.025, "B-": 0.02, "AB-": 0.015 };

  return bloodGroups.map((bloodGroup) => {
    const predictedUnits = Math.max(1, Math.ceil(baseline * (distribution[bloodGroup] || 0.05)));
    return {
      hospitalId,
      month,
      bloodGroup,
      predictedUnits,
      recommendedReserve: Math.max(2, Math.ceil(predictedUnits * 1.35)),
      sampleSize: tokens.length,
      confidence: confidenceFromSamples(tokens.length),
      shortageRisk: predictedUnits >= 8 || bloodGroup.endsWith("-") ? "medium" : "low",
      // FIXED: Blood-bank planning was completely absent, leaving emergency stock invisible to hospital admins.
      explanation: `Uses ${tokens.length} recent OPD visits and ${emergencySignals} emergency/surgery signals to estimate monthly reserve for ${bloodGroup}.`,
    };
  });
};

export const generateBloodForecast = async (req, res) => {
  try {
    const hospital = await ensureHospitalAccess(req, res);
    if (!hospital) return;
    const month = nextMonthStart();
    const rows = await buildBloodForecastRows(hospital._id, month);
    await Promise.all(rows.map((row) => BloodDemandForecast.findOneAndUpdate(
      { hospitalId: row.hospitalId, month: row.month, bloodGroup: row.bloodGroup },
      row,
      { upsert: true, new: true, setDefaultsOnInsert: true },
    )));
    const forecasts = await BloodDemandForecast.find({ hospitalId: hospital._id, month }).lean();
    res.status(200).json({ month, forecasts });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to generate blood forecast" });
  }
};

export const getBloodForecast = async (req, res) => {
  try {
    const hospital = await ensureHospitalAccess(req, res);
    if (!hospital) return;
    const month = nextMonthStart();
    let forecasts = await BloodDemandForecast.find({ hospitalId: hospital._id, month }).lean();
    if (!forecasts.length) {
      const rows = await buildBloodForecastRows(hospital._id, month);
      await Promise.all(rows.map((row) => BloodDemandForecast.findOneAndUpdate(
        { hospitalId: row.hospitalId, month: row.month, bloodGroup: row.bloodGroup },
        row,
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )));
      forecasts = await BloodDemandForecast.find({ hospitalId: hospital._id, month }).lean();
    }
    const inventory = await BloodBankInventory.find({ hospitalId: hospital._id }).lean();
    res.status(200).json({ month, forecasts, inventory });
  } catch (error) {
    res.status(500).json({ message: error.message || "Unable to load blood forecast" });
  }
};
