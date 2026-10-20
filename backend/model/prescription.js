import mongoose from "mongoose";

const prescriptionItemSchema = new mongoose.Schema({
  inventoryId: { type: mongoose.Schema.Types.ObjectId, ref: "PharmacyInventory" },
  medicationCode: { type: String, required: true },
  medicationName: { type: String, required: true },
  directions: { type: String, required: true },
  durationDays: { type: Number, default: 5 },
  quantityPrescribed: { type: Number, required: true, min: 1 },
  quantityDispensed: { type: Number, default: 0, min: 0 },
  quantityFulfilled: { type: Number, default: 0, min: 0 },
  quantityReturned: { type: Number, default: 0, min: 0 },
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

// Original dispense allocations remain unchanged; returns append references to those allocations.
const fulfillmentAllocationSchema = new mongoose.Schema({
  itemId: { type: mongoose.Schema.Types.ObjectId, required: true },
  inventoryId: { type: mongoose.Schema.Types.ObjectId, required: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, required: true },
  batchNumber: { type: String, required: true },
  expiryDate: { type: Date, required: true },
  quantity: { type: Number, required: true, min: 1 },
  allocationId: mongoose.Schema.Types.ObjectId,
});
const fulfillmentOperationSchema = new mongoose.Schema({
  key: { type: String, required: true },
  requestHash: { type: String, required: true },
  kind: { type: String, enum: ["dispense", "return"], required: true },
  actorId: { type: mongoose.Schema.Types.ObjectId, required: true },
  actorName: { type: String, required: true },
  at: { type: Date, required: true },
  reason: String,
  allocations: [fulfillmentAllocationSchema],
  resultingStatus: String,
});

const prescriptionSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
    },
    encounterJourneyId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "EncounterJourney",
    },
    tokenId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "OpdToken",
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
    },
    creationKey: { type: String },
    requestHash: { type: String },
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
    },
    items: [prescriptionItemSchema],
    fulfillmentLedgerVersion: Number,
    fulfillmentRevision: { type: Number, default: 0 },
    fulfillmentOperations: [fulfillmentOperationSchema],
    dispensedAt: { type: Date },
    dispensedBy: { type: mongoose.Schema.Types.ObjectId },
    dispensedByName: { type: String },
    verificationToken: {
      type: String,
    },
    auditHistory: [prescriptionAuditSchema],
  },
  {
    timestamps: true,
    autoIndex: false,
  }
);

prescriptionSchema.index(
  { hospitalId: 1, creationKey: 1 },
  { unique: true, name: "ag01_prescription_creation_key", partialFilterExpression: { creationKey: { $type: "string" } } }
);
prescriptionSchema.index(
  { verificationToken: 1 },
  { unique: true, name: "ag01_prescription_verification_token", partialFilterExpression: { verificationToken: { $type: "string" } } }
);
prescriptionSchema.index({ hospitalId: 1, status: 1 }, { name: "ag01_prescription_hospital_status" });
prescriptionSchema.index({ hospitalId: 1, createdAt: -1 }, { name: "ag01_prescription_hospital_created" });
prescriptionSchema.index(
  { patientId: 1, createdAt: -1 },
  { name: "ag01_prescription_patient_created", partialFilterExpression: { patientId: { $type: "objectId" } } }
);
prescriptionSchema.index(
  { hospitalId: 1, serviceDepartmentId: 1, status: 1 },
  { name: "ag01_prescription_service_dept_status", partialFilterExpression: { serviceDepartmentId: { $type: "objectId" } } }
);
prescriptionSchema.index(
  { tokenId: 1 },
  { name: "ag01_prescription_token", partialFilterExpression: { tokenId: { $type: "objectId" } } }
);
prescriptionSchema.index(
  { encounterJourneyId: 1 },
  { name: "ag01_prescription_encounter", partialFilterExpression: { encounterJourneyId: { $type: "objectId" } } }
);

const Prescription = mongoose.model("Prescription", prescriptionSchema);

export default Prescription;
