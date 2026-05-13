import mongoose from "mongoose";
import Appointment from "../model/appointment.js";
import Doctor from "../model/doctor.js";
import { getIO } from "../socket.js";
import { generateGeminiText } from "./gemini.js";

const APPOINTMENT_DURATION_MS = 5 * 60 * 1000;
const appointmentTimeouts = new Map();

const mapQueueAppointment = (appointment) => ({
  _id: appointment._id,
  status: appointment.status,
  createdAt: appointment.createdAt,
  startedAt: appointment.startedAt,
  endedAt: appointment.endedAt,
  roomId: appointment.roomId,
  user: appointment.user
    ? {
        _id: appointment.user._id,
        firstName: appointment.user.firstName,
        lastName: appointment.user.lastName,
        email: appointment.user.email,
      }
    : null,
});

const mapHistoryAppointment = (appointment) => ({
  _id: appointment._id,
  doctor: appointment.doctor,
  user: appointment.user,
  status: appointment.status,
  createdAt: appointment.createdAt,
  startedAt: appointment.startedAt,
  endedAt: appointment.endedAt,
  endedBy: appointment.endedBy,
  endedReason: appointment.endedReason,
  doctorNotes: appointment.doctorNotes || "",
  receiptText: appointment.receiptText || "",
  receiptGeneratedAt: appointment.receiptGeneratedAt || null,
  endsAt: appointment.startedAt
    ? new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS)
    : null,
});

const mapActiveAppointment = (appointment) => {
  if (!appointment) return null;
  return {
    _id: appointment._id,
    status: appointment.status,
    createdAt: appointment.createdAt,
    startedAt: appointment.startedAt,
    endedAt: appointment.endedAt,
    roomId: appointment.roomId,
    doctorNotes: appointment.doctorNotes || "",
    receiptText: appointment.receiptText || "",
    receiptGeneratedAt: appointment.receiptGeneratedAt || null,
    endsAt: appointment.startedAt
      ? new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS)
      : null,
    user: appointment.user
      ? {
          _id: appointment.user._id,
          firstName: appointment.user.firstName,
          lastName: appointment.user.lastName,
          email: appointment.user.email,
        }
      : null,
  };
};

const buildDoctorQueuePayload = async (doctorId) => {
  const [queuedAppointments, activeAppointment] = await Promise.all([
    Appointment.find({ doctor: doctorId, status: "queued" })
      .sort({ createdAt: 1 })
      .populate("user", "firstName lastName email"),
    Appointment.findOne({ doctor: doctorId, status: "active" })
      .sort({ startedAt: 1 })
      .populate("user", "firstName lastName email")
      .populate("doctor", "firstName lastName email"),
  ]);

  return {
    doctorId,
    pendingCount: queuedAppointments.length,
    queue: queuedAppointments.map(mapQueueAppointment),
    activeAppointment: mapActiveAppointment(activeAppointment),
  };
};

const emitQueueUpdates = async (doctorId) => {
  const io = getIO();
  if (!io) return;

  const payload = await buildDoctorQueuePayload(doctorId);
  io.to(`doctor:${doctorId}`).emit("appointment:queue-updated", payload);

  payload.queue.forEach((appointment, index) => {
    io.to(`user:${appointment.user._id}`).emit("appointment:user-status", {
      doctorId,
      pendingCount: payload.pendingCount,
      appointmentId: appointment._id,
      status: "queued",
      queuePosition: index + 1,
    });
  });

  if (payload.activeAppointment?.user?._id) {
    io.to(`user:${payload.activeAppointment.user._id}`).emit(
      "appointment:user-status",
      {
        doctorId,
        pendingCount: payload.pendingCount,
        appointmentId: payload.activeAppointment._id,
        status: "active",
        queuePosition: 0,
        startedAt: payload.activeAppointment.startedAt,
        endsAt: payload.activeAppointment.endsAt,
      },
    );
  }
};

const clearAppointmentTimeout = (appointmentId) => {
  const timer = appointmentTimeouts.get(appointmentId);
  if (!timer) return;
  clearTimeout(timer);
  appointmentTimeouts.delete(appointmentId);
};

