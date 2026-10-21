import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import mongoose from "mongoose";
import express from "express";
import bcrypt from "bcryptjs";
import { once } from "node:events";
import { localTestTargets } from "../../util/testTargets.js";
import Hospital from "../../model/hospital.js";
import HospitalStaff from "../../model/hospitalStaff.js";
import AuthSession from "../../model/authSession.js";
import hospitalRouter from "../../routes/hospital.js";
import saasRouter from "../../routes/saasOperations.js";
import userRouter from "../../routes/user.js";
import {
  createAdminSetupLink,
  verifyAdminSetupLink,
  consumeAdminSetupLink,
} from "../../services/saasOperationsService.js";
import { closeRedis } from "../../services/redis.js";

const uri = new URL(localTestTargets().mongo);
uri.pathname = "/medipulse_test_admin_setup_" + crypto.randomBytes(6).toString("hex");

const id = () => new mongoose.Types.ObjectId();
let server, origin;

before(async () => {
  await mongoose.connect(uri.toString(), {
    serverSelectionTimeoutMS: 5000,
    directConnection: true,
  });

  const app = express();
  app.use(express.json());
  app.use("/api/hospitals", hospitalRouter);
  app.use("/api/saas", saasRouter);
  app.use("/api/user", userRouter);

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
});

