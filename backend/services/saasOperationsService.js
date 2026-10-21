import mongoose from "mongoose";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";
import Department from "../model/department.js";
import HospitalStaff from "../model/hospitalStaff.js";
import HospitalLocation from "../model/hospitalLocation.js";
import { CareSession } from "../model/scheduling.js";
import { accessError } from "./hospitalAccess.js";
import { moneyTransaction } from "./moneyTransaction.js";
import { invalidatePublicHospitalCache } from "./publicHospitalCache.js";

const cleanString = (val) => String(val || "").trim();

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

export const addDepartmentWithQuota = async (hospitalId, departmentPayload) => {
  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }
  return await moneyTransaction(async (session) => {
    const hospital = await Hospital.findById(hospitalId).session(session);
    if (!hospital) throw accessError(404, "Hospital not found");
    assertTenantNotSuspended(hospital);

    const currentDeptCount = await Department.countDocuments({ hospitalId }).session(session);
    checkDepartmentLimit(hospital, currentDeptCount);

    const [department] = await Department.create(
      [
        {
          hospitalId,
          name: cleanString(departmentPayload.name),
          code: cleanString(departmentPayload.code),
          description: cleanString(departmentPayload.description),
          headDoctorId: departmentPayload.headDoctorId,
          icon: cleanString(departmentPayload.icon),
          color: cleanString(departmentPayload.color),
          opd: {
            consultationFee: departmentPayload.opd?.consultationFee ?? 500,
            ...(departmentPayload.opd || {}),
          },
          status: departmentPayload.status || "active",
        },
      ],
      { session }
    );

    // Atomically increment stats on Hospital document to serialize concurrent quota additions
    await Hospital.updateOne(
      { _id: hospitalId },
      { $inc: { "stats.totalDepartments": 1 } },
      { session }
    );

    return { hospital, department };
  });
};

export const inviteStaffWithQuota = async (hospitalId, staffPayload, actorStaff) => {
  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }
  return await moneyTransaction(async (session) => {
    const hospital = await Hospital.findById(hospitalId).session(session);
    if (!hospital) throw accessError(404, "Hospital not found");
    assertTenantNotSuspended(hospital);

    const currentStaffCount = await HospitalStaff.countDocuments({ hospitalId, isActive: true }).session(session);
    checkStaffLimit(hospital, currentStaffCount);

    const rawToken = crypto.randomBytes(32).toString("hex");
    const role = staffPayload.role;
    const email = cleanString(staffPayload.email).toLowerCase();
    const name = cleanString(staffPayload.name) || email.split("@")[0];

    const [staff] = await HospitalStaff.create(
      [
        {
          hospitalId,
          departmentIds: staffPayload.departmentIds || [],
          name,
          email,
          profilePhoto: cleanString(staffPayload.profilePhoto),
          role,
          doctorProfile: role === "DOCTOR" ? staffPayload.doctorProfile : undefined,
          inviteToken: crypto.createHash("sha256").update(rawToken).digest("hex"),
          inviteExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          invitedBy: actorStaff?.id || actorStaff?._id,
          inviteStatus: "pending",
        },
      ],
      { session }
    );

    // Atomically increment stats on Hospital document to serialize concurrent quota additions
    await Hospital.updateOne(
      { _id: hospitalId },
      { $inc: { "stats.totalDoctors": role === "DOCTOR" ? 1 : 0 } },
      { session }
    );

    return { hospital, staff, rawToken };
  });
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
  if (testDouble?.verifyAdminSetupLink) {
    return testDouble.verifyAdminSetupLink(token);
  }

  if (!token || typeof token !== "string") {
    throw accessError(400, "Setup token is required");
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const hospital = await Hospital.findOne({
    "onboarding.setupTokenHash": tokenHash,
  }).select("name slug type email onboarding.setupExpiresAt");

  if (!hospital) {
    throw accessError(400, "Setup link is invalid or has already been used. Please request a new invitation link.");
  }

  if (hospital.onboarding?.setupExpiresAt && hospital.onboarding.setupExpiresAt <= new Date()) {
    throw accessError(410, "Setup link has expired. Please request a new invitation link.");
  }

  return {
    valid: true,
    hospital: {
      name: hospital.name,
      slug: hospital.slug,
      type: hospital.type,
      email: hospital.email,
    },
  };
};

