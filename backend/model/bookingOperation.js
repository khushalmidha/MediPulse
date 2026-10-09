import mongoose from "mongoose";
const schema = new mongoose.Schema({
  actorKey: { type: String, required: true }, kind: { type: String, required: true },
  requestKey: { type: String, required: true }, fingerprint: { type: String, required: true },
  state: { type: String, enum: ["processing", "completed", "failed", "reconciliation_required", "review_required"], default: "processing" },
  tokenId: mongoose.Schema.Types.ObjectId, appointmentId: mongoose.Schema.Types.ObjectId,
  sourceOperationId: mongoose.Schema.Types.ObjectId,
  paymentId: String, fee: Number, responseStatus: Number, errorMessage: String,
  recoveryData: mongoose.Schema.Types.Mixed, compensationStatus: String, nextRecoveryAt: Date, recoveryAttempts: { type: Number, default: 0 },
}, { timestamps: true, autoIndex: false });
schema.index({ actorKey: 1, kind: 1, requestKey: 1 }, { unique: true, name: "booking_request_p03" });
export default mongoose.model("BookingOperation", schema);