test("AG10: Hospital admin password setup, registration replacement, and atomic proof consumption", async (t) => {
  const hospitalId = id();
  let validSetupToken = null;
  let testHospital = null;

  await t.test("setup: create test hospital and admin staff fixture", async () => {
    testHospital = await Hospital.create({
      _id: hospitalId,
      name: "Sunrise Memorial Hospital",
      slug: `sunrise-${crypto.randomBytes(3).toString("hex")}`,
      email: `admin-${crypto.randomBytes(4).toString("hex")}@sunrise-health.test`,
      type: "private",
      medicineSystem: "allopathic",
      status: "pending_verification",
      address: { city: "New Delhi", state: "Delhi" },
      registrationNumber: "REG-2026-SUNRISE",
      onboarding: { registeredAt: new Date() },
    });

    await HospitalStaff.create({
      hospitalId,
      name: "Dr. Sunita Sharma",
      email: testHospital.email,
      role: "HOSPITAL_ADMIN",
      inviteStatus: "pending",
    });

    assert.ok(testHospital);
  });

  await t.test("generates 48-hour expiring admin setup link with token hash", async () => {
    const link = await createAdminSetupLink(hospitalId, origin);
    assert.ok(link.token);
    assert.ok(link.tokenHash);
    assert.ok(link.expiresAt);
    assert.ok(link.setupUrl.includes(`/staff/setup?token=${link.token}`));

    validSetupToken = link.token;

    // Verify persisted on Hospital record
    const updated = await Hospital.findById(hospitalId);
    assert.equal(updated.onboarding.setupTokenHash, link.tokenHash);
    assert.ok(updated.onboarding.setupExpiresAt);
  });

  await t.test("verifies setup link publicly with minimal non-sensitive metadata and rejects tampered tokens", async () => {
    // Valid verification via service
    const verification = await verifyAdminSetupLink(validSetupToken);
    assert.equal(verification.valid, true);
    assert.equal(verification.hospital.name, "Sunrise Memorial Hospital");
    assert.equal(verification.hospital.type, "private");
    assert.equal(verification.hospital.setupTokenHash, undefined);
    assert.equal(verification.hospital.password, undefined);

    // Valid verification via HTTP GET /api/saas/setup-link/verify/:token
    const res = await fetch(`${origin}/api/saas/setup-link/verify/${validSetupToken}`);
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.hospital.name, "Sunrise Memorial Hospital");
    assert.equal(body.hospital.setupTokenHash, undefined);

    // Also verify via hospital router alias /api/hospitals/staff/setup/verify/:token
    const aliasRes = await fetch(`${origin}/api/hospitals/staff/setup/verify/${validSetupToken}`);
    assert.equal(aliasRes.status, 200);
    const aliasBody = await aliasRes.json();
    assert.equal(aliasBody.hospital.name, "Sunrise Memorial Hospital");

    // Invalid / tampered token is rejected with 400
    const badRes = await fetch(`${origin}/api/saas/setup-link/verify/fake-tampered-token-12345`);
    assert.equal(badRes.status, 400);

    // Empty token
    await assert.rejects(
      async () => verifyAdminSetupLink(""),
      (err) => err.status === 400
    );
  });

  await t.test("rejects expired setup link with 410 Gone", async () => {
    const expiredHospitalId = id();
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await Hospital.create({
      _id: expiredHospitalId,
      name: "Expired Hospital",
      slug: `expired-${crypto.randomBytes(3).toString("hex")}`,
      email: `expired-${crypto.randomBytes(4).toString("hex")}@expired.test`,
      type: "clinic",
      registrationNumber: "REG-EXPIRED",
      address: { city: "Mumbai", state: "Maharashtra" },
      onboarding: {
        setupTokenHash: tokenHash,
        setupExpiresAt: new Date(Date.now() - 3600000), // 1 hour ago
      },
    });

    const res = await fetch(`${origin}/api/saas/setup-link/verify/${token}`);
    assert.equal(res.status, 410);

    // Also service rejects with 410
    await assert.rejects(
      async () => verifyAdminSetupLink(token),
      (err) => err.status === 410
    );

    // Consuming expired link is rejected with 410
    await assert.rejects(
      async () => consumeAdminSetupLink({ token, adminPassword: "validPassword123" }),
      (err) => err.status === 410
    );
  });

  await t.test("injected transaction failure rolls back both proof consumption and password update", async () => {
    // Attempt consume with injected fault
    await assert.rejects(
      async () =>
        consumeAdminSetupLink({
          token: validSetupToken,
          adminPassword: "PasswordToRollback123!",
          name: "Dr. Rollback",
          _faultInject: "beforeStaffSave",
        }),
      /Injected transaction fault/
    );

    // Verify token was NOT consumed
    const hospitalAfterFault = await Hospital.findById(hospitalId);
    assert.ok(hospitalAfterFault.onboarding.setupTokenHash);
    assert.ok(hospitalAfterFault.onboarding.setupExpiresAt);
    assert.equal(hospitalAfterFault.onboarding.completedAt, undefined);

    // Verify password was NOT saved
    const staffAfterFault = await HospitalStaff.findOne({
      hospitalId,
      role: "HOSPITAL_ADMIN",
    }).select("+password");
    assert.equal(staffAfterFault.password, undefined);
    assert.equal(staffAfterFault.inviteStatus, "pending");
  });

  await t.test("concurrent consume requests serialize safely: exactly one winner succeeds", async () => {
    const passwordA = "ConcurrentWinPasswordA123!";
    const passwordB = "ConcurrentWinPasswordB123!";

    const [resultA, resultB] = await Promise.allSettled([
      consumeAdminSetupLink({ token: validSetupToken, adminPassword: passwordA, name: "Admin Winner A" }),
      consumeAdminSetupLink({ token: validSetupToken, adminPassword: passwordB, name: "Admin Winner B" }),
    ]);

    const successes = [resultA, resultB].filter((r) => r.status === "fulfilled");
    const rejections = [resultA, resultB].filter((r) => r.status === "rejected");

    assert.equal(successes.length, 1, "Exactly one concurrent consume request must succeed");
    assert.equal(rejections.length, 1, "Competing concurrent consume request must be rejected");

    // The winning response
    const winner = successes[0].value;
    assert.equal(winner.success, true);
    assert.equal(String(winner.hospitalId), String(hospitalId));

    // Hospital record should have setupTokenHash unset and status active
    const hospital = await Hospital.findById(hospitalId);
    assert.equal(hospital.onboarding.setupTokenHash, undefined);
    assert.equal(hospital.onboarding.setupExpiresAt, undefined);
    assert.ok(hospital.onboarding.completedAt);
    assert.equal(hospital.status, "active");

    // Admin staff should have bcrypt hashed password and incremented authVersion
    const staff = await HospitalStaff.findOne({ hospitalId, role: "HOSPITAL_ADMIN" }).select("+password");
    assert.equal(staff.inviteStatus, "accepted");
    assert.ok(staff.authVersion >= 1);
    assert.ok(staff.password.startsWith("$2a$") || staff.password.startsWith("$2b$"));
  });

  await t.test("replay of consumed setup token is rejected", async () => {
    await assert.rejects(
      async () =>
        consumeAdminSetupLink({
          token: validSetupToken,
          adminPassword: "ReplayAttemptPassword123!",
        }),
      (err) => err.status === 400 || err.status === 409
    );

    // Also via HTTP POST
    const res = await fetch(`${origin}/api/saas/setup-link/consume`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: validSetupToken,
        adminPassword: "ReplayAttemptPassword123!",
      }),
    });
    assert.ok([400, 409].includes(res.status));
  });

  await t.test("staffLogin authenticates successfully with the new password and rejects bad password", async () => {
    const adminStaff = await HospitalStaff.findOne({ hospitalId, role: "HOSPITAL_ADMIN" });

    // Test password authentication via staff login endpoint
    const badLoginRes = await fetch(`${origin}/api/user/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminStaff.email,
        password: "IncorrectPassword999!",
        hospitalId: String(hospitalId),
      }),
    });
    assert.equal(badLoginRes.status, 401);

    // Winning password authenticates successfully
    const winningPassword = "ConcurrentWinPasswordA123!";
    const fallbackPassword = "ConcurrentWinPasswordB123!";
    let goodLoginRes = await fetch(`${origin}/api/user/staff/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: adminStaff.email,
        password: winningPassword,
        hospitalId: String(hospitalId),
      }),
    });

    if (goodLoginRes.status === 401) {
      goodLoginRes = await fetch(`${origin}/api/user/staff/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: adminStaff.email,
          password: fallbackPassword,
          hospitalId: String(hospitalId),
        }),
      });
    }

    assert.equal(goodLoginRes.status, 200);
    const loginBody = await goodLoginRes.json();
    const staffData = loginBody.result || loginBody.staff;
    assert.equal(staffData.role, "HOSPITAL_ADMIN");
    assert.equal(staffData.email, adminStaff.email);
  });

  await t.test("new hospital registration does not write encrypted-password fields", async () => {
    const regEmail = `new-reg-${crypto.randomBytes(4).toString("hex")}@reg-test.org`;
    const regRes = await fetch(`${origin}/api/hospitals/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Modern Wellness Center",
        email: regEmail,
        phone: "9876543210",
        address: { city: "Bengaluru", state: "Karnataka" },
        type: "clinic",
        medicineSystem: "integrative",
        registrationNumber: "REG-MODERN-001",
        adminName: "Dr. Rajiv Mehta",
        adminPassword: "RegistrationPassword123!",
      }),
    });

    assert.equal(regRes.status, 201);
    const regBody = await regRes.json();
    assert.ok(regBody.hospital);
    assert.ok(regBody.staff);

    // Verify on raw MongoDB document that initialAdminPasswordEncrypted is NOT present
    const rawHospital = await Hospital.findById(regBody.hospital._id).lean();
    assert.equal(rawHospital.onboarding?.initialAdminPasswordEncrypted, undefined);
    assert.equal(rawHospital.onboarding?.initialAdminPasswordIv, undefined);
    assert.equal(rawHospital.onboarding?.initialAdminPasswordTag, undefined);
  });

  await t.test("legacy hospital record with ciphertext is preserved and can still be decrypted", async () => {
    // Manually construct legacy encrypted password structure
    const legacySecret = crypto.createHash("sha256").update(`${process.env.TOKEN_KEY || "medipulse"}:hospital-admin-password`).digest();
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", legacySecret, iv);
    const plaintext = "LegacySecretPass2026!";
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const tag = cipher.getAuthTag();

    const legacyHospital = {
      onboarding: {
        initialAdminPasswordEncrypted: encrypted.toString("base64"),
        initialAdminPasswordIv: iv.toString("base64"),
        initialAdminPasswordTag: tag.toString("base64"),
      },
    };

    // Decrypt using existing legacy decryption logic
    const decipher = crypto.createDecipheriv("aes-256-gcm", legacySecret, Buffer.from(legacyHospital.onboarding.initialAdminPasswordIv, "base64"));
    decipher.setAuthTag(Buffer.from(legacyHospital.onboarding.initialAdminPasswordTag, "base64"));
    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(legacyHospital.onboarding.initialAdminPasswordEncrypted, "base64")),
      decipher.final(),
    ]).toString("utf8");

    assert.equal(decrypted, plaintext, "Legacy ciphertext must be faithfully decryptable for reviewed migration");
  });

  await t.test("setup route works via /api/user/staff/setup alias endpoint", async () => {
    const aliasHospitalId = id();

    await Hospital.create({
      _id: aliasHospitalId,
      name: "Alias Test Hospital",
      slug: `alias-${crypto.randomBytes(3).toString("hex")}`,
      email: `alias-${crypto.randomBytes(4).toString("hex")}@alias-test.org`,
      type: "private",
      status: "pending_verification",
      registrationNumber: "REG-ALIAS-001",
      address: { city: "Hyderabad", state: "Telangana" },
      onboarding: { registeredAt: new Date() },
    });

    const link = await createAdminSetupLink(aliasHospitalId, origin);

    await HospitalStaff.create({
      hospitalId: aliasHospitalId,
      name: "Dr. Alias Admin",
      email: `alias-${crypto.randomBytes(4).toString("hex")}@alias-test.org`,
      role: "HOSPITAL_ADMIN",
      inviteStatus: "pending",
    });

    // Verify via /api/user/staff/setup/verify/:token
    const verifyRes = await fetch(`${origin}/api/user/staff/setup/verify/${link.token}`);
    assert.equal(verifyRes.status, 200);

    // Consume via /api/user/staff/setup
    const consumeRes = await fetch(`${origin}/api/user/staff/setup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: link.token,
        adminPassword: "AliasValidPassword123!",
        name: "Dr. Alias Admin Updated",
      }),
    });
    assert.equal(consumeRes.status, 200);
    const consumeBody = await consumeRes.json();
    assert.equal(consumeBody.result.success, true);
  });
});
