/**
 * Billing Provider Integration Interface (P17)
 *
 * Prepared modular interface for Stripe, Razorpay, or national payment gateways.
 * Keeps production payment activation explicitly pending until the launch country
 * and certified merchant provider are confirmed.
 */

export const BILLING_PROVIDER_STATUS = {
  PENDING_CONFIGURATION: "pending_configuration",
  READY_FOR_ACTIVATION: "ready_for_activation",
  ACTIVE: "active",
};

export const getBillingProviderConfig = () => {
  const provider = process.env.SAAS_BILLING_PROVIDER || "unspecified";
  const country = process.env.SAAS_LAUNCH_COUNTRY || "IN";

  return {
    provider,
    country,
    status: BILLING_PROVIDER_STATUS.PENDING_CONFIGURATION,
    supportedCurrencies: country === "IN" ? ["INR"] : ["USD", "EUR"],
    paymentMethods: ["card", "netbanking", "upi", "bank_transfer"],
    activationNotice:
      "Production SaaS subscription billing is awaiting certified gateway activation for launch jurisdiction. Simulated trial entitlements remain active.",
  };
};

export const createSubscriptionCheckoutSession = async ({ hospitalId, plan, billingCycle = "monthly" }) => {
  const config = getBillingProviderConfig();

  // Return compliant pending interface
  return {
    checkoutPending: true,
    hospitalId,
    plan,
    billingCycle,
    currency: config.supportedCurrencies[0],
    provider: config.provider,
    message: config.activationNotice,
    provisionalActivation: true,
  };
};

export const handleBillingWebhook = async (rawPayload, signature) => {
  // Safe mock stub until provider secrets are provisioned
  return {
    processed: false,
    reason: "Awaiting provider webhook secret provisioning",
    receivedSignature: Boolean(signature),
  };
};
