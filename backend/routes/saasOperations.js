import { Router } from "express";
import {
  listTenants,
  getTenantDetails,
  updateTenantSubscription,
  patchSuspendTenant,
  patchUnsuspendTenant,
  postGenerateSetupLink,
  getVerifySetupLink,
  getTenantMetrics,
  postCreateSupportTicket,
  getExportTenant,
  getBillingStatus,
  postCreateCheckout,
} from "../controller/saasOperations.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";

const saasRouter = Router();
saasRouter.use(nosqlGuard);

// Public verification for setup links
saasRouter.get("/setup-link/verify/:token", getVerifySetupLink);

// Billing provider interface
saasRouter.get("/billing/status", getBillingStatus);
saasRouter.post("/billing/checkout", postCreateCheckout);

// Tenants
saasRouter.get("/tenants", listTenants);
saasRouter.get("/tenants/:id", getTenantDetails);
saasRouter.patch("/tenants/:id/subscription", updateTenantSubscription);
saasRouter.patch("/tenants/:id/suspend", patchSuspendTenant);
saasRouter.patch("/tenants/:id/unsuspend", patchUnsuspendTenant);
saasRouter.post("/tenants/:id/setup-link", postGenerateSetupLink);
saasRouter.get("/tenants/:id/metrics", getTenantMetrics);
saasRouter.post("/tenants/:id/support-tickets", postCreateSupportTicket);
saasRouter.get("/tenants/:id/export", getExportTenant);

export default saasRouter;
