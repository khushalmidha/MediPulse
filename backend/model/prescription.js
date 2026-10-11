import mongoose from "mongoose";

const prescriptionItemSchema = new mongoose.Schema({
  inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyInventory" },
  medicationCode: { type: String, required: true },
  medicationName: { type: String, required: true },
  directions: { type: String, required: true },
  durationDays: { type: Number, default: 5 },
  quantityPrescribed: { type: Number, required: true, min: 1 },
  quantityDispensed: { type: Number, default: 0, min: 0 },
  batchNumber: { type: String },
  unitPriceMinor: { type: Number, default: 0 },
  itemStatus: {
    type: String,
    enum: ["pending", "dispensed", "out_of_stock", "cancelled", "returned"],
    default: "pending",
  },
});

const prescriptionAuditSchema = new mongoose.Schema({
  stage: { type: String, required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId },
  actorName: { type: String, default: "Staff" },
  timestamp: { type: Date, default: Date.now },
  notes: { type: String, default: "" },
});

const prescriptionSchema = new mongoose.Schema(
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
    patientInfo: {
      name: { type: String, required: true },
      age: { type: Number },
      gender: { type: String },
      phone: { type: String },
    },
    prescribingDoctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "HospitalStaff",
    },
    prescribingDoctorName: {
      type: String,
      default: "Attending Physician",
    },
    diagnosis: {
      type: String,
      default: "",
    },
    version: {
      type: Number,
      default: 1,
    },
    status: {
      type: String,
      enum: ["approved_by_doctor", "partially_dispensed", "dispensed", "cancelled", "returned"],
      default: "approved_by_doctor",
      index: true,
    },
    items: [prescriptionItemSchema],
    dispensedAt: { type: Date },
    dispensedBy: { type: mongoose.Schema.Types.ObjectId },
    dispensedByName: { type: String },
    verificationToken: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    auditHistory: [prescriptionAuditSchema],
  },
  {
    timestamps: true,
  }
);

prescriptionSchema.index({ hospitalId: 1, status: 1 });
prescriptionSchema.index({ hospitalId: 1, createdAt: -1 });

const Prescription = mongoose.model("Prescription", prescriptionSchema);

export default Prescription;
