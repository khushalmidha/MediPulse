import crypto from "node:crypto";
import BookingChallenge from "../model/bookingChallenge.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { enqueueJob } from "./outbox.js";
import { accessError } from "./hospitalAccess.js";
export const otpHash = otp => crypto.createHmac("sha256", process.env.TOKEN_KEY).update(String(otp)).digest("hex");
const challengeId = (userId, doctorId, familyMemberId) => `otp:${userId}:${doctorId}:${familyMemberId || "self"}`;
export const proofId = token => `proof:${crypto.createHash("sha256").update(token).digest("hex")}`;
export const queueBookingOtp = async ({ userId, doctorId, familyMemberId, to, patientName, doctorName, otp }) => {
  const expiresAt = new Date(Date.now() + 600000), id = challengeId(userId, doctorId, familyMemberId), deliveryId = crypto.randomUUID();
  await moneyTransaction(async session => {
    const previous = await BookingChallenge.findById(id).session(session);
    if (previous?.requestedAt > new Date(Date.now() - 60000)) throw accessError(429, "Wait a minute before requesting another OTP");
    await BookingChallenge.findOneAndUpdate({ _id: id }, { $set: { kind: "otp", userId, doctorId, familyMemberId: String(familyMemberId || ""),
      otpHash: otpHash(otp), requestedAt: new Date(), attempts: 0, expiresAt, consumedAt: null } }, { upsert: true, session });
    await enqueueJob({ id: `otp:${deliveryId}`, kind: "booking.otp", payload: { challengeId: id },
      secret: { to, patientName, doctorName, otp, otpHash: otpHash(otp) }, expiresAt }, session);
  });
};
export const verifyBookingOtp = async ({ userId, doctorId, familyMemberId, otp }) => {
  const id = challengeId(userId, doctorId, familyMemberId), now = new Date();
  const challenge = await BookingChallenge.findById(id).select("+otpHash");
  if (!challenge || challenge.expiresAt <= now || challenge.consumedAt) throw accessError(410, "OTP expired or already used");
  if (challenge.attempts >= 5) throw accessError(429, "Too many wrong OTP attempts");
  if (challenge.otpHash !== otpHash(otp)) {
    await BookingChallenge.updateOne({ _id: id, otpHash: challenge.otpHash, attempts: { $lt: 5 }, consumedAt: null, expiresAt: { $gt: now } }, { $inc: { attempts: 1 } });
    throw accessError(401, "Incorrect OTP");
  }
  const token = crypto.randomBytes(32).toString("hex");
  await moneyTransaction(async session => {
    const claimed = await BookingChallenge.findOneAndUpdate({ _id: id, otpHash: otpHash(otp), attempts: { $lt: 5 }, consumedAt: null, expiresAt: { $gt: now } },
      { $set: { consumedAt: now } }, { new: true, session });
    if (!claimed) throw accessError(410, "OTP expired or already used");
    await BookingChallenge.create([{ _id: proofId(token), kind: "proof", userId, doctorId, familyMemberId: String(familyMemberId || ""), expiresAt: new Date(now.getTime() + 600000) }], { session });
  });
  return token;
};
export const readBookingProof = async token => {
  if (typeof token !== "string" || !/^[a-f0-9]{64}$/.test(token)) return null;
  const proof = await BookingChallenge.findById(proofId(token)).lean();
  return proof?.kind === "proof" && !proof.consumedAt && proof.expiresAt > new Date() ? proof : null;
};
export const consumeBookingProof = token => BookingChallenge.updateOne({ _id: proofId(token), kind: "proof" }, { $set: { consumedAt: new Date() } });
