import crypto from "node:crypto";
import Hospital from "../model/hospital.js";
import OpdToken from "../model/opdToken.js";
import Review from "../model/review.js";
import User from "../model/user.js";
import { sendReviewRequestMail } from "../util/mailer.js";
import { getRedis } from "./redis.js";

const reviewRequestQueueKey = "review:request:queue";
const REVIEW_DELAY_MS = 30 * 60 * 1000;
let workerStarted = false;

const reviewSecret = () => process.env.REVIEW_SIGNATURE_SECRET || process.env.TOKEN_KEY || "medipulse-review-secret";

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

  await getRedis().zadd(
    reviewRequestQueueKey,
    Date.now() + delayMs,
    JSON.stringify({ tokenId: String(tokenId), patientId: String(patientId), hospitalId: String(hospitalId) }),
  );
};

const processReviewRequest = async (rawJob) => {
  const job = JSON.parse(rawJob);
  const [existingReview, token, patient, hospital] = await Promise.all([
    Review.findOne({ tokenId: job.tokenId, patientId: job.patientId }).lean(),
    OpdToken.findById(job.tokenId).select("displayToken doctorId departmentId patientId").lean(),
    User.findById(job.patientId).select("firstName lastName email").lean(),
    Hospital.findById(job.hospitalId).select("name").lean(),
  ]);

  if (existingReview || !token || !patient?.email || String(token.patientId) !== String(job.patientId)) {
    return;
  }

  await sendReviewRequestMail({
    to: patient.email,
    patientName: `${patient.firstName || ""} ${patient.lastName || ""}`.trim(),
    hospitalName: hospital?.name || "your hospital",
    tokenDisplay: token.displayToken,
    reviewUrl: buildReviewUrl({ tokenId: job.tokenId, patientId: job.patientId }),
  });
};

export const startReviewRequestWorker = () => {
  if (workerStarted) return;
  workerStarted = true;

  const run = async () => {
    const redis = getRedis();
    const dueJobs = await redis.zrangebyscore(reviewRequestQueueKey, 0, Date.now(), "LIMIT", 0, 10);
    for (const job of dueJobs) {
      try {
        await processReviewRequest(job);
      } catch (error) {
        console.error("Review request worker failed:", error.message);
      } finally {
        await redis.zrem(reviewRequestQueueKey, job);
      }
    }
  };

  const interval = setInterval(() => run().catch((error) => console.error("Review worker tick failed:", error.message)), 60 * 1000);
  interval.unref?.();
  run().catch((error) => console.error("Review worker initial run failed:", error.message));
};
