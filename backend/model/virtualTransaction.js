import mongoose from "mongoose";
import { amountToMinor } from "../util/money.js";

const virtualTransactionSchema = new mongoose.Schema(
  {
    amountMinor: { type: Number, default() { return amountToMinor(this.amount); } },
    refundedMinor: { type: Number, default: 0 }, fingerprint: String,
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
      min: 0.01,
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
  { timestamps: true, autoIndex: false },
);

virtualTransactionSchema.index({ referenceId: 1, type: 1, senderId: 1, receiverId: 1 });
virtualTransactionSchema.index({ senderRole: 1, senderId: 1, referenceId: 1 }, { unique: true, name: "ledger_reference_p04", partialFilterExpression: { referenceId: { $type: "string" } } });

const VirtualTransaction = mongoose.model("virtualTransaction", virtualTransactionSchema);

export default VirtualTransaction;
