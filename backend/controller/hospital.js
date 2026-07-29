import crypto from "crypto";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import Hospital from "../model/hospital.js";
import Department from "../model/department.js";
import HospitalStaff from "../model/hospitalStaff.js";
import OpdToken from "../model/opdToken.js";
import Review from "../model/review.js";
import { getRedis } from "../services/redis.js";
import {
  sendHospitalAdminAlertMail,
  sendHospitalWelcomeMail,
  sendStaffInviteMail,
} from "../util/mailer.js";

const hashValue = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const signHospitalAction = ({ hospitalId, action }) =>
  crypto
    .createHmac("sha256", process.env.HOSPITAL_APPROVAL_SECRET || process.env.TOKEN_KEY || "medipulse-hospital-approval")
    .update(`${hospitalId}:${action}`)
    .digest("base64url");

const publicHospitalCacheKey = (slug) => `hospital:public:${slug}`;
const hospitalSearchCacheKey = (query) => `hospitals:search:${hashValue(JSON.stringify(query))}`;
const hospitalQueueCacheKey = (hospitalId) => `hospital:queue-status:${hospitalId}`;
const hospitalAnalyticsCacheKey = (hospitalId, date = new Date()) =>
  `hospital:analytics:${hospitalId}:${date.toISOString().slice(0, 10)}`;

const cleanString = (value) => String(value || "").trim();

const staffCookieOptions = () => {
  const isProduction = process.env.NODE_ENV === "production";
  return {
    httpOnly: false,
    path: "/",
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
  };
};

const setStaffCookies = (res, staff) => {
  const token = jwt.sign(
    {
      id: staff._id.toString(),
      role: staff.role,
      hospitalId: staff.hospitalId.toString(),
      type: "staff",
    },
    process.env.TOKEN_KEY,
    { expiresIn: 60 * 60 * 24 * 3 },
  );

  res.cookie("staffToken", token, staffCookieOptions());
  res.cookie("staffId", staff._id.toString(), staffCookieOptions());
};

const slugify = (value) =>
  cleanString(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54);

const generateHospitalSlug = async (name) => {
  const base = slugify(name) || "hospital";
  let suffix = 1;
  let candidate = `${base}-${String(suffix).padStart(3, "0")}`;

  while (await Hospital.exists({ slug: candidate })) {
    suffix += 1;
    candidate = `${base}-${String(suffix).padStart(3, "0")}`;
  }

  return candidate;
};

const isHospitalAdmin = (req, hospitalId) =>
  req.staff?.hospitalId === hospitalId && req.staff?.role === "HOSPITAL_ADMIN";

const requireHospitalAdminAccess = (req, res, hospitalId) => {
  if (!isHospitalAdmin(req, hospitalId)) {
    res.status(403).json({ message: "Hospital admin access is required" });
    return false;
  }

  return true;
};

