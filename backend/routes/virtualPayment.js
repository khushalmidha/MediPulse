import { nosqlGuard } from "../middleware/nosqlGuard.js";
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
const asyncRoute = (handler) => async (req, res) => {
  try { await handler(req, res); }
  catch (error) { if (!res.headersSent) res.status(error.status || 503).json({ message: error.status ? error.message : "Demo wallet service unavailable; retry the same request key" }); }
};


virtualPaymentRouter.use(nosqlGuard);


virtualPaymentRouter.get("/wallet/dashboard", userValidation, asyncRoute(getWalletDashboard));
virtualPaymentRouter.post("/wallet/topup", userValidation, asyncRoute(topupVirtualFunds));
virtualPaymentRouter.post("/send", userValidation, asyncRoute(sendMoney));
virtualPaymentRouter.post("/merchant/pay", userValidation, asyncRoute(merchantPayDoctor));
virtualPaymentRouter.post("/refund", userValidation, asyncRoute(createRefund));
virtualPaymentRouter.get("/refunds", userValidation, asyncRoute(getRefundHistory));
virtualPaymentRouter.get("/transactions", userValidation, asyncRoute(getTransactionHistory));
virtualPaymentRouter.get("/transactions/export", userValidation, asyncRoute(exportTransactionHistory));
virtualPaymentRouter.get("/notifications", userValidation, asyncRoute(getNotifications));
virtualPaymentRouter.patch("/notifications/:id/read", userValidation, asyncRoute(markNotificationRead));

virtualPaymentRouter.get("/admin/wallets", userValidation, asyncRoute(getAllWallets));
virtualPaymentRouter.patch("/admin/wallets/:walletId/freeze", userValidation, asyncRoute(freezeWallet));
virtualPaymentRouter.patch("/admin/wallets/:walletId/unfreeze", userValidation, asyncRoute(unfreezeWallet));
virtualPaymentRouter.get("/admin/transactions", userValidation, asyncRoute(getAdminTransactions));
virtualPaymentRouter.get("/admin/refunds", userValidation, asyncRoute(getAdminRefunds));
virtualPaymentRouter.get("/admin/stats", userValidation, asyncRoute(getAdminStats));

export default virtualPaymentRouter;
