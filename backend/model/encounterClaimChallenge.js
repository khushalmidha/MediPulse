import mongoose from "mongoose";

const schema = new mongoose.Schema(
  {
    _id: String, // "claim_otp:<encounterId>:<userId>" or "claim_proof:<proofHash>"
    kind: { type: String, enum: ["otp", "proof"], required: true },
    encounterId: { type: mongoose.Schema.Types.ObjectId, ref: "EncounterJourney", required: true },
    hospitalId: { type: mongoose.Schema.Types.ObjectId, ref: "Hospital" },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "user", required: true },
    familyMemberId: { type: String, default: "" },
    phone: { type: String },
    otpHash: { type: String, select: false },
    attempts: { type: Number, default: 0 },
    requestedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true, autoIndex: false }
);

schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "ag05_claim_challenge_expiry" });
schema.index({ encounterId: 1, userId: 1, kind: 1 }, { name: "ag05_claim_encounter_user" });

export default mongoose.model("EncounterClaimChallenge", schema);
