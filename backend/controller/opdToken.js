import mongoose from "mongoose";
import OpdToken from "../model/opdToken.js";
import Department from "../model/department.js";
import Hospital from "../model/hospital.js";
import HospitalStaff from "../model/hospitalStaff.js";
import { getRedis } from "../services/redis.js";
import { getIO } from "../socket.js";

const dayRange = (date = new Date()) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
};

const queueCacheKey = (doctorId, date = new Date()) => `opd:queue:${doctorId}:${date.toISOString().slice(0, 10)}`;
const hospitalQueueCacheKey = (hospitalId) => `hospital:queue-status:${hospitalId}`;

const clearOpdCache = async ({ hospitalId, doctorId }) => {
  // Cache invalidation: token queue and public hospital queue status depend on OPD token mutations.
  await getRedis().del(queueCacheKey(doctorId), hospitalQueueCacheKey(hospitalId));
};

const sameHospital = (req, hospitalId) => req.staff?.hospitalId === String(hospitalId);

const emitHospital = (hospitalId, event, payload) => {
  const io = getIO();
  if (io) io.to(`hospital:${hospitalId}`).emit(event, payload);
};

const emitDoctor = (doctorId, event, payload) => {
  const io = getIO();
  if (io) io.to(`doctor:${doctorId}`).emit(event, payload);
};

const avgConsultationMinutes = async (doctorId) => {
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const result = await OpdToken.aggregate([
    {
      $match: {
        doctorId: new mongoose.Types.ObjectId(doctorId),
        consultationStartedAt: { $gte: since },
        consultationEndedAt: { $ne: null },
      },
    },
    {
      $project: {
        minutes: {
          $divide: [{ $subtract: ["$consultationEndedAt", "$consultationStartedAt"] }, 1000 * 60],
        },
      },
    },
    { $group: { _id: null, avgMinutes: { $avg: "$minutes" } } },
  ]);

  return Math.max(8, Math.round(result[0]?.avgMinutes || 12));
};

const buildDisplayToken = async (hospitalId, tokenNumber) => {
  const hospital = await Hospital.findById(hospitalId).select("settings.tokenPrefix");
  const prefix = hospital?.settings?.tokenPrefix || "T";
  return `${prefix}${String(tokenNumber).padStart(3, "0")}`;
};

const issueToken = async (req, res) => {
  const { hospitalId, departmentId } = req.params;

  if (req.staff && !sameHospital(req, hospitalId)) {
    return res.status(403).json({ message: "Forbidden hospital access" });
  }

  const { doctorId, patientId, patientInfo = {}, visitType = "new", chiefComplaint } = req.body;
  if (!doctorId) {
    return res.status(400).json({ message: "Doctor id is required" });
  }

  const [department, doctor] = await Promise.all([
    Department.findOne({ _id: departmentId, hospitalId, status: "active" }),
    HospitalStaff.findOne({ _id: doctorId, hospitalId, role: "DOCTOR", isActive: true }),
  ]);

  if (!department) return res.status(404).json({ message: "Department not found" });
  if (!doctor) return res.status(404).json({ message: "Doctor not found in this hospital" });

  const { start, end } = dayRange();
  const lastToken = await OpdToken.findOne({ doctorId, date: { $gte: start, $lt: end } })
    .sort({ tokenNumber: -1 })
    .lean();
  const tokenNumber = (lastToken?.tokenNumber || 0) + 1;
  const queueAhead = await OpdToken.countDocuments({
    doctorId,
    date: { $gte: start, $lt: end },
    status: { $in: ["waiting", "vitals_done", "in_consultation"] },
  });
  const estimatedWaitMinutes = queueAhead * (await avgConsultationMinutes(doctorId)) + 5;
  const displayToken = await buildDisplayToken(hospitalId, tokenNumber);

  const token = await OpdToken.create({
    hospitalId,
    departmentId,
    doctorId,
    patientId: patientId || req.auth?.id,
    tokenNumber,
    displayToken,
    date: start,
    patientInfo: {
      ...patientInfo,
      isWalkIn: !patientId && !req.auth?.id,
    },
    visitType,
    chiefComplaint,
    arrivedAt: new Date(),
    estimatedWaitMinutes,
    paymentAmount: doctor.doctorProfile?.consultationFee || department.opd?.consultationFee || 0,
  });

  await clearOpdCache({ hospitalId, doctorId });
  emitHospital(hospitalId, "opd:token-issued", { token });

  return res.status(201).json({
    token,
    displayToken,
    estimatedWaitMinutes,
    queuePosition: queueAhead + 1,
  });
};

