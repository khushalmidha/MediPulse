import mongoose from "mongoose";

const appointmentSchema = new mongoose.Schema(
  {
    practiceType: { type: String, enum: ["hospital", "independent"] },
    appointmentType: { type: String, enum: ["scheduled_online", "online_opd", "hospital_in_person"] },
    scheduleReservationId: mongoose.Schema.Types.ObjectId, scheduleSessionId: mongoose.Schema.Types.ObjectId,
    scheduledStart: Date, scheduledEnd: Date, checkedInAt: Date,
    admissionState: { type: String, enum: ["reserved", "arrived"] },
    feeSnapshot: { amountMinor: Number, currency: String, demo: Boolean },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital" },
    queueKey: String, practiceKey: String, serviceDate: String, sessionId: String, timezone: String,
    personKey: String, revision: { type: Number, default: 0 },
    bookingOperationId: mongoose.Schema.Types.ObjectId,
    opdTokenId: { type: mongoose.Schema.Types.ObjectId, ref: "OpdToken" },
    visitMode: { type: String, enum: ["in_person", "online"], default: "online" },
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
    familyMemberId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    roomId: {
      type: String,
      required: true,
    },
    doctorCopilot: { lastPrompt: String, lastSuggestion: String, updatedAt: Date }, status: {
      type: String,
      enum: ["booking", "queued", "active", "completed", "cancelled", "refund_pending"],
      default: "queued",
      index: true,
    },
    consultationDeadline: Date, refundDueAt: Date,
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
    patientBrief: {
      chiefComplaint: String,
      symptomDuration: String,
      severity: {
        type: String,
        enum: ["mild", "moderate", "severe"],
      },
      relevantHistory: String,
      urgencyLevel: {
        type: String,
        enum: ["ROUTINE", "URGENT", "EMERGENCY"],
      },
      agentSummary: String,
      generatedAt: Date,
      conversationTurns: Number,
      predictedDisease: String,
    },
    soapNote: {
      markdown: String,
      subjective: String,
      objective: String,
      assessment: String,
      plan: String,
      generatedAt: Date,
      generatedBy: String,
    },
    payment: {
      nextRecoveryAt: Date,
      refundState: { type: String, enum: ["processing", "completed"] },
      provider: {
        type: String,
        enum: ["wallet"],
        default: "wallet",
      },
      orderId: {
        type: String,
      },
      paymentId: {
        type: String,
      },
      amountMinor: Number,
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
    autoIndex: false,
  },
);

appointmentSchema.index({ "payment.orderId": 1 }, { unique: true, sparse: true });
appointmentSchema.index(
  { queueKey: 1, personKey: 1 },
  {
    unique: true,
    name: "queue_live_appointment_p03",
    partialFilterExpression: { queueKey: { $type: "string" }, status: { $in: ["booking", "queued", "active", "refund_pending"] } },
  }
);

appointmentSchema.index({ queueKey: 1 }, { unique: true, name: "queue_active_appointment_p03", partialFilterExpression: { queueKey: { $type: "string" }, status: "active" } });


appointmentSchema.index({ status: 1, consultationDeadline: 1 }, { name: "p06_consultation_deadline" });
appointmentSchema.index({ status: 1, refundDueAt: 1 }, { name: "p06_refund_deadline" });

const Appointment = mongoose.model("appointment", appointmentSchema);
export default Appointment;
