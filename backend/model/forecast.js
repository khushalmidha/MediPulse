import mongoose from "mongoose";

const forecastSchema = new mongoose.Schema(
  {
    hospitalId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Hospital",
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["beds", "blood"],
      required: true,
    },
    forecasts: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
  },
  { timestamps: true }
);

const Forecast = mongoose.model("Forecast", forecastSchema);

export default Forecast;
