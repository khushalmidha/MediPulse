import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import Hospital from "../../model/hospital.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import Department from "../../model/department.js";
import HospitalLocation from "../../model/hospitalLocation.js";
import { CareSession } from "../../model/scheduling.js";
import OpdToken from "../../model/opdToken.js";
import User from "../../model/user.js";
import Doctor from "../../model/doctor.js";
import AuthSession from "../../model/authSession.js";
import hospitalRouter from "../../routes/hospital.js";
import saasRouter from "../../routes/saasOperations.js";
import schedulingRouter from "../../routes/scheduling.js";
import encounterRouter from "../../routes/encounter.js";
import { createLabOrder } from "../../services/labService.js";
import { createPrescription } from "../../services/pharmacyService.js";
import { schedulingDoctor } from "../../services/scheduling.js";
import { calculateOperationalMetrics, checkFeatureEntitlement } from "../../services/saasOperationsService.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_entitlements_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
let server, origin;

const platformAdminId = id();
const adminStaffId = id();
const starterHospitalId = id();
let starterAdminToken = null;
let platformOperatorToken = null;

async function makeSessionToken(principalId, kind, hospitalId = null) {
  const sid = crypto.randomUUID();
  await AuthSession.create({
    _id: sid,
    principalId,
    kind,
    csrfToken: "isolated-csrf",
    expiresAt: new Date(Date.now() + 600000),
  });
  return jwt.sign(
    {
      sid,
      id: String(principalId),
      role: kind === "staff" ? "HOSPITAL_ADMIN" : "user",
      ...(kind === "staff" ? { type: "staff", hospitalId: String(hospitalId) } : {}),
    },
    process.env.TOKEN_KEY,
    { expiresIn: "1h" }
  );
}

before(async () => {
  await mongoose.connect(uri.toString(), {
    serverSelectionTimeoutMS: 5000,
    directConnection: true,
  });

  process.env.PLATFORM_ADMIN_IDS = String(platformAdminId);

  // Setup platform admin user
  await User.collection.insertOne({
    _id: platformAdminId,
    firstName: "Platform",
    lastName: "Operator",
    email: "operator@medipulse.test",
    authVersion: 0,
  });

  // Setup starter hospital fixture (Starter plan limits: max 3 departments, max 10 staff)
  await Hospital.create({
    _id: starterHospitalId,
    name: "Starter Health Center",
    slug: `starter-${crypto.randomBytes(3).toString("hex")}`,
    email: `starter-${crypto.randomBytes(3).toString("hex")}@starter-clinic.test`,
    type: "private",
    medicineSystem: "allopathic",
    status: "active",
    address: { city: "New Delhi", state: "Delhi" },
    registrationNumber: `REG-STARTER-${crypto.randomBytes(3).toString("hex")}`,
    subscription: {
      plan: "starter",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 86400000),
    },
    suspension: {
      isSuspended: false,
    },
    stats: {
      totalDoctors: 1,
      totalDepartments: 0,
    },
  });

  // Setup initial admin staff
  await HospitalStaff.create({
    _id: adminStaffId,
    hospitalId: starterHospitalId,
    name: "Dr. Admin Starter",
    email: "admin@starter-clinic.test",
    role: "HOSPITAL_ADMIN",
    inviteStatus: "accepted",
    isActive: true,
    authVersion: 0,
  });

  starterAdminToken = await makeSessionToken(adminStaffId, "staff", starterHospitalId);
  platformOperatorToken = await makeSessionToken(platformAdminId, "user");

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/hospitals", hospitalRouter);
  app.use("/api/saas", saasRouter);
  app.use("/api/scheduling", schedulingRouter);
  app.use("/api/encounters", encounterRouter);

  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = error.status || (error.name === "ValidationError" || error.name === "CastError" ? 400 : error.code === 11000 ? 409 : 500);
    res.status(status).json({ message: error.message || "Request failed" });
  });

  server = app.listen(0);
  await once(server, "listening");
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (mongoose.connection.readyState === 1) {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }
  await closeRedis().catch(() => {});
  delete process.env.PLATFORM_ADMIN_IDS;
});