const isPlatformAdmin = (req) =>
  (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .includes(req.auth?.id);

const requirePlatformAdmin = (req, res, next) => {
  if (!isPlatformAdmin(req)) {
    return res.status(403).json({ message: "Platform admin access is required" });
  }

  return next();
};

const parsePagination = (req) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(50, Math.max(1, Number(req.query.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
};

const cacheJson = async (key, ttlSeconds, loader) => {
  const redis = getRedis();
  const cached = await redis.get(key);
  if (cached) {
    return JSON.parse(cached);
  }

  const value = await loader();
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  return value;
};

const invalidateHospitalCache = async (hospital) => {
  const redis = getRedis();
  // Cache invalidation: public profile, realtime queue, and analytics may include updated hospital data.
  await redis.del(
    publicHospitalCacheKey(hospital.slug),
    hospitalQueueCacheKey(hospital._id.toString()),
    hospitalAnalyticsCacheKey(hospital._id.toString()),
  );
};

const getHospitals = async (req, res) => {
  const querySnapshot = {
    city: req.query.city || "",
    specialty: req.query.specialty || "",
    name: req.query.name || "",
    rating_min: req.query.rating_min || "",
    plan: req.query.plan || "",
    page: req.query.page || "1",
    limit: req.query.limit || "20",
  };

  const result = await cacheJson(hospitalSearchCacheKey(querySnapshot), 300, async () => {
    const { limit, skip } = parsePagination(req);
    const filter = { status: "active" };

    if (querySnapshot.city) {
      filter["address.city"] = new RegExp(cleanString(querySnapshot.city), "i");
    }
    if (querySnapshot.name) {
      filter.name = new RegExp(cleanString(querySnapshot.name), "i");
    }
    if (querySnapshot.specialty) {
      filter["branding.specializations"] = new RegExp(cleanString(querySnapshot.specialty), "i");
    }
    if (querySnapshot.plan) {
      filter["subscription.plan"] = cleanString(querySnapshot.plan);
    }
    if (querySnapshot.rating_min) {
      filter["stats.avgRating"] = { $gte: Number(querySnapshot.rating_min) || 0 };
    }

    const [items, total] = await Promise.all([
      Hospital.find(filter)
        .select("name slug address stats branding.logo branding.tagline subscription.plan")
        .sort({ "stats.avgRating": -1, name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Hospital.countDocuments(filter),
    ]);

    return { items, total, page: Number(querySnapshot.page) || 1, limit };
  });

  return res.status(200).json(result);
};

const getHospitalProfile = async (req, res) => {
  const { slug } = req.params;
  const result = await cacheJson(publicHospitalCacheKey(slug), 120, async () => {
    const hospital = await Hospital.findOne({
      $or: [{ slug }, { "websiteConfig.customDomain": slug }],
      status: "active",
    }).lean();

    if (!hospital) return null;

    const [departments, doctors] = await Promise.all([
      Department.find({ hospitalId: hospital._id, status: "active" }).lean(),
      HospitalStaff.find({
        hospitalId: hospital._id,
        role: "DOCTOR",
        isActive: true,
        inviteStatus: "accepted",
      })
        .select("name email profilePhoto departmentIds doctorProfile")
        .lean(),
    ]);

    return { hospital, departments, doctors };
  });

  if (!result) {
    return res.status(404).json({ message: "Hospital not found" });
  }

  return res.status(200).json(result);
};

const getHospitalDoctors = async (req, res) => {
  const hospital = await Hospital.findOne({ slug: req.params.slug, status: "active" });
  if (!hospital) {
    return res.status(404).json({ message: "Hospital not found" });
  }

  const filter = {
    hospitalId: hospital._id,
    role: "DOCTOR",
    isActive: true,
    inviteStatus: "accepted",
  };

  if (req.query.departmentId && mongoose.Types.ObjectId.isValid(req.query.departmentId)) {
    filter.departmentIds = req.query.departmentId;
  }

  const doctors = await HospitalStaff.find(filter)
    .select("name email phone profilePhoto departmentIds doctorProfile")
    .lean();

  return res.status(200).json({ doctors });
};

const getHospitalQueueStatus = async (req, res) => {
  const hospital = await Hospital.findOne({ slug: req.params.slug, status: "active" });
  if (!hospital) {
    return res.status(404).json({ message: "Hospital not found" });
  }

  const result = await cacheJson(hospitalQueueCacheKey(hospital._id.toString()), 30, async () => {
    const departments = await Department.find({ hospitalId: hospital._id, status: "active" }).lean();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayEnd = new Date(todayStart);
    todayEnd.setDate(todayEnd.getDate() + 1);

    const departmentStatuses = await Promise.all(
      departments.map(async (department) => {
        const tokens = await OpdToken.find({
          hospitalId: hospital._id,
          departmentId: department._id,
          date: { $gte: todayStart, $lt: todayEnd },
        }).lean();

        const active = tokens.find((token) => token.status === "in_consultation");
        const waiting = tokens.filter((token) => ["waiting", "vitals_done"].includes(token.status));
        const estimatedWait = waiting.reduce((max, token) => Math.max(max, token.estimatedWaitMinutes || 0), 0);

        return {
          id: department._id,
          name: department.name,
          todayTokensIssued: tokens.length,
          currentToken: active?.displayToken || null,
          estimatedWait,
          isActive: department.opd?.isActive !== false,
        };
      }),
    );

    return { departments: departmentStatuses };
  });

  return res.status(200).json(result);
};

const registerHospital = async (req, res) => {
  const { name, email, phone, address = {}, type, registrationNumber, adminName, adminPassword } = req.body;

  if (!name || !email || !address.city || !address.state || !type || !registrationNumber) {
    return res.status(400).json({
      message: "Name, email, city, state, type and registration number are required",
    });
  }

  if (!adminName || !adminPassword || String(adminPassword).length < 8) {
    return res.status(400).json({
      message: "Hospital admin name and an 8+ character password are required",
    });
  }

  const existing = await Hospital.findOne({ email: cleanString(email).toLowerCase() });
  if (existing) {
    return res.status(409).json({ message: "Hospital email is already registered" });
  }

  const slug = await generateHospitalSlug(name);
  const hospital = await Hospital.create({
    name: cleanString(name),
    slug,
    email: cleanString(email).toLowerCase(),
    phone,
    address,
    type,
    registrationNumber: cleanString(registrationNumber),
    subscription: {
      plan: "starter",
      status: "trial",
      trialEndsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    },
  });

  const admin = await HospitalStaff.create({
    hospitalId: hospital._id,
    name: cleanString(adminName),
    email: cleanString(email).toLowerCase(),
    phone,
    role: "HOSPITAL_ADMIN",
    userId: req.auth?.role === "user" ? req.auth.id : undefined,
    password: adminPassword,
    inviteStatus: "accepted",
    joinedAt: new Date(),
  });

  await Hospital.findByIdAndUpdate(hospital._id, { "stats.totalDepartments": 0 });

  const publicBackendUrl = (process.env.PUBLIC_BACKEND_URL || `http://localhost:${process.env.PORT || 8080}`).replace(/\/$/, "");
  const approveUrl = `${publicBackendUrl}/api/hospitals/admin/${hospital._id}/action?action=approve&token=${signHospitalAction({
    hospitalId: hospital._id,
    action: "approve",
  })}`;
  const rejectUrl = `${publicBackendUrl}/api/hospitals/admin/${hospital._id}/action?action=reject&token=${signHospitalAction({
    hospitalId: hospital._id,
    action: "reject",
  })}`;

  await Promise.allSettled([
    sendHospitalWelcomeMail({ to: hospital.email, hospitalName: hospital.name }),
    sendHospitalAdminAlertMail({
      to: (process.env.ADMIN_ALERT_EMAIL || process.env.SMTP_USER || "").trim(),
      hospitalName: hospital.name,
      email: hospital.email,
      city: hospital.address?.city,
      approveUrl,
      rejectUrl,
    }),
  ]);

  setStaffCookies(res, admin);

  return res.status(201).json({
    message: "Hospital registration submitted for verification",
    hospital,
    staff: {
      _id: admin._id,
      name: admin.name,
      email: admin.email,
      role: admin.role,
    },
  });
};

const updateHospitalProfile = async (req, res) => {
  const { id } = req.params;
  if (!requireHospitalAdminAccess(req, res, id)) return;

  const allowed = ["name", "phone", "website", "address", "branding", "websiteConfig", "settings"];
  const update = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) update[key] = req.body[key];
  }

  const hospital = await Hospital.findOneAndUpdate({ _id: id }, update, { new: true });
  if (!hospital) return res.status(404).json({ message: "Hospital not found" });

  await invalidateHospitalCache(hospital);
  return res.status(200).json({ message: "Hospital profile updated", hospital });
};

const addDepartment = async (req, res) => {
  const { id } = req.params;
  if (!requireHospitalAdminAccess(req, res, id)) return;

  const department = await Department.create({
    hospitalId: id,
    name: req.body.name,
    code: req.body.code,
    description: req.body.description,
    headDoctorId: req.body.headDoctorId,
    icon: req.body.icon,
    color: req.body.color,
    opd: req.body.opd,
    status: req.body.status || "active",
  });

  const hospital = await Hospital.findByIdAndUpdate(
    id,
    { $inc: { "stats.totalDepartments": 1 } },
    { new: true },
  );

  if (hospital) await invalidateHospitalCache(hospital);
  return res.status(201).json({ message: "Department added", department });
};

const updateDepartment = async (req, res) => {
  const { id, deptId } = req.params;
  if (!requireHospitalAdminAccess(req, res, id)) return;

  const department = await Department.findOneAndUpdate(
    { _id: deptId, hospitalId: id },
    req.body,
    { new: true },
  );

  if (!department) return res.status(404).json({ message: "Department not found" });
  const hospital = await Hospital.findById(id);
  if (hospital) await invalidateHospitalCache(hospital);
  return res.status(200).json({ message: "Department updated", department });
};

const inviteStaff = async (req, res) => {
  const { id } = req.params;
  if (!requireHospitalAdminAccess(req, res, id)) return;

  const { email, name, role, departmentIds = [], profilePhoto, doctorProfile = {} } = req.body;
  if (!email || !name || !role) {
    return res.status(400).json({ message: "Name, email and role are required" });
  }

  const hospital = await Hospital.findById(id);
  if (!hospital) return res.status(404).json({ message: "Hospital not found" });

  const rawToken = crypto.randomBytes(32).toString("hex");
  const staff = await HospitalStaff.create({
    hospitalId: id,
    departmentIds,
    name: cleanString(name),
    email: cleanString(email).toLowerCase(),
    profilePhoto: cleanString(profilePhoto),
    role,
    doctorProfile: role === "DOCTOR"
      ? {
          qualification: cleanString(doctorProfile.qualification),
          specialization: cleanString(doctorProfile.specialization),
          experience: Number(doctorProfile.experience || 0),
          consultationFee: Number(doctorProfile.consultationFee || 0),
          bio: cleanString(doctorProfile.bio),
        }
      : undefined,
    inviteToken: hashValue(rawToken),
    inviteExpiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
    invitedBy: req.staff.id,
    inviteStatus: "pending",
  });

  const frontendUrl = (process.env.FRONTEND_URL || process.env.CLIENT_URLS || "http://localhost:5173")
    .split(",")[0]
    .trim();
  const inviteUrl = `${frontendUrl}/staff/accept-invite?token=${rawToken}&hospital=${id}`;
  await sendStaffInviteMail({ to: staff.email, staffName: staff.name, hospitalName: hospital.name, inviteUrl });

  if (role === "DOCTOR") {
    await Hospital.findByIdAndUpdate(id, { $inc: { "stats.totalDoctors": 1 } });
  }

  await invalidateHospitalCache(hospital);
  return res.status(201).json({
    message: "Staff invite sent",
    staff: { _id: staff._id, name: staff.name, email: staff.email, role: staff.role, profilePhoto: staff.profilePhoto, inviteStatus: staff.inviteStatus },
  });
};

const acceptStaffInvite = async (req, res) => {
  const { id } = req.params;
  const { token } = req.query;
  if (!token) return res.status(400).json({ message: "Invite token is required" });

  const staff = await HospitalStaff.findOne({
    hospitalId: id,
    inviteToken: hashValue(token),
    inviteStatus: "pending",
    isActive: true,
  }).select("-password");

  if (!staff || (staff.inviteExpiresAt && staff.inviteExpiresAt <= new Date())) {
    return res.status(410).json({ message: "Invite is invalid or expired" });
  }

  return res.status(200).json({ message: "Invite is valid", staff });
};

const getStaff = async (req, res) => {
  const { id } = req.params;
  if (!requireHospitalAdminAccess(req, res, id)) return;
  const { page, limit, skip } = parsePagination(req);
  const filter = { hospitalId: id };
  if (req.query.role) filter.role = req.query.role;

  const [items, total] = await Promise.all([
    HospitalStaff.find(filter).select("-password -inviteToken").sort({ createdAt: -1 }).skip(skip).limit(limit),
    HospitalStaff.countDocuments(filter),
  ]);

  return res.status(200).json({ items, total, page, limit });
};

const getAnalytics = async (req, res) => {
  const { id } = req.params;
  if (!requireHospitalAdminAccess(req, res, id)) return;

  const result = await cacheJson(hospitalAnalyticsCacheKey(id), 300, async () => {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrow = new Date(todayStart);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const [tokens, reviews, doctors, departmentBreakdown] = await Promise.all([
      OpdToken.find({ hospitalId: id, date: { $gte: todayStart, $lt: tomorrow } }).lean(),
      Review.find({ hospitalId: id, status: "published" }).lean(),
      HospitalStaff.find({ hospitalId: id, role: "DOCTOR" }).select("name doctorProfile.rating").lean(),
      OpdToken.aggregate([
        { $match: { hospitalId: new mongoose.Types.ObjectId(id), date: { $gte: todayStart, $lt: tomorrow } } },
        { $group: { _id: "$departmentId", patients: { $sum: 1 }, revenue: { $sum: { $ifNull: ["$paymentAmount", 0] } } } },
      ]),
    ]);

    const completed = tokens.filter((token) => token.status === "completed");
    const noShows = tokens.filter((token) => token.status === "no_show");
    const avgRating = reviews.length
      ? reviews.reduce((sum, review) => sum + Number(review.overallRating || 0), 0) / reviews.length
      : 0;

    return {
      today: {
        tokensIssued: tokens.length,
        completed: completed.length,
        noShows: noShows.length,
        revenue: tokens.reduce((sum, token) => sum + Number(token.paymentAmount || 0), 0),
      },
      thisWeek: {
        patientVolume: [],
        avgWaitTime: 0,
        avgRating: Number(avgRating.toFixed(1)),
      },
      topDoctors: doctors.slice(0, 5).map((doctor) => ({
        name: doctor.name,
        patientsToday: tokens.filter((token) => String(token.doctorId) === String(doctor._id)).length,
        rating: doctor.doctorProfile?.rating || 0,
      })),
      departmentBreakdown,
    };
  });

  return res.status(200).json(result);
};

const getAllHospitals = async (req, res) => {
  const { page, limit, skip } = parsePagination(req);
  const filter = {};
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    Hospital.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Hospital.countDocuments(filter),
  ]);

  return res.status(200).json({ items, total, page, limit });
};

const verifyHospital = async (req, res) => {
  const { id } = req.params;
  const { action, rejectionReason } = req.body;
  if (!["approve", "reject", "suspend"].includes(action)) {
    return res.status(400).json({ message: "Action must be approve, reject or suspend" });
  }

  const update =
    action === "approve"
      ? { status: "active", verifiedAt: new Date(), verifiedBy: req.auth.id, rejectionReason: undefined }
      : action === "reject"
        ? { status: "rejected", rejectionReason }
        : { status: "suspended" };

  const hospital = await Hospital.findByIdAndUpdate(id, update, { new: true });
  if (!hospital) return res.status(404).json({ message: "Hospital not found" });

  await invalidateHospitalCache(hospital);
  return res.status(200).json({ message: "Hospital status updated", hospital });
};

const verifyHospitalFromEmail = async (req, res) => {
  const { id } = req.params;
  const action = String(req.query.action || "");
  const token = String(req.query.token || "");

  if (!["approve", "reject"].includes(action)) {
    return res.status(400).send("Invalid hospital action");
  }

  const expected = signHospitalAction({ hospitalId: id, action });
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(token);
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    return res.status(403).send("Invalid or expired approval link");
  }

  const update =
    action === "approve"
      ? { status: "active", verifiedAt: new Date(), rejectionReason: undefined }
      : { status: "rejected", rejectionReason: "Rejected from email approval link" };

  const hospital = await Hospital.findByIdAndUpdate(id, update, { new: true });
  if (!hospital) return res.status(404).send("Hospital not found");

  await invalidateHospitalCache(hospital);
  return res.status(200).send(`
    <main style="font-family: Arial, sans-serif; padding: 48px; background: #f8fafc; min-height: 100vh;">
      <section style="max-width: 560px; margin: 0 auto; background: white; border: 1px solid #e2e8f0; border-radius: 14px; padding: 28px;">
        <h1 style="margin: 0 0 12px; color: #0f172a;">Hospital ${action === "approve" ? "approved" : "rejected"}</h1>
        <p style="color: #475569;">${hospital.name} is now marked as <strong>${hospital.status}</strong>.</p>
      </section>
    </main>
  `);
};

const getPlatformStats = async (_req, res) => {
  const [totalHospitals, activeHospitals, totalStaff, totalTokens] = await Promise.all([
    Hospital.countDocuments(),
    Hospital.countDocuments({ status: "active" }),
    HospitalStaff.countDocuments(),
    OpdToken.countDocuments(),
  ]);

  return res.status(200).json({
    totalHospitals,
    activeHospitals,
    totalStaff,
    totalTokens,
  });
};

export {
  acceptStaffInvite,
  addDepartment,
  getAllHospitals,
  getAnalytics,
  getHospitalDoctors,
  getHospitalProfile,
  getHospitalQueueStatus,
  getHospitals,
  getPlatformStats,
  getStaff,
  inviteStaff,
  registerHospital,
  requirePlatformAdmin,
  updateDepartment,
  updateHospitalProfile,
  verifyHospitalFromEmail,
  verifyHospital,
};
