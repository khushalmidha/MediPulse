import crypto from "node:crypto";
import OutboxJob from "../model/outboxJob.js";
const key = () => {
  if (!process.env.TOKEN_KEY) throw new Error("Outbox encryption key is required");
  return crypto.createHash("sha256").update(`medipulse-outbox-v1:${process.env.TOKEN_KEY}`).digest();
};
export const sealSecret = value => {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64");
};
export const openSecret = value => {
  const buf = Buffer.from(value, "base64"), cipher = crypto.createDecipheriv("aes-256-gcm", key(), buf.subarray(0, 12));
  cipher.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(buf.subarray(28)), cipher.final()]).toString("utf8"));
};
export const enqueueJob = async ({ id, kind, payload = {}, secret, availableAt = new Date(), expiresAt }, session) => {
  if (!id || !kind) throw new Error("A durable job needs an identity and kind");
  await OutboxJob.updateOne({ _id: id }, { $setOnInsert: { kind, payload, ...(secret ? { secret: sealSecret(secret) } : {}),
    availableAt, ...(expiresAt ? { expiresAt } : {}), state: "pending", attempts: 0 } }, { upsert: true, session });
  return id;
};
export const claimJob = async ({ now = new Date(), leaseMs = 120000 } = {}) => OutboxJob.findOneAndUpdate({ $or: [
  { state: "pending", availableAt: { $lte: now } }, { state: "processing", leaseUntil: { $lte: now } },
] }, { $set: { state: "processing", leaseToken: crypto.randomUUID(), leaseUntil: new Date(now.getTime() + leaseMs) }, $inc: { attempts: 1 } },
{ new: true, sort: { availableAt: 1, _id: 1 } }).select("+secret");
export const runOutboxBatch = async (deliver, { now = () => new Date(), limit = 10, leaseMs = 120000, maxAttempts = 8 } = {}) => {
  const counts = { delivered: 0, retried: 0, failed: 0, skipped: 0 };
  for (let i = 0; i < limit; i++) {
    const job = await claimJob({ now: now(), leaseMs });
    if (!job) break;
    const owned = () => ({ _id: job._id, state: "processing", leaseToken: job.leaseToken, leaseUntil: { $gt: now() } });
    // Renew long deliveries; a recovered lease never lets the old worker overwrite its successor.
    const heartbeat = setInterval(() => { OutboxJob.updateOne(owned(), { $set: { leaseUntil: new Date(now().getTime() + leaseMs) } }).catch(() => {}); }, Math.max(100, Math.floor(leaseMs / 3)));
    heartbeat.unref?.();
    try {
      if (job.attempts > maxAttempts) throw new Error("Lease recovery exceeded retry limit");
      const expired = job.expiresAt && job.expiresAt <= now();
      const result = expired ? { skipped: true } : await deliver(job);
      const state = result?.skipped ? "skipped" : "delivered";
      const saved = await OutboxJob.updateOne(owned(), { $set: { state, deliveredAt: now() }, $unset: { secret: "", leaseToken: "", leaseUntil: "", lastError: "" } });
      if (saved.modifiedCount) counts[state]++;
    } catch {
      // Never persist provider error text: it can contain addresses, OTPs, URLs or credentials.
      const failed = job.attempts >= maxAttempts, state = failed ? "failed" : "pending";
      const delay = Math.min(3600000, 1000 * 2 ** Math.min(job.attempts, 12));
      const saved = await OutboxJob.updateOne(owned(), { $set: { state, lastError: "delivery_failed", availableAt: new Date(now().getTime() + delay) }, $unset: { leaseToken: "", leaseUntil: "" } });
      if (saved.modifiedCount) counts[failed ? "failed" : "retried"]++;
    } finally { clearInterval(heartbeat); }
  }
  return counts;
};
export const startOutboxWorker = (deliver) => {
  let running = false, stopped = false;
  const tick = async () => { if (running || stopped) return; running = true;
    try {
      await OutboxJob.updateMany({ expiresAt: { $lte: new Date() }, secret: { $exists: true }, state: { $ne: "processing" } }, { $unset: { secret: "" } });
      await runOutboxBatch(deliver); } catch { console.error("Durable delivery worker needs retry"); } finally { running = false; } };
  const timer = setInterval(tick, 1000); timer.unref?.(); void tick();
  return async () => { stopped = true; clearInterval(timer); while (running) await new Promise(resolve => setTimeout(resolve, 50)); };
};

export const mailConfigured = () => process.env.MAIL_DELIVERY !== "disabled" && Boolean(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY || ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"].every(key => process.env[key]));
