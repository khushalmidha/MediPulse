import crypto from "node:crypto";
import mongoose from "mongoose";
// Canonical hostname is the unique ownership boundary, including concurrent claims.
const schema = new mongoose.Schema({
  _id: { type: String },
  hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital", required: true, index: true },
  challenge: { type: String, required: true, default: () => `medipulse-${crypto.randomBytes(24).toString("hex")}` },
  verified: { type: Boolean, default: false },
  state: { type: String, enum: ["pending", "ready", "removing"], default: "pending" },
}, { timestamps: true });
export default mongoose.model("HospitalDomain", schema);
