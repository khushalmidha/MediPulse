import { Router } from "express";
import userValidation from "../middleware/validateUser.js";
import {
  createRefund,
  exportTransactionHistory,
  freezeWallet,
  getAdminStats,
  getAdminTransactions,
  getAdminRefunds,
  getAllWallets,
  getNotifications,
  getRefundHistory,
  getTransactionHistory,
  getWalletDashboard,
  markNotificationRead,
  merchantPayDoctor,
  sendMoney,
  topupVirtualFunds,
  unfreezeWallet,
} from "../controller/virtualPayment.js";

const virtualPaymentRouter = Router();

const rejectUnsafeKeys = (value, path = "body") => {
  if (!value || typeof value !== "object") return;
  for (const [key, nested] of Object.entries(value)) {
    if (key.startsWith("$") || key.includes(".")) {
      throw new Error(`Invalid input key at ${path}.${key}`);
    }
    rejectUnsafeKeys(nested, `${path}.${key}`);
  }
};

virtualPaymentRouter.use((req, res, next) => {
  try {
    rejectUnsafeKeys(req.body);
    next();
  } catch (error) {
    res.status(400).json({ message: error.message || "Invalid request body" });
  }
});

virtualPaymentRouter.get("/wallet/dashboard", userValidation, getWalletDashboard);
virtualPaymentRouter.post("/wallet/topup", userValidation, topupVirtualFunds);
virtualPaymentRouter.post("/send", userValidation, sendMoney);
virtualPaymentRouter.post("/merchant/pay", userValidation, merchantPayDoctor);
virtualPaymentRouter.post("/refund", userValidation, createRefund);
virtualPaymentRouter.get("/refunds", userValidation, getRefundHistory);
virtualPaymentRouter.get("/transactions", userValidation, getTransactionHistory);
virtualPaymentRouter.get("/transactions/export", userValidation, exportTransactionHistory);
virtualPaymentRouter.get("/notifications", userValidation, getNotifications);
virtualPaymentRouter.patch("/notifications/:id/read", userValidation, markNotificationRead);

virtualPaymentRouter.get("/admin/wallets", userValidation, getAllWallets);
virtualPaymentRouter.patch("/admin/wallets/:walletId/freeze", userValidation, freezeWallet);
virtualPaymentRouter.patch("/admin/wallets/:walletId/unfreeze", userValidation, unfreezeWallet);
virtualPaymentRouter.get("/admin/transactions", userValidation, getAdminTransactions);
virtualPaymentRouter.get("/admin/refunds", userValidation, getAdminRefunds);
virtualPaymentRouter.get("/admin/stats", userValidation, getAdminStats);

export default virtualPaymentRouter;
