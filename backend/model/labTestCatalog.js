import mongoose from "mongoose";

const labParameterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  unit: { type: String, default: "" },
  referenceRangeText: { type: String, default: "" },
  valueType: { type: String, enum: ["number", "text"], default: "number" },
  refMin: { type: Number },
  refMax: { type: Number },
  criticalLow: { type: Number },
  criticalHigh: { type: Number },
});

const labTestCatalogSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["Hematology", "Biochemistry", "Microbiology", "Pathology", "Radiology", "Immunology", "General"],
      default: "General",
    },
    specimenType: {
      type: String,
      enum: ["Whole Blood", "Serum", "Plasma", "Urine", "Stool", "Swab", "Tissue", "Other"],
      default: "Whole Blood",
    },
    parameters: [labParameterSchema],
    priceMinor: {
      type: Number,
      default: 0,
    },
    turnaroundHours: {
      type: Number,
      default: 4,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

labTestCatalogSchema.index({ hospitalId: 1, code: 1 }, { unique: true });

const LabTestCatalog = mongoose.model("LabTestCatalog", labTestCatalogSchema);

export default LabTestCatalog;
