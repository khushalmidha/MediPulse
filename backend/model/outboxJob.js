import mongoose from "mongoose";
const schema = new mongoose.Schema({
  _id: String, kind: { type: String, required: true }, payload: { type: mongoose.Schema.Types.Mixed, default: {} },
  secret: { type: String, select: false }, expiresAt: Date,
  state: { type: String, enum: ["pending", "processing", "delivered", "failed", "skipped"], default: "pending" },
  availableAt: { type: Date, default: Date.now }, attempts: { type: Number, default: 0 },
  leaseToken: String, leaseUntil: Date, deliveredAt: Date, lastError: String,
}, { timestamps: true, autoIndex: false });
schema.index({ state: 1, availableAt: 1, leaseUntil: 1 }, { name: "p06_outbox_claim" });
export default mongoose.model("OutboxJob", schema);
