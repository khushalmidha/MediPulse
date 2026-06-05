import mongoose from "mongoose";

const virtualAnalyticsEventSchema = new mongoose.Schema(
  {
    topic: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
    occurredAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
  },
  {
    timestamps: true,
  },
);

const VirtualAnalyticsEvent = mongoose.model("virtualAnalyticsEvent", virtualAnalyticsEventSchema);

export default VirtualAnalyticsEvent;
