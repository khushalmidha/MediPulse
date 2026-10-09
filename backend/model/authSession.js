import mongoose from "mongoose";

const schema = new mongoose.Schema({
  _id: String,
  principalId: { type: mongoose.Schema.Types.ObjectId, required: true },
  kind: { type: String, enum: ["user", "doctor", "staff"], required: true },
  authVersion: { type: Number, default: 0 },
  csrfToken: { type: String, required: true, select: false },
  expiresAt: { type: Date, required: true },
  revokedAt: { type: Date, default: null },
}, { timestamps: true });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "auth_session_expiry_p05" });
schema.index({ principalId: 1, kind: 1, revokedAt: 1 }, { name: "auth_principal_p05" });
export default mongoose.model("AuthSession", schema);
