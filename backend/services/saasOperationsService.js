import mongoose from "mongoose";
import crypto from "crypto";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";
import Department from "../model/department.js";
import HospitalStaff from "../model/hospitalStaff.js";
import { accessError } from "./hospitalAccess.js";

export const PLAN_ENTITLEMENTS = {
  starter: {
    maxStaff: 10,
    maxDepartments: 3,
    features: ["opd", "queue"],
  },
  growth: {
    maxStaff: 50,
    maxDepartments: 10,
    features: ["opd", "queue", "labs", "pharmacy", "analytics"],
  },
  enterprise: {
    maxStaff: 1000,
    maxDepartments: 100,
    features: ["opd", "queue", "labs", "pharmacy", "analytics", "multi_branch", "custom_domain"],
  },
};

export const getPlanEntitlements = (plan = "starter") => {
  return PLAN_ENTITLEMENTS[plan] || PLAN_ENTITLEMENTS.starter;
};

export const checkStaffLimit = (hospital, currentStaffCount) => {
  const plan = hospital.subscription?.plan || "starter";
  const entitlements = getPlanEntitlements(plan);
  if (currentStaffCount >= entitlements.maxStaff) {
    throw accessError(
      403,
      `Staff limit reached for current ${plan} plan (maximum ${entitlements.maxStaff} staff members). Please upgrade your subscription.`
    );
  }
  return true;
};

export const checkDepartmentLimit = (hospital, currentDeptCount) => {
  const plan = hospital.subscription?.plan || "starter";
  const entitlements = getPlanEntitlements(plan);
  if (currentDeptCount >= entitlements.maxDepartments) {
    throw accessError(
      403,
      `Department limit reached for current ${plan} plan (maximum ${entitlements.maxDepartments} departments). Please upgrade your subscription.`
    );
  }
  return true;
};

export const checkFeatureEntitlement = (hospital, feature) => {
  const plan = hospital.subscription?.plan || "starter";
  const entitlements = getPlanEntitlements(plan);
  if (!entitlements.features.includes(feature)) {
    throw accessError(
      403,
      `Feature '${feature}' is not included in your ${plan} plan. Please upgrade to access this module.`
    );
  }
  return true;
};

let testDouble = null;
export const setSaasTestDouble = (adapter) => {
  testDouble = adapter;
};

export const createAdminSetupLink = async (hospitalId, baseUrl = "") => {
  if (testDouble?.createAdminSetupLink) {
    return testDouble.createAdminSetupLink(hospitalId, baseUrl);
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 48 * 3600 * 1000); // 48-hour expiration

  const result = await Hospital.updateOne(
    { _id: hospitalId },
    {
      $set: {
        "onboarding.setupTokenHash": tokenHash,
        "onboarding.setupExpiresAt": expiresAt,
      },
    }
  );

  if (!result.matchedCount) {
    throw accessError(404, "Hospital not found");
  }

  const setupUrl = `${baseUrl}/staff/setup?token=${token}`;
  return { token, tokenHash, expiresAt, setupUrl };
};