const scheduleAppointmentTimeout = (appointmentId) => {
  clearAppointmentTimeout(appointmentId);
  const timer = setTimeout(async () => {
    await finishAppointment(appointmentId, "system", "auto-timeout");
  }, APPOINTMENT_DURATION_MS);
  appointmentTimeouts.set(appointmentId, timer);
};

const finishAppointment = async (appointmentId, endedBy, endedReason) => {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment || appointment.status !== "active") {
    clearAppointmentTimeout(appointmentId);
    return null;
  }

  appointment.status = "completed";
  appointment.endedAt = new Date();
  appointment.endedBy = endedBy;
  appointment.endedReason = endedReason;
  await appointment.save();
  clearAppointmentTimeout(appointmentId);

  await emitQueueUpdates(appointment.doctor.toString());

  const io = getIO();
  if (io) {
    const endedPayload = {
      appointmentId: appointment._id,
      endedAt: appointment.endedAt,
      endedBy,
      endedReason,
    };
    io.to(`appointment:${appointmentId}`).emit("appointment:ended", endedPayload);
    io.to(`doctor:${appointment.doctor.toString()}`).emit(
      "appointment:ended",
      endedPayload,
    );
    io.to(`user:${appointment.user.toString()}`).emit("appointment:ended", endedPayload);
  }

  return appointment;
};

const buildReceiptPrompt = (appointment, notes) => {
  const doctorName = [appointment.doctor?.firstName, appointment.doctor?.lastName]
    .filter(Boolean)
    .join(" ");
  const patientName = [appointment.user?.firstName, appointment.user?.lastName]
    .filter(Boolean)
    .join(" ");

  return `Create a concise medical receipt for a completed telehealth appointment.
Return plain text only with these sections:
Receipt Title
Patient Name
Doctor Name
Appointment Date
Visit Summary
Doctor Notes
Advice
Follow Up

Rules:
- Keep it professional, short, and easy to download as a text receipt.
- Do not invent symptoms, medicines, or diagnoses.
- Use the doctor notes below as the only clinical details.
- If a section has no information, write "Not provided".

Patient Name: ${patientName || "Not provided"}
Doctor Name: ${doctorName || "Not provided"}
Appointment Date: ${appointment.startedAt ? appointment.startedAt.toISOString() : appointment.createdAt.toISOString()}
Doctor Notes: ${notes || appointment.doctorNotes || "Not provided"}`;
};

const generateReceiptText = async (appointment, notes) => {
  const prompt = buildReceiptPrompt(appointment, notes);
  return generateGeminiText(prompt, "general");
};

const bookAppointment = async (req, res) => {
  const { doctorId } = req.params;
  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only users can book appointments" });
  }

  if (!mongoose.Types.ObjectId.isValid(doctorId)) {
    return res.status(400).json({ message: "Invalid doctor id" });
  }

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) {
    return res.status(404).json({ message: "Doctor not found" });
  }

  const existing = await Appointment.findOne({
    doctor: doctorId,
    user: req.auth.id,
    status: { $in: ["queued", "active"] },
  });

  if (existing) {
    const pendingCount = await Appointment.countDocuments({
      doctor: doctorId,
      status: "queued",
    });
    return res.status(409).json({
      message: "You already have a pending appointment for this doctor",
      appointmentId: existing._id,
      status: existing.status,
      pendingCount,
    });
  }

  const appointment = await Appointment.create({
    doctor: doctorId,
    user: req.auth.id,
    roomId: `appointment-${new mongoose.Types.ObjectId().toString()}`,
    status: "queued",
  });

  const queuePosition =
    (await Appointment.countDocuments({
      doctor: doctorId,
      status: "queued",
      createdAt: { $lte: appointment.createdAt },
    })) || 1;

  await emitQueueUpdates(doctorId);

  res.status(201).json({
    message: "Appointment booked successfully",
    appointmentId: appointment._id,
    status: appointment.status,
    queuePosition,
  });
};

const getDoctorQueue = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res
      .status(403)
      .json({ message: "Only doctors can access full appointment queue" });
  }

  const payload = await buildDoctorQueuePayload(req.auth.id);
  return res.status(200).json(payload);
};

