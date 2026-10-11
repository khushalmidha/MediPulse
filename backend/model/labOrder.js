import mongoose from "mongoose";

const labResultItemSchema = new mongoose.Schema({
  parameterCode: { type: String, required: true },
  parameterName: { type: String, required: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
  unit: { type: String, default: "" },
  referenceRangeText: { type: String, default: "" },
  flag: {
    type: String,
    enum: ["normal", "low", "high", "critical_low", "critical_high"],
    default: "normal",
  },
  isCritical: { type: Boolean, default: false },
});

const labOrderCorrectionSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  correctedAt: { type: Date, default: Date.now },
  correctedBy: { type: String, required: true },
  reason: { type: String, required: true },
  previousResults: [labResultItemSchema],
});

const labOrderAuditSchema = new mongoose.Schema({
  stage: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId },
  actorName: { type: String, default: "Staff" },
  timestamp: { type: Date, default: Date.now },
  notes: { type: String, default: "" },
});

const labOrderSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },
    encounterJourneyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EncounterJourney",
      index: true,
    },
    tokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpdToken",
      index: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      index: true,
    },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
    serviceDepartmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Department" },
    familyMemberId: { type: mongoose.Schema.Types.ObjectId },
    personKey: String,
    patientInfo: {
      name: { type: String, required: true },
      age: { type: Number },
      gender: { type: String },
      phone: { type: String },
    },
    orderingDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HospitalStaff",
    },
    orderingDoctorName: {
      type: String,
      default: "Attending Physician",
    },
    clinicalNotes: {
      type: String,
      default: "",
    },
    tests: [
      {
        catalogId: { type: mongoose.Schema.Types.ObjectId, ref: "LabTestCatalog" },
        testCode: { type: String, required: true },
        testName: { type: String, required: true },
        category: { type: String, default: "General" },
        priceMinor: { type: Number, default: 0 },
      },
    ],
    orderStatus: {
      type: String,
      enum: [
        "ordered",
        "billing_cleared",
        "collected",
        "processing",
        "result_entered",
        "verified",
        "released",
        "rejected",
        "cancelled",
      ],
      default: "ordered",
      index: true,
    },
    accessionBarcode: {
      type: String,
      sparse: true,
      index: true,
    },
    collectedAt: { type: Date },
    collectedBy: { type: mongoose.Schema.Types.ObjectId },
    collectedByName: { type: String },
    rejectedReason: { type: String },
    recollectionRequested: { type: Boolean, default: false },

    results: [labResultItemSchema],
    technicianId: { type: mongoose.Schema.Types.ObjectId },
    technicianName: { type: String },
    resultEnteredAt: { type: Date },

    verifiedById: { type: mongoose.Schema.Types.ObjectId },
    verifiedByName: { type: String },
    verifiedAt: { type: Date },

    releasedAt: { type: Date },
    releasedBy: { type: mongoose.Schema.Types.ObjectId },

    criticalValueAlert: {
      isCritical: { type: Boolean, default: false },
      notifiedAt: { type: Date },
      acknowledgedAt: { type: Date },
      acknowledgedBy: { type: String },
    },

    reportVersion: {
      type: Number,
      default: 1,
    },
    reportCorrections: [labOrderCorrectionSchema],
    auditHistory: [labOrderAuditSchema],
  },
  {
    timestamps: true,
  }
);

labOrderSchema.index({ hospitalId: 1, orderStatus: 1 });
labOrderSchema.index({ hospitalId: 1, createdAt: -1 });

const LabOrder = mongoose.model("LabOrder", labOrderSchema);

export default LabOrder;
