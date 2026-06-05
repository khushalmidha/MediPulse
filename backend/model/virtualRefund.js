import mongoose from "mongoose";

const virtualRefundSchema = new mongoose.Schema(
  {
    refundId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    paymentId: {
      type: String,
      required: true,
      index: true,
    },
    refundTransactionId: {
      type: String,
      default: null,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 0.01,
    },
    reason: {
      type: String,
      default: "",
    },
    status: {
      type: String,
      enum: ["CREATED", "COMPLETED", "FAILED"],
      default: "CREATED",
      index: true,
    },
    requestedById: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    requestedByRole: {
      type: String,
      enum: ["user", "doctor", "admin"],
      required: true,
    },
    idempotencyKey: {
      type: String,
      index: true,
    },
    failureReason: {
      type: String,
      default: "",
    },
  },
  { timestamps: true },
);

virtualRefundSchema.index({ paymentId: 1, idempotencyKey: 1 }, { unique: true, sparse: true });

const VirtualRefund = mongoose.model("virtualRefund", virtualRefundSchema);

export default VirtualRefund;
