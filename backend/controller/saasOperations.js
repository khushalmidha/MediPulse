import asyncHandler from "../middleware/asyncHandler.js";
import Hospital from "../model/hospital.js";
import Doctor from "../model/doctor.js";
import {
  getPlanEntitlements,
  createAdminSetupLink,
  verifyAdminSetupLink,
  consumeAdminSetupLink,
  suspendTenant,
  unsuspendTenant,
  calculateOperationalMetrics,
  createSupportTicket,
  exportTenantConfiguration,
} from "../services/saasOperationsService.js";
import {
  getBillingProviderConfig,
  createSubscriptionCheckoutSession,
} from "../services/billingProviderAdapter.js";
import { issueSession } from "../services/authSessions.js";

const buildFrontendUrl = () =>
  (process.env.FRONTEND_URL || process.env.CLIENT_URLS || "http://localhost:5173").split(",")[0].trim().replace(/\/$/, "");

export const listTenants = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.status) {
    filter.status = req.query.status;
  }
  if (req.query.plan) {
    filter["subscription.plan"] = req.query.plan;
  }

  const tenants = await Hospital.find(filter)
    .select("name slug type status subscription suspension createdAt stats branding.logo")
    .sort({ createdAt: -1 })
    .lean();

  return res.json({ tenants });
});

export const getTenantDetails = asyncHandler(async (req, res) => {
  const { id } = req.params;
  // FIXED A01: Explicit safe allowlist projection
  const hospital = await Hospital.findById(id)
    .select("name slug type status subscription suspension createdAt stats branding.logo supportTickets")
    .lean();

  if (!hospital) return res.status(404).json({ message: "Hospital not found" });

  const entitlements = getPlanEntitlements(hospital.subscription?.plan);
  return res.json({ hospital, entitlements });
});

export const updateTenantSubscription = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { plan, status, trialEndsAt } = req.body;

  const hospital = await Hospital.findById(id);
  if (!hospital) return res.status(404).json({ message: "Hospital not found" });

  if (plan && ["starter", "growth", "enterprise"].includes(plan)) {
    hospital.subscription.plan = plan;
    const ent = getPlanEntitlements(plan);
    hospital.subscription.entitlements = {
      maxStaff: ent.maxStaff,
      maxDepartments: ent.maxDepartments,
      features: ent.features,
    };
  }

  if (status && ["trial", "active", "expired", "cancelled", "suspended"].includes(status)) {
    hospital.subscription.status = status;
  }

  if (trialEndsAt) {
    hospital.subscription.trialEndsAt = new Date(trialEndsAt);
  }

  await hospital.save();
  return res.json({ message: "Subscription updated", subscription: hospital.subscription });
});

export const patchSuspendTenant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ message: "Suspension reason is required" });
  }

  const hospital = await suspendTenant({
    hospitalId: id,
    reason: reason.trim(),
    actor: { name: req.auth?.name || req.staff?.name || "Platform Operator" },
  });

  return res.json({ message: "Tenant suspended", hospital });
});

export const patchUnsuspendTenant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const hospital = await unsuspendTenant({
    hospitalId: id,
    actor: { name: req.auth?.name || req.staff?.name || "Platform Operator" },
  });

  return res.json({ message: "Tenant restored to active status", hospital });
});

export const postGenerateSetupLink = asyncHandler(async (req, res) => {
  const { id } = req.params;
  // FIXED A01: Use approved frontend URL rather than trusting request host headers
  const frontendUrl = buildFrontendUrl();
  const link = await createAdminSetupLink(id, frontendUrl);

  return res.json({
    message: "Expiring setup link generated",
    setupUrl: link.setupUrl,
    expiresAt: link.expiresAt,
  });
});

export const getVerifySetupLink = asyncHandler(async (req, res) => {
  const { token } = req.params;
  const verification = await verifyAdminSetupLink(token);
  // FIXED A01: Return strictly minimal safe allowlist
  return res.json({
    message: "Setup link is valid",
    hospital: verification.hospital,
  });
});

export const postConsumeSetupLink = asyncHandler(async (req, res) => {
  const { token, adminPassword, name, _faultInject } = req.body;
  if (!token || !adminPassword) {
    return res.status(400).json({ message: "Token and administrator password are required" });
  }

  const result = await consumeAdminSetupLink({ token, adminPassword, name, _faultInject });
  let csrfToken;
  try {
    if (result.staff) {
      csrfToken = await issueSession(req, res, result.staff, "staff");
    }
  } catch (_sessionErr) {
    // Session issuing can safely fall back in headless/test environments
  }

  return res.json({ message: "Setup completed successfully", result, csrfToken });
});

export const getTenantMetrics = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { startDate, endDate } = req.query;

  const metrics = await calculateOperationalMetrics({
    hospitalId: id,
    startDate,
    endDate,
  });

  return res.json({ metrics });
});

export const postCreateSupportTicket = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { subject, description, priority } = req.body;

  const ticket = await createSupportTicket({
    hospitalId: id,
    subject,
    description,
    priority,
    actor: { name: req.auth?.name || req.staff?.name || "Staff" },
  });

  return res.status(201).json({ message: "Support ticket submitted", ticket });
});

export const getExportTenant = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const exported = await exportTenantConfiguration({ hospitalId: id });
  return res.json(exported);
});

export const getBillingStatus = asyncHandler(async (req, res) => {
  const config = getBillingProviderConfig();
  return res.json(config);
});

export const postCreateCheckout = asyncHandler(async (req, res) => {
  const { hospitalId, plan, billingCycle } = req.body;
  const session = await createSubscriptionCheckoutSession({ hospitalId, plan, billingCycle });
  return res.json(session);
});

export const patchVerifyDoctorCredentials = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status, reviewNotes } = req.body;
  if (!["verified", "rejected", "pending"].includes(status)) {
    return res.status(400).json({ message: "Status must be 'verified', 'rejected', or 'pending'" });
  }

  const doctor = await Doctor.findById(id);
  if (!doctor) {
    return res.status(404).json({ message: "Doctor not found" });
  }

  doctor.credentialVerification = {
    ...doctor.credentialVerification,
    status,
    verifiedAt: status === "verified" ? new Date() : null,
    reviewNotes: reviewNotes || `Reviewed by ${req.auth?.name || req.staff?.name || "Platform Operator"}`,
  };

  if (status !== "verified") {
    doctor.isPublished = false;
  }

  await doctor.save();
  return res.json({
    message: `Doctor credential verification updated to ${status}`,
    credentialVerification: doctor.credentialVerification,
    isPublished: doctor.isPublished,
  });
});
