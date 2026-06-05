import mongoose from "mongoose";

const paymentNotificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userRole: {
      type: String,
      enum: ["user", "doctor", "admin"],
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: ["PAYMENT_RECEIVED", "REFUND_RECEIVED", "TOPUP_SUCCESS", "PAYMENT_FAILED"],
      required: true,
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    transactionId: {
      type: String,
      default: null,
    },
    isRead: {
      type: Boolean,
      default: false,
      index: true,
    },
    data: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

const PaymentNotification = mongoose.model("paymentNotification", paymentNotificationSchema);

export default PaymentNotification;