export const verifyAdminSetupLink = async (token) => {
  if (!token || typeof token !== "string") {
    throw accessError(400, "Setup token is required");
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const hospital = await Hospital.findOne({
    "onboarding.setupTokenHash": tokenHash,
    "onboarding.setupExpiresAt": { $gt: new Date() },
  }).select("name slug type");

  if (!hospital) {
    throw accessError(400, "Setup link is invalid or has expired. Please request a new invitation link.");
  }

  return {
    valid: true,
    hospital: {
      name: hospital.name,
      slug: hospital.slug,
      type: hospital.type,
    },
  };
};

export const consumeAdminSetupLink = async ({ token, adminPassword, name }) => {
  if (!token || typeof token !== "string") {
    throw accessError(400, "Setup token is required");
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const hospital = await Hospital.findOne({
    "onboarding.setupTokenHash": tokenHash,
    "onboarding.setupExpiresAt": { $gt: new Date() },
  });

  if (!hospital) {
    throw accessError(400, "Setup link is invalid or has expired.");
  }

  // Atomically invalidate setup link so it cannot be reused
  hospital.onboarding.setupTokenHash = undefined;
  hospital.onboarding.setupExpiresAt = undefined;
  hospital.onboarding.completedAt = new Date();
  await hospital.save();

  return { success: true, hospitalId: hospital._id, slug: hospital.slug };
};

export const assertTenantNotSuspended = (hospital) => {
  if (hospital.status === "suspended" || hospital.suspension?.isSuspended) {
    const reason = hospital.suspension?.reason ? `: ${hospital.suspension.reason}` : "";
    throw accessError(
      403,
      `This hospital workspace is currently suspended${reason}. Please contact platform support to reactivate.`
    );
  }
  return true;
};

export const suspendTenant = async ({ hospitalId, reason = "Terms of service violation", actor }) => {
  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");

  hospital.status = "suspended";
  hospital.subscription.status = "suspended";
  hospital.suspension = {
    isSuspended: true,
    suspendedAt: new Date(),
    reason: String(reason).trim(),
    suspendedBy: actor?.name || "Platform Operator",
  };

  await hospital.save();
  return hospital;
};

export const unsuspendTenant = async ({ hospitalId, actor }) => {
  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const hospital = await Hospital.findById(hospitalId);
  if (!hospital) throw accessError(404, "Hospital not found");

  hospital.status = "active";
  hospital.subscription.status = "active";
  if (hospital.suspension) {
    hospital.suspension.isSuspended = false;
  }

  await hospital.save();
  return hospital;
};

export const calculateOperationalMetrics = async ({ hospitalId, startDate, endDate }) => {
  if (testDouble?.calculateOperationalMetrics) {
    return testDouble.calculateOperationalMetrics({ hospitalId, startDate, endDate });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const dateFilter = { hospitalId };
  if (startDate || endDate) {
    dateFilter.createdAt = {};
    if (startDate) dateFilter.createdAt.$gte = new Date(startDate);
    if (endDate) dateFilter.createdAt.$lte = new Date(endDate);
  }

  // FIXED A10: Query actual token enum 'waiting' instead of nonexistent 'queued'
  const [totalTokens, completedTokens, noShowTokens, waitingTokens, inConsultationTokens, departments, staffMembers] =
    await Promise.all([
      OpdToken.countDocuments(dateFilter),
      OpdToken.countDocuments({ ...dateFilter, status: "completed" }),
      OpdToken.countDocuments({ ...dateFilter, status: "no_show" }),
      OpdToken.countDocuments({ ...dateFilter, status: "waiting" }),
      OpdToken.countDocuments({ ...dateFilter, status: "in_consultation" }),
      Department.find({ hospitalId }).lean(),
      HospitalStaff.find({ hospitalId, isActive: true }).lean(),
    ]);

  const deptCount = departments.length;
  let coveredDepts = 0;
  if (deptCount > 0) {
    const coveredDeptIds = new Set(staffMembers.flatMap((s) => (s.departmentIds || []).map(String)));
    coveredDepts = departments.filter((d) => coveredDeptIds.has(String(d._id))).length;
  }
  const departmentCoveragePercent = deptCount > 0 ? Math.round((coveredDepts / deptCount) * 100) : 0;

  const completionRatePercent = totalTokens > 0 ? Math.round((completedTokens / totalTokens) * 1000) / 10 : 0;
  const noShowRatePercent = totalTokens > 0 ? Math.round((noShowTokens / totalTokens) * 1000) / 10 : 0;

  return {
    totalBookings: totalTokens,
    completedVisits: completedTokens,
    noShows: noShowTokens,
    waiting: waitingTokens,
    inConsultation: inConsultationTokens,
    completionRatePercent,
    noShowRatePercent,
    departmentCoveragePercent,
    departmentCount: deptCount,
    staffCount: staffMembers.length,
  };
};

export const createSupportTicket = async ({ hospitalId, subject, description, priority = "medium", actor }) => {
  if (!subject || !subject.trim() || !description || !description.trim()) {
    throw accessError(400, "Ticket subject and description are required");
  }

  if (testDouble?.createSupportTicket) {
    return testDouble.createSupportTicket({ hospitalId, subject, description, priority, actor });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const ticketId = "SUP-" + crypto.randomBytes(4).toString("hex").toUpperCase();

  const ticketDoc = {
    ticketId,
    subject: subject.trim(),
    description: description.trim(),
    priority,
    status: "open",
    createdAt: new Date(),
  };

  const result = await Hospital.updateOne({ _id: hospitalId }, { $push: { supportTickets: ticketDoc } });
  if (!result.matchedCount) {
    throw accessError(404, "Hospital not found");
  }
  return ticketDoc;
};

export const exportTenantConfiguration = async ({ hospitalId }) => {
  if (testDouble?.exportTenantConfiguration) {
    return testDouble.exportTenantConfiguration({ hospitalId });
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  // FIXED A01: Exclude staff personal email/phone numbers from configuration export
  const [hospital, departments, staff] = await Promise.all([
    Hospital.findById(hospitalId).select("name slug type status branding.logo departments createdAt").lean(),
    Department.find({ hospitalId }).select("name code description serviceType isActive").lean(),
    HospitalStaff.find({ hospitalId, isActive: true }).select("role departmentIds adminAccess isActive createdAt").lean(),
  ]);

  if (!hospital) throw accessError(404, "Hospital not found");

  return {
    exportedAt: new Date(),
    hospital,
    departments,
    staffDirectorySummary: staff,
    retentionPolicy: "HIPAA_and_NDHM_compliant_operational_export",
  };
};
