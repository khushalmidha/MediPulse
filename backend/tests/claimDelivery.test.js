import test from "node:test";
import assert from "node:assert/strict";
import {
  isClaimDeliveryConfigured,
  dispatchClaimVerificationCode,
  setClaimDeliveryAdapterForTest,
  resetClaimDeliveryAdapterForTest,
} from "../services/claimDelivery.js";

test("isClaimDeliveryConfigured behaves correctly across environments and providers", () => {
  const originalEnv = { ...process.env };
  try {
    // 1. In test environment, returns true
    process.env.NODE_ENV = "test";
    assert.equal(isClaimDeliveryConfigured(), true);

    // 2. In production without provider, returns false
    process.env.NODE_ENV = "production";
    delete process.env.CLAIM_SMS_PROVIDER;
    assert.equal(isClaimDeliveryConfigured(), false);

    process.env.CLAIM_SMS_PROVIDER = "none";
    assert.equal(isClaimDeliveryConfigured(), false);

    // 3. Twilio incomplete vs complete
    process.env.CLAIM_SMS_PROVIDER = "twilio";
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_FROM_PHONE;
    assert.equal(isClaimDeliveryConfigured(), false);

    process.env.TWILIO_ACCOUNT_SID = "AC_test123";
    process.env.TWILIO_AUTH_TOKEN = "auth_test456";
    process.env.TWILIO_FROM_PHONE = "+15551234567";
    assert.equal(isClaimDeliveryConfigured(), true);

    // 4. MSG91 incomplete vs complete
    process.env.CLAIM_SMS_PROVIDER = "msg91";
    delete process.env.MSG91_AUTH_KEY;
    delete process.env.MSG91_TEMPLATE_ID;
    assert.equal(isClaimDeliveryConfigured(), false);

    process.env.MSG91_AUTH_KEY = "msg91_auth_key";
    process.env.MSG91_TEMPLATE_ID = "tmpl_12345";
    assert.equal(isClaimDeliveryConfigured(), true);

    // 5. AWS SNS incomplete vs complete
    process.env.CLAIM_SMS_PROVIDER = "aws_sns";
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    assert.equal(isClaimDeliveryConfigured(), false);

    process.env.AWS_ACCESS_KEY_ID = "AKIA_test";
    process.env.AWS_SECRET_ACCESS_KEY = "secret_test";
    assert.equal(isClaimDeliveryConfigured(), true);

    // 6. Unknown provider
    process.env.CLAIM_SMS_PROVIDER = "unknown_provider";
    assert.equal(isClaimDeliveryConfigured(), false);
  } finally {
    process.env = originalEnv;
  }
});

test("dispatchClaimVerificationCode in test environment uses test delivery adapter if registered", async () => {
  const originalEnv = { ...process.env };
  try {
    process.env.NODE_ENV = "test";
    let captured = null;
    setClaimDeliveryAdapterForTest(async (payload) => {
      captured = payload;
      return { ok: true, status: "sent", provider: "mock_test" };
    });

    const res = await dispatchClaimVerificationCode({
      phone: "9876543210",
      otp: "123456",
      encounterId: "enc_1",
      hospitalId: "hosp_1",
      maskedPhone: "******3210",
    });

    assert.equal(res.ok, true);
    assert.equal(res.status, "sent");
    assert.equal(res.provider, "mock_test");
    assert.equal(captured.otp, "123456");

    resetClaimDeliveryAdapterForTest();

    // Default test dispatch without custom adapter
    const defaultRes = await dispatchClaimVerificationCode({
      phone: "9876543210",
      otp: "654321",
    });
    assert.equal(defaultRes.ok, true);
    assert.equal(defaultRes.status, "sent");
    assert.equal(defaultRes.provider, "synthetic-test-channel");
  } finally {
    resetClaimDeliveryAdapterForTest();
    process.env = originalEnv;
  }
});

test("dispatchClaimVerificationCode in production returns unconfigured when provider is missing or incomplete", async () => {
  const originalEnv = { ...process.env };
  try {
    process.env.NODE_ENV = "production";
    delete process.env.CLAIM_SMS_PROVIDER;

    const res = await dispatchClaimVerificationCode({
      phone: "9876543210",
      otp: "123456",
    });
    assert.equal(res.ok, false);
    assert.equal(res.status, "unconfigured");
    assert.match(res.error, /not configured/);
  } finally {
    process.env = originalEnv;
  }
});
