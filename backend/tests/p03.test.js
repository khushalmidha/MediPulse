import test from "node:test";
import assert from "node:assert/strict";
import { localServiceDate, queueContext, patientKey } from "../services/queueContext.js";
import { bookingRequest, nextTokenNumber } from "../services/queueBooking.js";
import OpdSequence from "../model/opdSequence.js";
import { afterVisitCommit } from "../services/visitTransitions.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("hospital dates use configured timezone at midnight and across DST", () => {
  assert.equal(localServiceDate(new Date("2026-10-08T18:29:59Z"), "Asia/Kolkata"), "2026-10-08");
  assert.equal(localServiceDate(new Date("2026-10-08T18:30:00Z"), "Asia/Kolkata"), "2026-10-09");
  assert.equal(localServiceDate(new Date("2026-11-01T03:59:59Z"), "America/New_York"), "2026-10-31");
  assert.equal(localServiceDate(new Date("2026-11-01T04:00:00Z"), "America/New_York"), "2026-11-01");
  assert.throws(() => localServiceDate(new Date(), "unknown/timezone"));
});
test("queues isolate practices/dates/configured sessions and patients distinguish owned family", () => {
  const now = new Date("2026-10-09T02:00:00Z");
  const hospital = { _id: "hospital", settings: { timezone: "Asia/Kolkata", queueSessionIds: ["morning", "evening"] } };
  const first = queueContext({ hospital, doctorId: "doctor", now });
  assert.notEqual(first.queueKey, queueContext({ doctorId: "doctor", now }).queueKey);
  assert.notEqual(first.queueKey, queueContext({ hospital, doctorId: "doctor", sessionId: "evening", now }).queueKey);
  assert.throws(() => queueContext({ hospital, doctorId: "doctor", sessionId: "arbitrary", now }));
  assert.throws(() => queueContext({ hospital, doctorId: "doctor", serviceDate: "2026-02-30", now, historical: true }));
  assert.notEqual(patientKey("account"), patientKey("account", "child"));
});
test("explicit retry fingerprint is stable over inferred midnight date and rejects malformed keys", () => {
  const req = { auth: { id: "patient" }, body: {}, headers: { "idempotency-key": "stable-retry-key" } };
  const context = { queueKey: "queue-today" };
  const one = bookingRequest(req, "opd", context, "self", { doctorId: "doctor" });
  const two = bookingRequest(req, "opd", { queueKey: "queue-tomorrow" }, "self", { doctorId: "doctor" });
  assert.equal(one.fingerprint, two.fingerprint);
  assert.throws(() => bookingRequest({ ...req, headers: { "idempotency-key": "bad key" } }, "opd", context, "self", {}));
  assert.throws(() => bookingRequest({ staff: { id: "staff" }, body: {} }, "opd", context, "walkin", {}), { status: 428 });
});
test("atomic first counter upsert retries E11000 and propagates other failures", async (t) => {
  let calls = 0;
  t.mock.method(OpdSequence, "findOneAndUpdate", async () => { if (++calls === 1) throw Object.assign(new Error("synthetic collision"), { code: 11000 }); return { seq: 2 }; });
  assert.equal(await nextTokenNumber({ queueKey: "fixture", serviceDate: "2026-10-09", sessionId: "day" }, "hospital", "doctor"), 2);
  assert.equal(calls, 2);
  t.mock.method(OpdSequence, "findOneAndUpdate", async () => { throw new Error("synthetic dependency failure"); });
  await assert.rejects(nextTokenNumber({ queueKey: "fixture", serviceDate: "2026-10-09", sessionId: "day" }, "hospital", "doctor"), /synthetic dependency failure/);
});
test("failed cache/event effects cannot change a committed visit result", async (t) => {
  t.mock.method(console, "error", () => {});
  let secondRan = false;
  await assert.doesNotReject(afterVisitCommit(async () => { throw new Error("synthetic cache outage"); }, async () => { secondRan = true; }));
  assert.equal(secondRan, true);
});
test("empty-schema bootstrap refuses a nonlocal deployment URI before connecting", () => {
  try {
    execFileSync(process.execPath, [fileURLToPath(new URL("../scripts/bootstrapQueues.js", import.meta.url))], {
      env: { ...process.env, DATABASE_URL: "mongodb://fixture.invalid/medipulse_dev" }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10000,
    }); assert.fail("Deployment bootstrap must be refused");
  } catch (error) { assert.equal(error.status, 1); assert.match(String(error.stderr), /bootstrap refused/); }
});
