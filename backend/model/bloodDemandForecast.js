import mongoose from "mongoose";

const objectId = mongoose.Schema.Types.ObjectId;

const bloodDemandForecastSchema = new mongoose.Schema(
  {
    hospitalId: { type: objectId, ref: "Hospital", required: true, index: true },
    month: { type: Date, required: true, index: true },
    bloodGroup: {
      type: String,
      enum: ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"],
      required: true,
    },
    predictedUnits: { type: Number, default: 0 },
    recommendedReserve: { type: Number, default: 0 },
    confidence: { type: String, enum: ["low", "medium", "high"], default: "low" },
    sampleSize: { type: Number, default: 0 },
    shortageRisk: { type: String, enum: ["low", "medium", "high"], default: "low" },
    explanation: String,
  },
  { timestamps: true },
);

bloodDemandForecastSchema.index({ hospitalId: 1, month: 1, bloodGroup: 1 }, { unique: true });

export default mongoose.model("BloodDemandForecast", bloodDemandForecastSchema);
