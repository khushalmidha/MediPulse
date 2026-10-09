import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const opdTokenSchema = new mongoose.Schema(
  {
    practiceType: { type: String, enum: ["hospital", "independent"] },
    scheduleReservationId: objectId, scheduleSessionId: objectId, scheduledStart: Date, scheduledEnd: Date,
    queueKey: String, practiceKey: String, serviceDate: String, sessionId: String, timezone: String,
    personKey: String, revision: { type: Number, default: 0 },
    refundPreviousStatus: String,
    bookingOperationId: mongoose.Schema.Types.ObjectId,
    visitMode: { type: String, enum: ["in_person", "online"], default: "in_person" },
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    departmentId: { type: objectId, ref: "Department", required: true },
    doctorId: { type: objectId, ref: "HospitalStaff", required: true },
    patientId: { type: objectId, ref: "user" },
    familyMemberId: { type: objectId },
    tokenNumber: { type: Number, required: true },
    displayToken: String,
    date: { type: Date, required: true },
    patientInfo: {
      name: String,
      phone: String,
      age: Number,
      gender: String,
      isWalkIn: { type: Boolean, default: false },
    },
    visitType: { type: String, enum: ["new", "follow_up", "emergency"], default: "new" },
    chiefComplaint: String,
    vitals: {
      bp: String,
      temperature: Number,
      pulse: Number,
      oxygenSat: Number,
      weight: Number,
      height: Number,
      recordedAt: Date,
      recordedBy: { type: objectId, ref: "HospitalStaff" },
    },
    status: {
      type: String,
      enum: ["booking", "reserved", "waiting", "vitals_done", "in_consultation", "completed", "no_show", "cancelled", "refund_pending"],
      default: "waiting",
    },
    arrivedAt: Date,
    vitalsCompletedAt: Date,
    consultationStartedAt: Date,
    consultationEndedAt: Date,
    consultationNotes: { type: String, default: "" },
    diagnosis: { type: String, default: "" },
    followUpDate: Date,
    estimatedWaitMinutes: Number,
    paymentStatus: { type: String, enum: ["pending", "paid", "waived"], default: "pending" },
    paymentAmount: Number,
    paymentMode: { type: String, enum: ["cash", "upi", "card", "wallet", "insurance"] },
    appointmentId: { type: objectId, ref: "Appointment" },
    aiTriage: {
      status: { type: String, enum: ["not_started", "in_progress", "completed"], default: "not_started" },
      messages: [
        {
          role: { type: String, enum: ["patient", "agent"] },
          text: String,
          createdAt: { type: Date, default: Date.now },
        },
      ],
      patientBrief: {
        chiefComplaint: String,
        symptomDuration: String,
        severity: String,
        relevantHistory: String,
        urgencyLevel: String,
        agentSummary: String,
        // FIXED: Doctors could not see which medical-history areas were missed before consultation.
        coverageChecklist: [
          {
            area: String,
            status: { type: String, enum: ["covered", "partial", "not_covered"], default: "not_covered" },
            note: String,
          },
        ],
        uncoveredAreas: [String],
        suggestedDoctorQuestions: [String],
        generatedAt: Date,
        conversationTurns: Number,
      },
    },
    doctorCopilot: {
      lastSuggestion: String,
      lastPrompt: String,
      updatedAt: Date,
    },
  },
  { timestamps: true, autoIndex: false },
);

opdTokenSchema.index(
  { queueKey: 1, tokenNumber: 1 },
  { unique: true, name: "queue_token_number_p03", partialFilterExpression: { queueKey: { $type: "string" } } },
);
opdTokenSchema.index({ patientId: 1, date: -1 });
opdTokenSchema.index({ status: 1, doctorId: 1, date: 1 });
opdTokenSchema.index(
  { queueKey: 1, personKey: 1 },
  {
    unique: true,
    name: "queue_live_patient_p03",
    partialFilterExpression: { queueKey: { $type: "string" }, status: { $in: ["booking", "reserved", "waiting", "vitals_done", "in_consultation", "refund_pending"] } },
  }
);

opdTokenSchema.index({ queueKey: 1 }, { unique: true, name: "queue_active_token_p03", partialFilterExpression: { queueKey: { $type: "string" }, status: "in_consultation" } });
const OpdToken = mongoose.model("OpdToken", opdTokenSchema);

export default OpdToken;
