import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "doctor",
      required: true,
      index: true,
    },
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    roomId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["queued", "active", "completed", "cancelled"],
      default: "queued",
      index: true,
    },
    startedAt: {
      type: Date,
    },
    endedAt: {
      type: Date,
    },
    endedBy: {
      type: String,
      enum: ["doctor", "system"],
    },
    endedReason: {
      type: String,
      enum: ["doctor-ended", "auto-timeout"],
    },
    doctorNotes: {
      type: String,
      default: "",
    },
    receiptText: {
      type: String,
      default: "",
    },
    receiptGeneratedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  },
);

const Appointment = mongoose.model("appointment", appointmentSchema);

export default Appointment;
