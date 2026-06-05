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
      enum: ["pending_approval", "queued", "active", "completed", "cancelled"],
      default: "pending_approval",
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
      enum: ["doctor-ended", "auto-timeout", "refunded", "cancelled"],
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
    voiceConsentRecorded: {
      type: Boolean,
      default: false,
    },
    voiceConsentTimestamp: {
      type: Date,
    },
    voiceConsentKeywords: {
      type: [String],
      default: [],
    },
    payment: {
      provider: {
        type: String,
        enum: ["razorpay", "upi", "wallet"],
      },
      orderId: {
        type: String,
      },
      paymentId: {
        type: String,
      },
      amount: {
        type: Number,
      },
      currency: {
        type: String,
      },
      paidAt: {
        type: Date,
      },
      refundId: {
        type: String,
      },
      refundedAt: {
        type: Date,
      },
    },
  },
  {
    timestamps: true,
  },
);

appointmentSchema.index(
  { "payment.orderId": 1 },
  { unique: true, sparse: true },
);

const Appointment = mongoose.model("appointment", appointmentSchema);

export default Appointment;