test("AG11: Real entitlement/quota/suspension callers and activation checklist", async (t) => {
  await t.test("1. Department Quota: exactly 3 departments allowed on starter plan, serializes concurrent boundary additions", async () => {
    // Add 1st department
    const res1 = await fetch(`${origin}/api/hospitals/${starterHospitalId}/departments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${starterAdminToken}`,
      },
      body: JSON.stringify({ name: "General Medicine", description: "Primary care" }),
    });
    if (res1.status !== 201) {
      console.error("res1 failed:", res1.status, await res1.clone().json().catch(() => ({})));
    }
    assert.equal(res1.status, 201);

    // Add 2nd department
    const res2 = await fetch(`${origin}/api/hospitals/${starterHospitalId}/departments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${starterAdminToken}`,
      },
      body: JSON.stringify({ name: "Pediatrics", description: "Child healthcare" }),
    });
    assert.equal(res2.status, 201);

    // Currently 2 departments exist. Starter limit is 3. Exactly 1 slot left.
    // Dispatch 2 concurrent additions at the boundary.
    const [compA, compB] = await Promise.all([
      fetch(`${origin}/api/hospitals/${starterHospitalId}/departments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${starterAdminToken}`,
        },
        body: JSON.stringify({ name: "Cardiology", description: "Heart care" }),
      }),
      fetch(`${origin}/api/hospitals/${starterHospitalId}/departments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${starterAdminToken}`,
        },
        body: JSON.stringify({ name: "Orthopedics", description: "Bone and joint" }),
      }),
    ]);

    const statuses = [compA.status, compB.status].sort();
    assert.deepEqual(statuses, [201, 403], "Exactly one concurrent addition succeeds (201) and competing addition is rejected with 403");

    // Total departments in DB must be exactly 3
    const totalDepts = await Department.countDocuments({ hospitalId: starterHospitalId, status: "active" });
    assert.equal(totalDepts, 3);

    // Subsequent addition beyond limit must fail with 403
    const overflowRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/departments`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${starterAdminToken}`,
      },
      body: JSON.stringify({ name: "Dermatology", description: "Skin care" }),
    });
    assert.equal(overflowRes.status, 403);
    const overflowBody = await overflowRes.json();
    assert.match(overflowBody.message, /Department limit reached for current starter plan/i);
  });

  await t.test("2. Staff Quota: exactly 10 staff members allowed on starter plan, serializes concurrent boundary additions", async () => {
    // Current staff count is 1 (the admin).
    // Seed 8 more staff to reach 9 (1 slot left before limit of 10)
    for (let i = 2; i <= 9; i++) {
      await HospitalStaff.create({
        hospitalId: starterHospitalId,
        name: `Staff Member ${i}`,
        email: `staff${i}-${crypto.randomBytes(3).toString("hex")}@starter-clinic.test`,
        role: "NURSE",
        inviteStatus: "accepted",
        isActive: true,
      });
    }

    const currentStaffCount = await HospitalStaff.countDocuments({ hospitalId: starterHospitalId, isActive: true });
    assert.equal(currentStaffCount, 9);

    // Concurrently dispatch 2 staff invite requests competing for the 10th slot
    const [inviteA, inviteB] = await Promise.all([
      fetch(`${origin}/api/hospitals/${starterHospitalId}/staff/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${starterAdminToken}`,
        },
        body: JSON.stringify({
          name: "Dr. Competing Candidate A",
          email: `comp-a-${crypto.randomBytes(3).toString("hex")}@starter-clinic.test`,
          role: "DOCTOR",
        }),
      }),
      fetch(`${origin}/api/hospitals/${starterHospitalId}/staff/invite`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${starterAdminToken}`,
        },
        body: JSON.stringify({
          name: "Dr. Competing Candidate B",
          email: `comp-b-${crypto.randomBytes(3).toString("hex")}@starter-clinic.test`,
          role: "DOCTOR",
        }),
      }),
    ]);

    const inviteStatuses = [inviteA.status, inviteB.status].sort();
    assert.deepEqual(inviteStatuses, [201, 403], "Exactly one concurrent staff addition succeeds (201) and competing addition is rejected with 403");

    // Total staff in DB must be exactly 10
    const finalStaffCount = await HospitalStaff.countDocuments({ hospitalId: starterHospitalId, isActive: true });
    assert.equal(finalStaffCount, 10);

    // Subsequent invite beyond limit must fail with 403
    const overflowInvite = await fetch(`${origin}/api/hospitals/${starterHospitalId}/staff/invite`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${starterAdminToken}`,
      },
      body: JSON.stringify({
        name: "Dr. Eleventh Staff",
        email: `eleventh-${crypto.randomBytes(3).toString("hex")}@starter-clinic.test`,
        role: "DOCTOR",
      }),
    });
    assert.equal(overflowInvite.status, 403);
    const overflowInviteBody = await overflowInvite.json();
    assert.match(overflowInviteBody.message, /Staff limit reached for current starter plan/i);
  });

  await t.test("3. Suspension Policy: platform operator suspension blocks all hospital operations consistently with 403", async () => {
    // Platform Operator suspends the tenant
    const suspendRes = await fetch(`${origin}/api/saas/tenants/${starterHospitalId}/suspend`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${platformOperatorToken}`,
      },
      body: JSON.stringify({ reason: "Unpaid invoices and policy non-compliance" }),
    });
    assert.equal(suspendRes.status, 200);

    const suspendedHospital = await Hospital.findById(starterHospitalId);
    assert.equal(suspendedHospital.status, "suspended");
    assert.equal(suspendedHospital.suspension.isSuspended, true);
    assert.match(suspendedHospital.suspension.reason, /Unpaid invoices/);

    // 1. Department mutation fails
    const deptRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/departments`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${starterAdminToken}` },
      body: JSON.stringify({ name: "Neurology", opd: { consultationFee: 500 } }),
    });
    assert.equal(deptRes.status, 403);
    const deptBody = await deptRes.json();
    assert.match(deptBody.message, /workspace is currently suspended/i);

    // 2. Staff invite fails
    const staffRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/staff/invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${starterAdminToken}` },
      body: JSON.stringify({ name: "Dr. Blocked", email: "blocked@starter.test", role: "DOCTOR" }),
    });
    assert.equal(staffRes.status, 403);
    const staffBody = await staffRes.json();
    assert.match(staffBody.message, /workspace is currently suspended/i);

    // 3. Location / Room creation fails
    const locRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${starterAdminToken}` },
      body: JSON.stringify({ name: "Room 101", type: "room", serviceType: "consultation" }),
    });
    assert.equal(locRes.status, 403);
    const locBody = await locRes.json();
    assert.match(locBody.message, /workspace is currently suspended/i);

    // 4. Hospital profile update fails
    const profileRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${starterAdminToken}` },
      body: JSON.stringify({ phone: "+91 9999999999" }),
    });
    assert.equal(profileRes.status, 403);
    const profileBody = await profileRes.json();
    assert.match(profileBody.message, /workspace is currently suspended/i);

    // 5. Custom domain claim fails
    const domainRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/website/custom-domain`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${starterAdminToken}` },
      body: JSON.stringify({ domain: "clinic.starterhealth.org" }),
    });
    assert.equal(domainRes.status, 403);
    const domainBody = await domainRes.json();
    assert.match(domainBody.message, /workspace is currently suspended/i);

    // 6. Scheduling session creation fails
    const activeDept = await Department.findOne({ hospitalId: starterHospitalId });
    await assert.rejects(
      async () =>
        schedulingDoctor({
          hospitalId: starterHospitalId,
          departmentId: activeDept?._id || id(),
          doctorId: adminStaffId,
        }),
      (err) => err.status === 403 && /workspace is currently suspended/i.test(err.message)
    );

    // 7. Clinical lab order creation fails
    await assert.rejects(
      async () =>
        createLabOrder({
          hospitalId: starterHospitalId,
          tokenId: id(),
          tests: [{ catalogId: "CBC-001" }],
        }),
      (err) => err.status === 403 && /workspace is currently suspended/i.test(err.message)
    );

    // 8. Clinical prescription creation fails
    await assert.rejects(
      async () =>
        createPrescription({
          hospitalId: starterHospitalId,
          tokenId: id(),
          items: [{ name: "Paracetamol", dosage: "500mg" }],
        }),
      (err) => err.status === 403 && /workspace is currently suspended/i.test(err.message)
    );
  });

  await t.test("4. Unsuspension Policy: platform operator restores tenant and operations resume", async () => {
    // Platform Operator unsuspends the tenant
    const unsuspendRes = await fetch(`${origin}/api/saas/tenants/${starterHospitalId}/unsuspend`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${platformOperatorToken}`,
      },
    });
    assert.equal(unsuspendRes.status, 200);

    const restoredHospital = await Hospital.findById(starterHospitalId);
    assert.equal(restoredHospital.status, "active");
    assert.equal(restoredHospital.suspension.isSuspended, false);

    // Profile update succeeds now
    const profileRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/profile`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${starterAdminToken}` },
      body: JSON.stringify({ phone: "+91 9876543210" }),
    });
    assert.equal(profileRes.status, 200);

    // Location creation succeeds now
    const locRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/locations`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${starterAdminToken}` },
      body: JSON.stringify({ name: "Consultation Suite A", type: "room", serviceType: "consultation" }),
    });
    assert.equal(locRes.status, 201);
  });

  await t.test("5. Wrong-Plan Feature Entitlements: rejected on starter plan, enabled on growth/enterprise", async () => {
    // Starter plan rejects custom_domain via HTTP caller
    const domainRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/website/custom-domain`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${starterAdminToken}` },
      body: JSON.stringify({ domain: "clinic.starterhealth.org" }),
    });
    assert.equal(domainRes.status, 403);
    const domainBody = await domainRes.json();
    assert.match(domainBody.message, /Feature 'custom_domain' is not included in your starter plan/i);

    // Starter plan feature entitlement checks
    const starterHospital = await Hospital.findById(starterHospitalId);
    assert.throws(
      () => checkFeatureEntitlement(starterHospital, "custom_domain"),
      (err) => err.status === 403 && /Feature 'custom_domain' is not included in your starter plan/i.test(err.message)
    );
    assert.throws(
      () => checkFeatureEntitlement(starterHospital, "labs"),
      (err) => err.status === 403 && /Feature 'labs' is not included in your starter plan/i.test(err.message)
    );
    assert.throws(
      () => checkFeatureEntitlement(starterHospital, "pharmacy"),
      (err) => err.status === 403 && /Feature 'pharmacy' is not included in your starter plan/i.test(err.message)
    );

    // Upgrade to Growth Plan via platform operator
    const upgradeRes = await fetch(`${origin}/api/saas/tenants/${starterHospitalId}/subscription`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${platformOperatorToken}` },
      body: JSON.stringify({ plan: "growth" }),
    });
    assert.equal(upgradeRes.status, 200);

    // Growth plan still rejects custom_domain via HTTP caller
    const domainGrowthRes = await fetch(`${origin}/api/hospitals/${starterHospitalId}/website/custom-domain`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${starterAdminToken}` },
      body: JSON.stringify({ domain: "clinic.starterhealth.org" }),
    });
    assert.equal(domainGrowthRes.status, 403);
    const domainGrowthBody = await domainGrowthRes.json();
    assert.match(domainGrowthBody.message, /Feature 'custom_domain' is not included in your growth plan/i);

    // Growth plan enables labs and pharmacy
    const upgradedHospital = await Hospital.findById(starterHospitalId);
    assert.equal(upgradedHospital.subscription.plan, "growth");
    assert.equal(checkFeatureEntitlement(upgradedHospital, "labs"), true);
    assert.equal(checkFeatureEntitlement(upgradedHospital, "pharmacy"), true);
    assert.throws(
      () => checkFeatureEntitlement(upgradedHospital, "custom_domain"),
      (err) => err.status === 403 && /Feature 'custom_domain' is not included in your growth plan/i.test(err.message)
    );
  });

  await t.test("6. Activation Checklist: progress derives progressively across all 5 milestones to full activation", async () => {
    // Create an entirely clean synthetic tenant to guide through the 5 activation steps
    const newHospitalId = id();
    const newAdminStaffId = id();

    await Hospital.create({
      _id: newHospitalId,
      name: "Sunrise Community Hospital",
      slug: `sunrise-${crypto.randomBytes(3).toString("hex")}`,
      email: `admin-${crypto.randomBytes(3).toString("hex")}@sunrise.test`,
      type: "private",
      medicineSystem: "allopathic",
      status: "active",
      address: { city: "New Delhi", state: "Delhi" },
      registrationNumber: `REG-SUNRISE-${crypto.randomBytes(3).toString("hex")}`,
      subscription: { plan: "starter", status: "active" },
    });

    // Milestone 0: Completely clean state (0 depts, 0 staff, 0 rooms, 0 sessions, 0 tokens)
    const metrics0 = await calculateOperationalMetrics({ hospitalId: newHospitalId });
    assert.equal(metrics0.activationChecklist.departments.completed, false);
    assert.equal(metrics0.activationChecklist.staff.completed, false);
    assert.equal(metrics0.activationChecklist.rooms.completed, false);
    assert.equal(metrics0.activationChecklist.availability.completed, false);
    assert.equal(metrics0.activationChecklist.firstBooking.completed, false);
    assert.equal(metrics0.activationChecklist.completedSteps, 0);
    assert.equal(metrics0.activationChecklist.percentComplete, 0);
    assert.equal(metrics0.activationChecklist.isFullyActivated, false);

    // Milestone 1: Department configured
    const testDept = await Department.create({
      hospitalId: newHospitalId,
      name: "Outpatient General",
      opd: { consultationFee: 500 },
      status: "active",
    });

    const metrics1 = await calculateOperationalMetrics({ hospitalId: newHospitalId });
    assert.equal(metrics1.activationChecklist.departments.completed, true);
    assert.equal(metrics1.activationChecklist.departments.count, 1);
    assert.equal(metrics1.activationChecklist.completedSteps, 1);
    assert.equal(metrics1.activationChecklist.percentComplete, 20);

    // Milestone 2: Staff member invited and accepted
    await HospitalStaff.create({
      _id: newAdminStaffId,
      hospitalId: newHospitalId,
      name: "Dr. Ananya Sen",
      email: "ananya@sunrise.test",
      role: "DOCTOR",
      adminAccess: true,
      inviteStatus: "accepted",
      isActive: true,
      departmentIds: [testDept._id],
    });

    const metrics2 = await calculateOperationalMetrics({ hospitalId: newHospitalId });
    assert.equal(metrics2.activationChecklist.staff.completed, true);
    assert.equal(metrics2.activationChecklist.staff.count, 1);
    assert.equal(metrics2.activationChecklist.completedSteps, 2);
    assert.equal(metrics2.activationChecklist.percentComplete, 40);

    // Milestone 3: Consultation Room configured
    await HospitalLocation.create({
      hospitalId: newHospitalId,
      name: "Room 101 - General OPD",
      type: "room",
      serviceType: "consultation",
      departmentId: testDept._id,
      status: "active",
    });

    const metrics3 = await calculateOperationalMetrics({ hospitalId: newHospitalId });
    assert.equal(metrics3.activationChecklist.rooms.completed, true);
    assert.equal(metrics3.activationChecklist.rooms.count, 1);
    assert.equal(metrics3.activationChecklist.completedSteps, 3);
    assert.equal(metrics3.activationChecklist.percentComplete, 60);

    // Milestone 4: Doctor availability published (CareSession created)
    await CareSession.create({
      hospitalId: newHospitalId,
      departmentId: testDept._id,
      doctorId: newAdminStaffId,
      canonicalDoctorId: id(),
      sessionId: `s_${id()}`,
      practiceKey: `hospital:${newHospitalId}`,
      queueKey: `hospital:${newHospitalId}:${newAdminStaffId}:2026-10-22:s1`,
      serviceDate: "2026-10-22",
      appointmentType: "hospital_in_person",
      feeMinor: 50000,
      state: "open",
      timezone: "Asia/Kolkata",
      startsAt: new Date(),
      endsAt: new Date(Date.now() + 3600000),
      slots: [],
    });

    const metrics4 = await calculateOperationalMetrics({ hospitalId: newHospitalId });
    assert.equal(metrics4.activationChecklist.availability.completed, true);
    assert.equal(metrics4.activationChecklist.availability.count, 1);
    assert.equal(metrics4.activationChecklist.completedSteps, 4);
    assert.equal(metrics4.activationChecklist.percentComplete, 80);

    // Milestone 5: First synthetic patient booking (OpdToken created)
    await OpdToken.create({
      hospitalId: newHospitalId,
      departmentId: testDept._id,
      doctorId: newAdminStaffId,
      patientId: id(),
      patientInfo: { name: "First Booking Patient" },
      tokenNumber: 1,
      displayToken: "T001",
      status: "waiting",
      date: new Date(),
      serviceDate: "2026-10-22",
      queueKey: `hospital:${newHospitalId}:${newAdminStaffId}:2026-10-22:s1`,
    });

    const metrics5 = await calculateOperationalMetrics({ hospitalId: newHospitalId });
    assert.equal(metrics5.activationChecklist.firstBooking.completed, true);
    assert.equal(metrics5.activationChecklist.firstBooking.count, 1);
    assert.equal(metrics5.activationChecklist.completedSteps, 5);
    assert.equal(metrics5.activationChecklist.percentComplete, 100);
    assert.equal(metrics5.activationChecklist.isFullyActivated, true);
    assert.equal(metrics5.staffSetupCompletionPercent, 100);

    // Verify GET /api/saas/tenants/:id/metrics endpoint returns the complete checklist
    const newAdminToken = await makeSessionToken(newAdminStaffId, "staff", newHospitalId);
    const metricsHttpRes = await fetch(`${origin}/api/saas/tenants/${newHospitalId}/metrics`, {
      headers: { Authorization: `Bearer ${newAdminToken}` },
    });
    assert.equal(metricsHttpRes.status, 200);
    const httpBody = await metricsHttpRes.json();
    assert.ok(httpBody.metrics.activationChecklist);
    assert.equal(httpBody.metrics.activationChecklist.isFullyActivated, true);
    assert.equal(httpBody.metrics.activationChecklist.percentComplete, 100);
    assert.equal(httpBody.metrics.activationChecklist.completedSteps, 5);
  });
});
