import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const bedDemandForecastSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    departmentId: { type: objectId, ref: "Department", index: true },
    month: { type: Date, required: true, index: true },
    bedType: {
      type: String,
      enum: ["general", "icu", "emergency", "maternity", "pediatric"],
      default: "general",
    },
    predictedDemand: { type: Number, default: 0 },
    recommendedReserve: { type: Number, default: 0 },
    confidence: { type: String, enum: ["low", "medium", "high"], default: "low" },
    sampleSize: { type: Number, default: 0 },
    explanation: String,
  },
  { timestamps: true },
);

bedDemandForecastSchema.index({ hospitalId: 1, departmentId: 1, month: 1, bedType: 1 }, { unique: true });

export default mongoose.model("BedDemandForecast", bedDemandForecastSchema);
