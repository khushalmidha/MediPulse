import mongoose from "mongoose";

const batchSchema = new mongoose.Schema({
  batchNumber: { type: String, required: true },
  expiryDate: { type: Date, required: true },
  quantityAvailable: { type: Number, required: true, min: 0 },
  quantityReserved: { type: Number, default: 0, min: 0 },
});

const pharmacyInventorySchema = new mongoose.Schema(
  {
    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },
    medicationCode: {
      type: String,
      required: true,
      trim: true,
    },
    medicationName: {
      type: String,
      required: true,
      trim: true,
    },
    genericName: {
      type: String,
      default: "",
    },
    dosageForm: {
      type: String,
      enum: ["tablet", "capsule", "syrup", "injection", "ointment", "drops", "inhaler", "other"],
      default: "tablet",
    },
    strength: {
      type: String,
      default: "",
    },
    unitPriceMinor: {
      type: Number,
      default: 0,
      min: 0,
    },
    batches: [batchSchema],
    totalStock: {
      type: Number,
      default: 0,
      min: 0,
    },
    reorderThreshold: {
      type: Number,
      default: 20,
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

pharmacyInventorySchema.index({ hospitalId: 1, medicationCode: 1 }, { unique: true });

const PharmacyInventory = mongoose.model("PharmacyInventory", pharmacyInventorySchema);

export default PharmacyInventory;
