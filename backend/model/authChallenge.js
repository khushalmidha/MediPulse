import mongoose from "mongoose";

const schema = new mongoose.Schema({
  _id: String,
  principalId: { type: mongoose.Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ["user", "doctor"], required: true },
  otpHash: { type: String, required: true, select: false },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "auth_challenge_expiry_p05" });
export default mongoose.model("AuthChallenge", schema);
