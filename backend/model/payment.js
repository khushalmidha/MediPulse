import mongoose from "mongoose";

const refundSchema = new mongoose.Schema(
  {
    refundId: String,
    amount: Number,
    status: {
      type: String,
      enum: ["requested", "processed", "failed"],
      default: "requested",
    },
    reason: String,
    requestedAt: Date,
    processedAt: Date,
    error: String,
  },
  { _id: false },
);

const paymentSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "user",
      required: true,
      index: true,
    },
    doctor: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "doctor",
      required: true,
      index: true,
    },
    appointment: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "appointment",
      index: true,
    },
    provider: {
      type: String,
      enum: ["razorpay"],
      default: "razorpay",
    },
    orderId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    paymentId: {
      type: String,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "INR",
    },
    receipt: {
      type: String,
    },
    status: {
      type: String,
      enum: ["created", "paid", "failed", "refunded", "refund_failed"],
      default: "created",
      index: true,
    },
    paidAt: Date,
    failedAt: Date,
    autoRefundDueAt: Date,
    autoRefundCheckedAt: Date,
    refunds: {
      type: [refundSchema],
      default: [],
    },
    webhookEvents: {
      type: [String],
      default: [],
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  {
    timestamps: true,
  },
);

const Payment = mongoose.model("payment", paymentSchema);

export default Payment;
