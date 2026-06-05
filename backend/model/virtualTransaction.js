import mongoose from "mongoose";

const virtualTransactionSchema = new mongoose.Schema(
  {
    transactionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    senderRole: {
      type: String,
      enum: ["user", "doctor", "admin"],
      required: true,
      index: true,
    },
    receiverId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    receiverRole: {
      type: String,
      enum: ["user", "doctor", "admin"],
      required: true,
      index: true,
    },
    amount: {
      type: Number,
      required: true,
      min: 1,
    },
    type: {
      type: String,
      enum: ["CREDIT", "DEBIT", "PAYMENT", "REFUND", "TOPUP"],
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "SUCCESS", "FAILED", "REFUNDED"],
      default: "SUCCESS",
      index: true,
    },
    description: {
      type: String,
      default: "",
    },
    referenceId: {
      type: String,
      index: true,
    },
    relatedTransactionId: {
      type: String,
      default: null,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

virtualTransactionSchema.index({ referenceId: 1, type: 1, senderId: 1, receiverId: 1 });

const VirtualTransaction = mongoose.model("virtualTransaction", virtualTransactionSchema);

export default VirtualTransaction;