export const consumeAdminSetupLink = async ({ token, adminPassword, name, _faultInject = null }) => {
  if (testDouble?.consumeAdminSetupLink) {
    return testDouble.consumeAdminSetupLink({ token, adminPassword, name, _faultInject });
  }

  if (!token || typeof token !== "string") {
    throw accessError(400, "Setup token is required");
  }

  if (!adminPassword || String(adminPassword).length < 8) {
    throw accessError(400, "Password must be at least 8 characters long");
  }

  if (mongoose.connection?.readyState !== 1) {
    throw accessError(503, "Database service is unavailable. Please try again shortly.");
  }

  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

  const pendingHospital = await Hospital.findOne({
    "onboarding.setupTokenHash": tokenHash,
  });

  if (!pendingHospital) {
    throw accessError(400, "Setup link is invalid or has already been used.");
  }

  if (pendingHospital.onboarding?.setupExpiresAt && pendingHospital.onboarding.setupExpiresAt <= new Date()) {
    throw accessError(410, "Setup link has expired. Please request a new setup link.");
  }

  const result = await moneyTransaction(async (session) => {
    // Atomically find and consume token
    const hospital = await Hospital.findOneAndUpdate(
      {
        _id: pendingHospital._id,
        "onboarding.setupTokenHash": tokenHash,
        "onboarding.setupExpiresAt": { $gt: new Date() },
      },
      {
        $unset: {
          "onboarding.setupTokenHash": 1,
          "onboarding.setupExpiresAt": 1,
        },
        $set: {
          "onboarding.completedAt": new Date(),
          ...(["pending", "pending_verification"].includes(pendingHospital.status) ? { status: "active" } : {}),
        },
      },
      { session, new: true }
    );

    if (!hospital) {
      throw accessError(409, "Setup link was already consumed or has expired.");
    }

    if (_faultInject === "beforeStaffSave") {
      throw new Error("Injected transaction fault before staff save");
    }

    let staff = await HospitalStaff.findOne({
      hospitalId: hospital._id,
      role: "HOSPITAL_ADMIN",
    }).session(session);

    const adminName = cleanString(name) || staff?.name || hospital.name;

    if (staff) {
      staff.password = String(adminPassword);
      staff.name = adminName;
      staff.inviteStatus = "accepted";
      staff.joinedAt = staff.joinedAt || new Date();
      await staff.save({ session });
    } else {
      staff = new HospitalStaff({
        hospitalId: hospital._id,
        name: adminName,
        email: hospital.email,
        phone: hospital.phone,
        role: "HOSPITAL_ADMIN",
        password: String(adminPassword),
        inviteStatus: "accepted",
        joinedAt: new Date(),
        authVersion: 1,
      });
      await staff.save({ session });
    }

    if (_faultInject === "afterStaffSave") {
      throw new Error("Injected transaction fault after staff save");
    }

    return { hospital, staff };
  });

  await invalidatePublicHospitalCache(result.hospital).catch(() => {});

  return {
    success: true,
    hospitalId: result.hospital._id,
    slug: result.hospital.slug,
    staff: {
      _id: result.staff._id,
      name: result.staff.name,
      email: result.staff.email,
      role: result.staff.role,
    },
  };
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

  // Query actual records for operational metrics and setup activation checklist
  const [
    totalTokens,
    completedTokens,
    noShowTokens,
    waitingTokens,
    inConsultationTokens,
    departments,
    staffMembers,
    locationsCount,
    careSessionsCount,
  ] = await Promise.all([
    OpdToken.countDocuments(dateFilter),
    OpdToken.countDocuments({ ...dateFilter, status: "completed" }),
    OpdToken.countDocuments({ ...dateFilter, status: "no_show" }),
    OpdToken.countDocuments({ ...dateFilter, status: "waiting" }),
    OpdToken.countDocuments({ ...dateFilter, status: "in_consultation" }),
    Department.find({ hospitalId }).lean(),
    HospitalStaff.find({ hospitalId, isActive: true }).lean(),
    HospitalLocation.countDocuments({ hospitalId }),
    CareSession.countDocuments({ hospitalId }),
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

  const acceptedStaffCount = staffMembers.filter((s) => s.inviteStatus === "accepted").length;
  const hasDepartments = deptCount > 0;
  const hasAcceptedStaff = acceptedStaffCount > 0;
  const hasRooms = locationsCount > 0;
  const hasPublishedAvailability = careSessionsCount > 0;
  const hasFirstBooking = totalTokens > 0;

  const completedSteps = [hasDepartments, hasAcceptedStaff, hasRooms, hasPublishedAvailability, hasFirstBooking].filter(Boolean).length;
  const staffSetupCompletionPercent = Math.round((completedSteps / 5) * 100);

  const activationChecklist = {
    departments: { completed: hasDepartments, count: deptCount, label: "Configure Departments" },
    staff: { completed: hasAcceptedStaff, count: acceptedStaffCount, totalInvited: staffMembers.length, label: "Invite & Accept Staff" },
    rooms: { completed: hasRooms, count: locationsCount, label: "Configure Consultation Rooms" },
    availability: { completed: hasPublishedAvailability, count: careSessionsCount, label: "Publish Doctor Availability" },
    firstBooking: { completed: hasFirstBooking, count: totalTokens, label: "Accept First Patient Booking" },
    completedSteps,
    totalSteps: 5,
    percentComplete: staffSetupCompletionPercent,
    isFullyActivated: completedSteps === 5,
  };

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
    locationsCount,
    careSessionsCount,
    staffSetupCompletionPercent,
    activationChecklist,
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