const getDoctorQueue = async (req, res) => {
  const { hospitalId, doctorId } = req.params;
  if (!sameHospital(req, hospitalId)) {
    return res.status(403).json({ message: "Forbidden hospital access" });
  }

  const redis = getRedis();
  const cacheKey = queueCacheKey(doctorId);
  const cached = await redis.get(cacheKey);
  if (cached) return res.status(200).json(JSON.parse(cached));

  const { start, end } = dayRange();
  const tokens = await OpdToken.find({ hospitalId, doctorId, date: { $gte: start, $lt: end } })
    .sort({ tokenNumber: 1 })
    .populate("departmentId", "name")
    .lean();

  const currentlyServing = tokens.find((token) => token.status === "in_consultation") || null;
  const waiting = tokens.filter((token) => ["waiting", "vitals_done"].includes(token.status));
  const completed = tokens.filter((token) => token.status === "completed").length;
  const noShows = tokens.filter((token) => token.status === "no_show").length;
  const avgMinutes = await avgConsultationMinutes(doctorId);
  const estimatedEndTime = waiting.length ? new Date(Date.now() + waiting.length * avgMinutes * 60 * 1000) : null;

  const payload = { currentlyServing, waiting, completed, noShows, estimatedEndTime };
  await redis.set(cacheKey, JSON.stringify(payload), "EX", 20);
  return res.status(200).json(payload);
};

const getTokenForStaff = async (req, res, tokenId) => {
  const token = await OpdToken.findById(tokenId);
  if (!token) {
    res.status(404).json({ message: "Token not found" });
    return null;
  }
  if (!sameHospital(req, token.hospitalId)) {
    res.status(403).json({ message: "Forbidden hospital access" });
    return null;
  }
  return token;
};

const recordVitals = async (req, res) => {
  const token = await getTokenForStaff(req, res, req.params.tokenId);
  if (!token) return;

  token.vitals = {
    bp: req.body.bp,
    temperature: req.body.temperature,
    pulse: req.body.pulse,
    oxygenSat: req.body.oxygenSat,
    weight: req.body.weight,
    height: req.body.height,
    recordedAt: new Date(),
    recordedBy: req.staff.id,
  };
  token.chiefComplaint = req.body.chiefComplaint || token.chiefComplaint;
  token.status = "vitals_done";
  token.vitalsCompletedAt = new Date();
  await token.save();
  await clearOpdCache({ hospitalId: token.hospitalId, doctorId: token.doctorId });

  const payload = { tokenId: token._id, displayToken: token.displayToken, vitals: token.vitals, chiefComplaint: token.chiefComplaint };
  emitDoctor(token.doctorId, "opd:vitals-ready", payload);
  emitHospital(token.hospitalId, "opd:vitals-ready", payload);
  return res.status(200).json({ message: "Vitals recorded", token });
};

const startConsultation = async (req, res) => {
  const token = await getTokenForStaff(req, res, req.params.tokenId);
  if (!token) return;
  if (String(token.doctorId) !== req.staff.id) {
    return res.status(403).json({ message: "Only the assigned doctor can start this consultation" });
  }
  if (!["waiting", "vitals_done"].includes(token.status)) {
    return res.status(400).json({ message: "Token is not ready for consultation" });
  }

  const { start, end } = dayRange(token.date);
  const active = await OpdToken.findOne({
    doctorId: token.doctorId,
    date: { $gte: start, $lt: end },
    status: "in_consultation",
    _id: { $ne: token._id },
  });
  if (active) return res.status(409).json({ message: "Another consultation is already active" });

  token.status = "in_consultation";
  token.consultationStartedAt = new Date();
  await token.save();
  await clearOpdCache({ hospitalId: token.hospitalId, doctorId: token.doctorId });
  emitHospital(token.hospitalId, "opd:consultation-started", { token });
  return res.status(200).json({ message: "Consultation started", token });
};

const completeConsultation = async (req, res) => {
  const token = await getTokenForStaff(req, res, req.params.tokenId);
  if (!token) return;
  if (String(token.doctorId) !== req.staff.id) {
    return res.status(403).json({ message: "Only the assigned doctor can complete this consultation" });
  }

  token.status = "completed";
  token.consultationEndedAt = new Date();
  await token.save();
  await clearOpdCache({ hospitalId: token.hospitalId, doctorId: token.doctorId });
  emitHospital(token.hospitalId, "opd:consultation-completed", { token, notes: req.body.notes, diagnosis: req.body.diagnosis, followUpDate: req.body.followUpDate });
  return res.status(200).json({ message: "Consultation completed", token });
};

const markNoShow = async (req, res) => {
  const token = await getTokenForStaff(req, res, req.params.tokenId);
  if (!token) return;
  if (!["NURSE", "RECEPTIONIST", "HOSPITAL_ADMIN"].includes(req.staff.role)) {
    return res.status(403).json({ message: "Nurse, receptionist or admin access is required" });
  }
  token.status = "no_show";
  await token.save();
  await clearOpdCache({ hospitalId: token.hospitalId, doctorId: token.doctorId });
  emitHospital(token.hospitalId, "opd:no-show", { token });
  return res.status(200).json({ message: "Token marked as no-show", token });
};

const getMyActiveToken = async (req, res) => {
  const { hospitalId } = req.params;
  const { start, end } = dayRange();
  const token = await OpdToken.findOne({
    hospitalId,
    patientId: req.auth.id,
    date: { $gte: start, $lt: end },
    status: { $in: ["waiting", "vitals_done", "in_consultation"] },
  }).lean();
  return res.status(200).json({ token });
};

export {
  completeConsultation,
  getDoctorQueue,
  getMyActiveToken,
  issueToken,
  markNoShow,
  recordVitals,
  startConsultation,
};
