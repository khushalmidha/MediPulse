import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const opdTokenSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    departmentId: { type: objectId, ref: "Department", required: true },
    doctorId: { type: objectId, ref: "HospitalStaff", required: true },
    patientId: { type: objectId, ref: "user" },
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
      enum: ["waiting", "vitals_done", "in_consultation", "completed", "no_show", "cancelled"],
      default: "waiting",
    },
    arrivedAt: Date,
    vitalsCompletedAt: Date,
    consultationStartedAt: Date,
    consultationEndedAt: Date,
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
  { timestamps: true },
);

opdTokenSchema.index(
  { hospitalId: 1, departmentId: 1, doctorId: 1, date: 1, tokenNumber: 1 },
  { unique: true },
);
opdTokenSchema.index({ patientId: 1, date: -1 });
opdTokenSchema.index({ status: 1, doctorId: 1, date: 1 });

const OpdToken = mongoose.model("OpdToken", opdTokenSchema);

export default OpdToken;
