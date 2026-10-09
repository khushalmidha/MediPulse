import { transferInSession, refundInSession } from "./virtualLedger.js";
// A future real gateway must provide durable provider request IDs, verification
// and reconciliation. Only the explicit demo adapter is selectable today.
export const paymentGateway = (provider = "demo") => {
  if (provider !== "demo") throw new Error("Real payment collection is not configured");
  return Object.freeze({ provider: "demo", collectsRealMoney: false, currency: "INR", charge: transferInSession, refund: refundInSession });
};
