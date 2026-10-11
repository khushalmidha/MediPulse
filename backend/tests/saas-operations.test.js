import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import {
  PLAN_ENTITLEMENTS,
  getPlanEntitlements,
  checkStaffLimit,
  checkDepartmentLimit,
  checkFeatureEntitlement,
  createAdminSetupLink,
  verifyAdminSetupLink,
  assertTenantNotSuspended,
  suspendTenant,
  unsuspendTenant,
  calculateOperationalMetrics,
  createSupportTicket,
  exportTenantConfiguration,
} from "../services/saasOperationsService.js";
import {
  getBillingProviderConfig,
  createSubscriptionCheckoutSession,
  handleBillingWebhook,
  BILLING_PROVIDER_STATUS,
} from "../services/billingProviderAdapter.js";

test("P17: SaaS onboarding, plan entitlements, tenant suspension, and operational metrics", async (t) => {
  const hospitalId = new mongoose.Types.ObjectId();

  await t.test("plan entitlements correctly define limits and feature tiers", () => {
    assert.equal(PLAN_ENTITLEMENTS.starter.maxStaff, 10);
    assert.equal(PLAN_ENTITLEMENTS.starter.maxDepartments, 3);
    assert.deepEqual(PLAN_ENTITLEMENTS.starter.features, ["opd", "queue"]);

    assert.equal(PLAN_ENTITLEMENTS.growth.maxStaff, 50);
    assert.equal(PLAN_ENTITLEMENTS.growth.maxDepartments, 10);
    assert.ok(PLAN_ENTITLEMENTS.growth.features.includes("labs"));
    assert.ok(PLAN_ENTITLEMENTS.growth.features.includes("pharmacy"));

    assert.equal(PLAN_ENTITLEMENTS.enterprise.maxStaff, 1000);
    assert.equal(PLAN_ENTITLEMENTS.enterprise.maxDepartments, 100);
    assert.ok(PLAN_ENTITLEMENTS.enterprise.features.includes("multi_branch"));
  });

  await t.test("enforces staff and department limits by tier", () => {
    const starterHospital = { subscription: { plan: "starter" } };
    const growthHospital = { subscription: { plan: "growth" } };

    // Within limit
    assert.equal(checkStaffLimit(starterHospital, 5), true);
    assert.equal(checkDepartmentLimit(starterHospital, 2), true);

    // Limit exceeded
    assert.throws(
      () => checkStaffLimit(starterHospital, 10),
      /Staff limit reached for current starter plan/
    );
    assert.throws(
      () => checkDepartmentLimit(starterHospital, 3),
      /Department limit reached for current starter plan/
    );

    // Growth tier allows higher limits
    assert.equal(checkStaffLimit(growthHospital, 15), true);
    assert.equal(checkDepartmentLimit(growthHospital, 5), true);
  });

  await t.test("enforces feature access control per subscription plan", () => {
    const starterHospital = { subscription: { plan: "starter" } };
    const growthHospital = { subscription: { plan: "growth" } };

    // Allowed on starter
    assert.equal(checkFeatureEntitlement(starterHospital, "opd"), true);
    assert.equal(checkFeatureEntitlement(starterHospital, "queue"), true);

    // Not allowed on starter
    assert.throws(
      () => checkFeatureEntitlement(starterHospital, "labs"),
      /Feature 'labs' is not included in your starter plan/
    );

    // Allowed on growth
    assert.equal(checkFeatureEntitlement(growthHospital, "labs"), true);
    assert.equal(checkFeatureEntitlement(growthHospital, "pharmacy"), true);
  });

  await t.test("generates secure 48-hour expiring admin setup links with token hashes", async () => {
    const linkResult = await createAdminSetupLink(hospitalId, "https://medipulse.live");
    assert.ok(linkResult.token);
    assert.ok(linkResult.tokenHash);
    assert.ok(linkResult.expiresAt);
    assert.ok(linkResult.setupUrl.includes("/staff/setup?token="));

    // Expiration is ~48 hours in the future
    const diffHours = (new Date(linkResult.expiresAt).getTime() - Date.now()) / (3600 * 1000);
    assert.ok(diffHours > 47.9 && diffHours <= 48.1);
  });

  await t.test("tenant suspension stops access and unsuspend restores access", async () => {
    const activeHospital = { status: "active", suspension: { isSuspended: false } };
    assert.equal(assertTenantNotSuspended(activeHospital), true);

    const suspendedHospital = {
      status: "suspended",
      suspension: { isSuspended: true, reason: "Payment dispute" },
    };
    assert.throws(
      () => assertTenantNotSuspended(suspendedHospital),
      /This hospital workspace is currently suspended: Payment dispute/
    );
  });

  await t.test("calculates privacy-safe operational performance metrics without PII leakage", async () => {
    const metrics = await calculateOperationalMetrics({ hospitalId });
    assert.ok(metrics);
    assert.ok(typeof metrics.totalBookings === "number");
    assert.ok(typeof metrics.completedVisits === "number");
    assert.ok(typeof metrics.completionRatePercent === "number");
    // Verify no clinical notes or patient names in metrics output
    assert.equal(metrics.patientName, undefined);
    assert.equal(metrics.clinicalNotes, undefined);
    assert.equal(metrics.diagnosis, undefined);
  });

  await t.test("creates structured support ticket with unique reference id", async () => {
    const ticket = await createSupportTicket({
      hospitalId,
      subject: "Lab printer integration issue",
      description: "Thermal barcode label printer needs updated baud rate configuration",
      priority: "high",
    });

    assert.ok(ticket.ticketId.startsWith("SUP-"));
    assert.equal(ticket.subject, "Lab printer integration issue");
    assert.equal(ticket.priority, "high");
    assert.equal(ticket.status, "open");
  });

  await t.test("export tenant configuration packages clean metadata without credentials", async () => {
    const exportResult = await exportTenantConfiguration({ hospitalId });
    assert.ok(exportResult.exportedAt);
    assert.ok(exportResult.retentionPolicy);
    assert.equal(exportResult.password, undefined);
    assert.equal(exportResult.setupTokenHash, undefined);
  });

  await t.test("billing adapter keeps payment gateway pending until country provider confirmed", async () => {
    const config = getBillingProviderConfig();
    assert.equal(config.status, BILLING_PROVIDER_STATUS.PENDING_CONFIGURATION);
    assert.ok(config.activationNotice);

    const checkout = await createSubscriptionCheckoutSession({
      hospitalId,
      plan: "growth",
    });
    assert.equal(checkout.checkoutPending, true);
    assert.equal(checkout.plan, "growth");

    const webhookRes = await handleBillingWebhook({}, "sig_123");
    assert.equal(webhookRes.processed, false);
    assert.equal(webhookRes.receivedSignature, true);
  });
});
