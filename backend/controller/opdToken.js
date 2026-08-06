import mongoose from "mongoose";
import Appointment from "../model/appointment.js";
import OpdToken from "../model/opdToken.js";
import Department from "../model/department.js";
import Hospital from "../model/hospital.js";
import HospitalStaff from "../model/hospitalStaff.js";
import { getRedis } from "../services/redis.js";
import { scheduleReviewRequest } from "../services/reviewRequestWorker.js";
import { transferVirtualMoney } from "../services/virtualLedger.js";
import { getIO } from "../socket.js";

const OPD_BOOKING_FEE_INR = Number(process.env.APPOINTMENT_BOOKING_FEE_INR || 5);

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
  const isPatientBooking = req.auth?.role === "user" && !req.staff;

  if (req.staff && !sameHospital(req, hospitalId)) {
    return res.status(403).json({ message: "Forbidden hospital access" });
  }

  const { doctorId, patientId, familyMemberId, patientInfo = {}, visitType = "new", chiefComplaint } = req.body;
  if (!doctorId) {
    return res.status(400).json({ message: "Doctor id is required" });
  }

  const [department, doctor, existingPatientToken] = await Promise.all([
    Department.findOne({ _id: departmentId, hospitalId, status: "active" }),
    HospitalStaff.findOne({ _id: doctorId, hospitalId, role: "DOCTOR", isActive: true }),
    isPatientBooking
      ? OpdToken.findOne({
          hospitalId,
          doctorId,
          patientId: req.auth.id,
          status: { $in: ["waiting", "vitals_done", "in_consultation"] },
        })
      : null,
  ]);

  if (!department) return res.status(404).json({ message: "Department not found" });
  if (!doctor) return res.status(404).json({ message: "Doctor not found in this hospital" });
  if (existingPatientToken) {
    let linkedAppointmentId = existingPatientToken.appointmentId;
    if (isPatientBooking && doctor.doctorId && !linkedAppointmentId) {
      const existingAppointment = await Appointment.findOne({
        doctor: doctor.doctorId,
        user: req.auth.id,
        status: { $in: ["queued", "active"] },
      });
      const linkedAppointment =
        existingAppointment ||
        (await Appointment.create({
          doctor: doctor.doctorId,
          user: req.auth.id,
          familyMemberId: existingPatientToken.familyMemberId,
          roomId: `appointment-${new mongoose.Types.ObjectId().toString()}`,
          status: "queued",
          patientBrief: existingPatientToken.chiefComplaint
            ? {
                chiefComplaint: existingPatientToken.chiefComplaint,
                urgencyLevel: "ROUTINE",
                agentSummary: existingPatientToken.chiefComplaint,
                generatedAt: new Date(),
                conversationTurns: 0,
              }
            : undefined,
        }));
      // FIXED: Tokens created before Appointment sync stayed invisible to the synced doctor's appointment queue.
      existingPatientToken.appointmentId = linkedAppointment._id;
      await existingPatientToken.save();
      linkedAppointmentId = linkedAppointment._id;
      const io = getIO();
      if (io) {
        io.to(`doctor:${doctor.doctorId.toString()}`).emit("appointment:brief-ready", {
          appointmentId: linkedAppointment._id,
          source: "hospital-opd",
        });
      }
    }
    const queuePosition = await OpdToken.countDocuments({
      doctorId,
      date: existingPatientToken.date,
      status: { $in: ["waiting", "vitals_done", "in_consultation"] },
      tokenNumber: { $lte: existingPatientToken.tokenNumber },
    });
    // FIXED: A browser retry after a successful token create used to show an error instead of returning the already-created queue token.
    return res.status(200).json({
      message: "You already have an active OPD token for this doctor",
      token: existingPatientToken,
      appointmentId: linkedAppointmentId,
      displayToken: existingPatientToken.displayToken,
      estimatedWaitMinutes: existingPatientToken.estimatedWaitMinutes,
      queuePosition,
      payment: null,
    });
  }

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
  // FIXED: Public OPD booking was charging hospital consultation fees (INR 400+), unlike the main doctor booking queue's INR 5 wallet debit.
  const fee = isPatientBooking ? OPD_BOOKING_FEE_INR : doctor.doctorProfile?.consultationFee || department.opd?.consultationFee || 0;
  let transaction = null;
  let linkedAppointment = null;

  if (isPatientBooking && fee > 0) {
    if (!doctor.doctorId) {
      return res.status(409).json({ message: "This hospital doctor is still syncing. Please try again shortly." });
    }

    const existingAppointment = await Appointment.findOne({
      doctor: doctor.doctorId,
      user: req.auth.id,
      status: { $in: ["queued", "active"] },
    });
    if (existingAppointment) {
      // FIXED: Duplicate hospital OPD booking checked the normal appointment queue only after wallet debit.
      return res.status(409).json({
        message: "You already have an active appointment in this doctor's queue",
        appointmentId: existingAppointment._id,
        appointmentStatus: existingAppointment.status,
      });
    }

    try {
      transaction = await transferVirtualMoney({
        senderId: req.auth.id,
        senderRole: "user",
        receiverId: doctor.doctorId,
        receiverRole: "doctor",
        amount: fee,
        type: "PAYMENT",
        description: `OPD token booking fee for ${doctor.name}`,
        referenceId: `OPD-${hospitalId}-${departmentId}-${doctorId}-${req.auth.id}-${Date.now()}`,
        metadata: {
          source: "hospital-opd-token",
          hospitalId,
          departmentId,
          doctorStaffId: doctorId,
          platformDoctorId: doctor.doctorId,
        },
      });
    } catch (error) {
      // FIXED: Wallet failures in OPD booking used to reject the async route and look like a dead backend in the browser.
      return res.status(error.message === "Insufficient wallet balance" ? 402 : 409).json({
        message: error.message || "Could not debit OPD booking fee",
      });
    }
  }

  if (isPatientBooking && doctor.doctorId) {
    // FIXED: Hospital OPD bookings created only OpdToken records, so synced doctors never saw them in the normal appointment queue.
    linkedAppointment = await Appointment.create({
      doctor: doctor.doctorId,
      user: req.auth.id,
      familyMemberId,
      roomId: `appointment-${new mongoose.Types.ObjectId().toString()}`,
      status: "queued",
      patientBrief: chiefComplaint
        ? {
            chiefComplaint,
            urgencyLevel: "ROUTINE",
            agentSummary: chiefComplaint,
            generatedAt: new Date(),
            conversationTurns: 0,
          }
        : undefined,
      payment: transaction
        ? {
            provider: "wallet",
            orderId: transaction.transactionId,
            paymentId: transaction.transactionId,
            amount: fee,
            currency: "INR",
            paidAt: new Date(),
          }
        : undefined,
    });
  }

  const token = await OpdToken.create({
    hospitalId,
    departmentId,
    doctorId,
    patientId: patientId || req.auth?.id,
    familyMemberId,
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
    paymentStatus: isPatientBooking ? (fee > 0 ? "paid" : "waived") : "pending",
    paymentAmount: isPatientBooking ? fee : doctor.doctorProfile?.consultationFee || department.opd?.consultationFee || 0,
    paymentMode: isPatientBooking ? "wallet" : undefined,
    appointmentId: linkedAppointment?._id,
  });

  await clearOpdCache({ hospitalId, doctorId });
  emitHospital(hospitalId, "opd:token-issued", { token });
  emitDoctor(doctorId, "opd:token-issued", { token });
  const io = getIO();
  if (io && linkedAppointment) {
    // FIXED: New hospital OPD appointments did not notify the synced platform doctor or patient appointment badge.
    io.to(`doctor:${doctor.doctorId.toString()}`).emit("appointment:brief-ready", {
      appointmentId: linkedAppointment._id,
      source: "hospital-opd",
    });
    io.to(`user:${req.auth.id}`).emit("appointment:user-status", {
      doctorId: doctor.doctorId.toString(),
      pendingCount: 1,
      appointmentId: linkedAppointment._id,
      status: "queued",
      queuePosition: queueAhead + 1,
      hospitalId,
      opdTokenId: token._id,
      displayToken,
    });
  }

  return res.status(201).json({
    token,
    appointmentId: linkedAppointment?._id,
    displayToken,
    estimatedWaitMinutes,
    queuePosition: queueAhead + 1,
    payment: transaction
      ? {
          transactionId: transaction.transactionId,
          amount: fee,
          mode: "wallet",
        }
      : null,
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
  token.consultationNotes = String(req.body.notes || "").trim();
  token.diagnosis = String(req.body.diagnosis || "").trim();
  if (req.body.followUpDate) {
    const followUp = new Date(req.body.followUpDate);
    if (!Number.isNaN(followUp.getTime())) token.followUpDate = followUp;
  }
  await token.save();
  await clearOpdCache({ hospitalId: token.hospitalId, doctorId: token.doctorId });
  await scheduleReviewRequest({ tokenId: token._id, patientId: token.patientId, hospitalId: token.hospitalId });
  emitHospital(token.hospitalId, "opd:consultation-completed", {
    token,
    notes: token.consultationNotes,
    diagnosis: token.diagnosis,
    followUpDate: token.followUpDate,
  });
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
