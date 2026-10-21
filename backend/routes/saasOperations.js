import { Router } from "express";
import {
  listTenants,
  getTenantDetails,
  updateTenantSubscription,
  patchSuspendTenant,
  patchUnsuspendTenant,
  postGenerateSetupLink,
  getVerifySetupLink,
  postConsumeSetupLink,
  getTenantMetrics,
  postCreateSupportTicket,
  getExportTenant,
  getBillingStatus,
  postCreateCheckout,
  patchVerifyDoctorCredentials,
} from "../controller/saasOperations.js";
import { nosqlGuard } from "../middleware/nosqlGuard.js";
import {
  requirePlatformOperator,
  requireTenantAdminOrPlatformOperator,
} from "../middleware/saasAuth.js";

const saasRouter = Router();
saasRouter.use(nosqlGuard);

// Public verification and consumption for single-use setup links
saasRouter.get("/setup-link/verify/:token", getVerifySetupLink);
saasRouter.post("/setup-link/consume", postConsumeSetupLink);

// Billing provider interface (requires platform operator or tenant admin)
saasRouter.get("/billing/status", requirePlatformOperator, getBillingStatus);
saasRouter.post("/billing/checkout", requireTenantAdminOrPlatformOperator, postCreateCheckout);

// Global Tenants management (requires Platform Operator)
saasRouter.get("/tenants", requirePlatformOperator, listTenants);
saasRouter.patch("/tenants/:id/subscription", requirePlatformOperator, updateTenantSubscription);
saasRouter.patch("/tenants/:id/suspend", requirePlatformOperator, patchSuspendTenant);
saasRouter.patch("/tenants/:id/unsuspend", requirePlatformOperator, patchUnsuspendTenant);
saasRouter.post("/tenants/:id/setup-link", requirePlatformOperator, postGenerateSetupLink);

// Doctor credential verification (requires Platform Operator)
saasRouter.patch("/doctors/:id/verify-credentials", requirePlatformOperator, patchVerifyDoctorCredentials);

// Tenant-local operations (requires Tenant Admin of this exact hospital OR Platform Operator)
saasRouter.get("/tenants/:id", requireTenantAdminOrPlatformOperator, getTenantDetails);
saasRouter.get("/tenants/:id/metrics", requireTenantAdminOrPlatformOperator, getTenantMetrics);
saasRouter.post("/tenants/:id/support-tickets", requireTenantAdminOrPlatformOperator, postCreateSupportTicket);
saasRouter.get("/tenants/:id/export", requireTenantAdminOrPlatformOperator, getExportTenant);

export default saasRouter;
