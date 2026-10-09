import mongoose from "mongoose";
const schema = new mongoose.Schema({ _id: String, kind: { type: String, enum: ["otp", "proof"] }, userId: mongoose.Schema.Types.ObjectId,
 doctorId: mongoose.Schema.Types.ObjectId, familyMemberId: String, otpHash: { type: String, select: false },
 requestedAt: Date, attempts: { type: Number, default: 0 }, expiresAt: Date, consumedAt: Date }, { autoIndex: false });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: "p06_booking_expiry" });
export default mongoose.model("BookingChallenge", schema);