const getDoctorPendingStatus = async (req, res) => {
  const { doctorId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(doctorId)) {
    return res.status(400).json({ message: "Invalid doctor id" });
  }

  const doctor = await Doctor.findById(doctorId);
  if (!doctor) {
    return res.status(404).json({ message: "Doctor not found" });
  }

  const pendingCount = await Appointment.countDocuments({
    doctor: doctorId,
    status: "queued",
  });

  const response = {
    doctorId,
    pendingCount,
    myAppointment: null,
  };

  if (req.auth.role === "user") {
    const myAppointment = await Appointment.findOne({
      doctor: doctorId,
      user: req.auth.id,
      status: { $in: ["queued", "active"] },
    }).sort({ createdAt: 1 });

    if (myAppointment) {
      const queuePosition =
        myAppointment.status === "queued"
          ? await Appointment.countDocuments({
              doctor: doctorId,
              status: "queued",
              createdAt: { $lte: myAppointment.createdAt },
            })
          : 0;
      response.myAppointment = {
        _id: myAppointment._id,
        status: myAppointment.status,
        createdAt: myAppointment.createdAt,
        queuePosition,
        startedAt: myAppointment.startedAt,
        endsAt: myAppointment.startedAt
          ? new Date(myAppointment.startedAt.getTime() + APPOINTMENT_DURATION_MS)
          : null,
      };
    }
  }

  return res.status(200).json(response);
};

const getUserAppointmentHistory = async (req, res) => {
  if (req.auth.role !== "user") {
    return res.status(403).json({ message: "Only users can view appointment history" });
  }

  const { doctorId } = req.query;
  const query = { user: req.auth.id };
  if (doctorId) {
    if (!mongoose.Types.ObjectId.isValid(doctorId)) {
      return res.status(400).json({ message: "Invalid doctor id" });
    }
    query.doctor = doctorId;
  }

  const appointments = await Appointment.find(query)
    .sort({ createdAt: -1 })
    .populate("doctor", "firstName lastName email")
    .populate("user", "firstName lastName email");

  return res.status(200).json({
    appointments: appointments.map(mapHistoryAppointment),
  });
};

const updateDoctorNotes = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res.status(403).json({ message: "Only doctors can add notes" });
  }

  const { appointmentId } = req.params;
  const { doctorNotes = "" } = req.body;

  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  if (appointment.doctor.toString() !== req.auth.id.toString()) {
    return res.status(403).json({ message: "You cannot update this appointment" });
  }

  appointment.doctorNotes = doctorNotes.trim();
  await appointment.save();

  return res.status(200).json({
    message: "Doctor notes saved",
    appointmentId: appointment._id,
    doctorNotes: appointment.doctorNotes,
  });
};

const generateAppointmentReceipt = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res.status(403).json({ message: "Only doctors can generate receipts" });
  }

  const { appointmentId } = req.params;
  const { doctorNotes = "" } = req.body;

  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctor", "firstName lastName email")
    .populate("user", "firstName lastName email");

  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  if (appointment.doctor._id.toString() !== req.auth.id.toString()) {
    return res.status(403).json({ message: "You cannot generate receipt for this appointment" });
  }

  const notesToUse = doctorNotes.trim() || appointment.doctorNotes || "";
  const receiptText = await generateReceiptText(appointment, notesToUse);

  appointment.doctorNotes = notesToUse;
  appointment.receiptText = receiptText;
  appointment.receiptGeneratedAt = new Date();
  await appointment.save();

  return res.status(200).json({
    message: "Receipt generated successfully",
    appointmentId: appointment._id,
    receiptText,
    receiptGeneratedAt: appointment.receiptGeneratedAt,
    doctorNotes: appointment.doctorNotes,
  });
};

