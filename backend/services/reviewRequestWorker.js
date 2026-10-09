import crypto from "node:crypto";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";
import Review from "../model/review.js";
import User from "../model/user.js";
import { sendReviewRequestMail } from "../util/mailer.js";
import { getRedis } from "./redis.js";
import { enqueueJob } from "./outbox.js";

const reviewRequestQueueKey = "review:request:queue";
const REVIEW_DELAY_MS = 30 * 60 * 1000;
let workerStarted = false;

const reviewSecret = () => process.env.REVIEW_SIGNATURE_SECRET || process.env.TOKEN_KEY;

export const signReviewRequest = ({ tokenId, patientId }) =>
  crypto.createHmac("sha256", reviewSecret()).update(`${tokenId}:${patientId}`).digest("base64url");

export const verifyReviewSignature = ({ tokenId, patientId, signature }) => {
  if (!tokenId || !patientId || !signature) return false;
  const expected = signReviewRequest({ tokenId, patientId });
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(String(signature));
  return expectedBuffer.length === receivedBuffer.length && crypto.timingSafeEqual(expectedBuffer, receivedBuffer);
};

export const buildReviewUrl = ({ tokenId, patientId }) => {
  const baseUrl = process.env.PUBLIC_CLIENT_URL || (process.env.CLIENT_URLS || "http://localhost:5173").split(",")[0];
  const sig = signReviewRequest({ tokenId, patientId });
  return `${baseUrl.replace(/\/$/, "")}/review?token=${tokenId}&patient=${patientId}&sig=${sig}`;
};

export const scheduleReviewRequest = async ({ tokenId, patientId, hospitalId, delayMs = REVIEW_DELAY_MS }) => {
  if (!tokenId || !patientId || !hospitalId) return;

  await enqueueJob({ id: `review:${tokenId}`, kind: "review.mail", payload: {
    tokenId: String(tokenId), patientId: String(patientId), hospitalId: String(hospitalId) }, availableAt: new Date(Date.now() + delayMs) });
};

export const processReviewRequest = async (job) => {
  const [existingReview, token, patient, hospital] = await Promise.all([
    Review.findOne({ tokenId: job.tokenId, patientId: job.patientId }).lean(),
    OpdToken.findById(job.tokenId).select("displayToken doctorId departmentId patientId hospitalId status").lean(),
    User.findById(job.patientId).select("firstName lastName email").lean(),
    Hospital.findById(job.hospitalId).select("name").lean(),
  ]);

  if (existingReview || !token || !patient?.email || token.status !== "completed" || String(token.hospitalId) !== String(job.hospitalId) || String(token.patientId) !== String(job.patientId)) {
    return { skipped: true };
  }

  await sendReviewRequestMail({
    to: patient.email,
    patientName: `${patient.firstName || ""} ${patient.lastName || ""}`.trim(),
    hospitalName: hospital?.name || "your hospital",
    tokenDisplay: token.displayToken,
    reviewUrl: buildReviewUrl({ tokenId: job.tokenId, patientId: job.patientId }),
  });
};

// Transfer legacy Redis jobs to Mongo before removing them. Delivery is owned by the outbox.
export const importLegacyReviewJobs = async () => {
  const redis = getRedis(), jobs = await redis.zrangebyscore(reviewRequestQueueKey, 0, Date.now(), "LIMIT", 0, 25);
  for (const raw of jobs) {
    const job = JSON.parse(raw);
    if (!job.tokenId || !job.patientId || !job.hospitalId) throw new Error("Invalid legacy review job requires operator review");
    await scheduleReviewRequest({ ...job, delayMs: 0 });
    await redis.zrem(reviewRequestQueueKey, raw);
  }
};
export const startReviewRequestWorker = () => {
  if (workerStarted) return () => {};
  workerStarted = true; let running = false;
  const tick = async () => { if (running) return; running = true;
    try { await importLegacyReviewJobs(); } catch { console.error("Legacy review import needs retry"); } finally { running = false; } };
  const interval = setInterval(tick, 60000); interval.unref?.(); void tick();
  return () => { clearInterval(interval); workerStarted = false; };
};
