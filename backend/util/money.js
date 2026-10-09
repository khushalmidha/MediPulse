import crypto from "node:crypto";
export const moneyError = (status, message) => Object.assign(new Error(message), { status });
// Integer hundredths of demo INR credits. Never silently round request input.
export const amountToMinor = (value, { zero = false, legacy = false } = {}) => {
  if (!["number", "string"].includes(typeof value) || (typeof value === "string" && !/^\d+(?:\.\d{1,2})?$/.test(value))) throw moneyError(400, "Amount must have at most two decimal places");
  const scaled = Number(value) * 100, minor = Math.round(scaled);
  if (!Number.isFinite(scaled) || !Number.isSafeInteger(minor) || minor > 1e12 || minor < (zero ? 0 : 1)
    || Math.abs(scaled - minor) > (legacy ? 0.00001 : Number.EPSILON * Math.max(1, Math.abs(scaled)) * 4)) throw moneyError(400, "Invalid demo credit amount or precision");
  return minor;
};
export const fromMinor = (minor) => minor / 100;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
export const fingerprint = (value) => crypto.createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex");
export const requestKey = (value) => {
  if (typeof value !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(value)) throw moneyError(400, "A valid Idempotency-Key or requestId is required");
  return value;
};
