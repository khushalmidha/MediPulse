/**
 * MediPulse Walk-in Claim Delivery Service
 * Manages phone verification SMS delivery contracts, provider dispatch, and delivery state tracking.
 */

let testDeliveryAdapter = null;

/**
 * Configure a test delivery adapter for isolated test suites.
 * Refuses execution outside of NODE_ENV === "test".
 */
export const setClaimDeliveryAdapterForTest = (adapter) => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Claim delivery test adapter is only permitted in test environment");
  }
  testDeliveryAdapter = adapter;
};

export const resetClaimDeliveryAdapterForTest = () => {
  testDeliveryAdapter = null;
};

/**
 * Dispatches a verification code to the trusted recorded phone.
 * If no approved provider is configured, returns status: 'unconfigured'.
 */
export const dispatchClaimVerificationCode = async ({
  phone,
  otp,
  encounterId,
  hospitalId,
  maskedPhone,
}) => {
  // 1. If a test adapter is explicitly installed (in test environment), execute it
  if (process.env.NODE_ENV === "test" && testDeliveryAdapter) {
    return testDeliveryAdapter({ phone, otp, encounterId, hospitalId, maskedPhone });
  }

  // 2. Default test mode behavior: simulated isolated test provider
  if (process.env.NODE_ENV === "test") {
    return {
      ok: true,
      status: "sent",
      provider: "synthetic-test-channel",
      dispatchedAt: new Date(),
    };
  }

  // 3. Real runtime: check if an owner-approved external SMS provider is configured
  const provider = process.env.CLAIM_SMS_PROVIDER;
  if (!provider || provider === "none") {
    return {
      ok: false,
      status: "unconfigured",
      provider: "unconfigured",
      error: "Walk-in phone verification delivery channel is not configured. Contact hospital reception for assistance.",
    };
  }

  // Future approved production provider dispatch (Twilio/AWS SNS/MSG91)
  // Currently no production provider is activated.
  return {
    ok: false,
    status: "unconfigured",
    provider,
    error: "Walk-in phone verification delivery provider is not activated.",
  };
};