const getAppointmentById = async (req, res) => {
  const { appointmentId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointment = await Appointment.findById(appointmentId)
    .populate("doctor", "firstName lastName email")
    .populate("user", "firstName lastName email");

  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  const doctorAccess =
    req.auth.role === "doctor" &&
    appointment.doctor?._id?.toString() === req.auth.id.toString();
  const userAccess =
    req.auth.role === "user" &&
    appointment.user?._id?.toString() === req.auth.id.toString();

  if (!doctorAccess && !userAccess) {
    return res.status(403).json({ message: "You cannot access this appointment" });
  }

  return res.status(200).json({
    _id: appointment._id,
    status: appointment.status,
    roomId: appointment.roomId,
    createdAt: appointment.createdAt,
    startedAt: appointment.startedAt,
    endedAt: appointment.endedAt,
    endedBy: appointment.endedBy,
    endedReason: appointment.endedReason,
    doctorNotes: appointment.doctorNotes || "",
    receiptText: appointment.receiptText || "",
    receiptGeneratedAt: appointment.receiptGeneratedAt || null,
    endsAt: appointment.startedAt
      ? new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS)
      : null,
    doctor: appointment.doctor,
    user: appointment.user,
  });
};

const startAppointment = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res.status(403).json({ message: "Only doctors can start appointments" });
  }

  const { appointmentId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }

  if (appointment.doctor.toString() !== req.auth.id.toString()) {
    return res.status(403).json({ message: "You cannot start this appointment" });
  }

  if (appointment.status !== "queued") {
    return res.status(409).json({ message: "Appointment is not in queued state" });
  }

  const firstInQueue = await Appointment.findOne({
    doctor: req.auth.id,
    status: "queued",
  }).sort({ createdAt: 1 });

  if (!firstInQueue || firstInQueue._id.toString() !== appointmentId.toString()) {
    return res
      .status(409)
      .json({ message: "Please start appointments strictly in queue order" });
  }

  appointment.status = "active";
  appointment.startedAt = new Date();
  appointment.endedAt = null;
  appointment.endedBy = null;
  appointment.endedReason = null;
  await appointment.save();

  scheduleAppointmentTimeout(appointmentId.toString());
  await emitQueueUpdates(req.auth.id.toString());

  const io = getIO();
  if (io) {
    const payload = {
      appointmentId: appointment._id,
      status: appointment.status,
      startedAt: appointment.startedAt,
      endsAt: new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS),
    };
    io.to(`appointment:${appointmentId}`).emit("appointment:started", payload);
    io.to(`doctor:${appointment.doctor.toString()}`).emit("appointment:started", payload);
    io.to(`user:${appointment.user.toString()}`).emit("appointment:started", payload);
  }

  return res.status(200).json({
    message: "Appointment started",
    appointmentId: appointment._id,
    status: appointment.status,
    startedAt: appointment.startedAt,
    endsAt: new Date(appointment.startedAt.getTime() + APPOINTMENT_DURATION_MS),
  });
};

const endAppointment = async (req, res) => {
  if (req.auth.role !== "doctor") {
    return res.status(403).json({ message: "Only doctors can end appointments" });
  }

  const { appointmentId } = req.params;
  if (!mongoose.Types.ObjectId.isValid(appointmentId)) {
    return res.status(400).json({ message: "Invalid appointment id" });
  }

  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return res.status(404).json({ message: "Appointment not found" });
  }
  if (appointment.doctor.toString() !== req.auth.id.toString()) {
    return res.status(403).json({ message: "You cannot end this appointment" });
  }
  if (appointment.status !== "active") {
    return res.status(409).json({ message: "Appointment is not active" });
  }

  const completed = await finishAppointment(
    appointmentId.toString(),
    "doctor",
    "doctor-ended",
  );
  if (!completed) {
    return res.status(409).json({ message: "Appointment is no longer active" });
  }

  return res.status(200).json({
    message: "Appointment ended",
    appointmentId: completed._id,
    status: completed.status,
    endedAt: completed.endedAt,
    endedBy: completed.endedBy,
    endedReason: completed.endedReason,
  });
};

export {
  APPOINTMENT_DURATION_MS,
  bookAppointment,
  endAppointment,
  getAppointmentById,
  getDoctorPendingStatus,
  getDoctorQueue,
  getUserAppointmentHistory,
  generateAppointmentReceipt,
  startAppointment,
  updateDoctorNotes,
};
