import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { buildIceCredentials } from "../services/turnCredentials.js";
import { consultationDurationMs, consultationDeadline } from "../services/consultationPolicy.js";
import { sealSecret, openSecret, mailConfigured } from "../services/outbox.js";
import { sanitizeAnalyticsPayload } from "../services/virtualConsumers.js";
import { createSnapshotGuard } from "../../frontend/src/utils/queueSnapshot.js";
import { sendAppointmentOtpMail } from "../util/mailer.js";

test("secret outbox bodies are authenticated ciphertext and excluded from analytics", () => {
  const body = { otp: "123456", to: "fixture@example.invalid" }, sealed = sealSecret(body);
  assert.doesNotMatch(sealed, /123456|fixture/); assert.deepEqual(openSecret(sealed), body);
  const corrupted = Buffer.from(sealed, "base64"); corrupted[30] ^= 1;
  assert.throws(() => openSecret(corrupted.toString("base64")));
  assert.deepEqual(sanitizeAnalyticsPayload({ ...body, password: "private", metadata: body, amountMinor: 20, demo: true }), { amountMinor: 20, demo: true });
});
test("mail disabled is an explicit failure and cannot report an OTP as sent", async () => {
  assert.equal(mailConfigured(), false);
  await assert.rejects(sendAppointmentOtpMail({ to: "fixture@example.invalid", otp: "123456" }), /disabled/);
});
test("online deadlines are configurable and in-person/manual visits never get forced deadlines", t => {
  t.after(() => delete process.env.CONSULTATION_DURATION_MINUTES);
  delete process.env.CONSULTATION_DURATION_MINUTES;
  assert.equal(consultationDurationMs(), 0); assert.equal(consultationDeadline({ visitMode: "online" }), null);
  process.env.CONSULTATION_DURATION_MINUTES = "30";
  assert.equal(consultationDeadline({ visitMode: "online" }, new Date(0)).getTime(), 1800000);
  assert.equal(consultationDeadline({ visitMode: "in_person" }), null);
  process.env.CONSULTATION_DURATION_MINUTES = "-1"; assert.throws(consultationDurationMs);
});
test("TURN credentials are short-lived participant-bound HMAC credentials", t => {
  const keys = ["TURN_SHARED_SECRET", "TURN_URLS", "TURN_CREDENTIAL_TTL_SECONDS", "STUN_URLS"];
  t.after(() => keys.forEach(key => delete process.env[key]));
  process.env.TURN_SHARED_SECRET = "synthetic-turn-key"; process.env.TURN_URLS = "turn:relay.example.invalid:3478";
  process.env.TURN_CREDENTIAL_TTL_SECONDS = "600"; process.env.STUN_URLS = "";
  const result = buildIceCredentials("patient", "visit", 1000000), turn = result.iceServers[0];
  assert.equal(turn.username, "1600:patient:visit");
  assert.equal(turn.credential, crypto.createHmac("sha1", "synthetic-turn-key").update(turn.username).digest("base64"));
  assert.doesNotMatch(JSON.stringify(result), /synthetic-turn-key/);
  assert.notEqual(buildIceCredentials("doctor", "visit", 1000000).iceServers[0].credential, turn.credential);
  process.env.TURN_CREDENTIAL_TTL_SECONDS = "86400"; assert.throws(() => buildIceCredentials("patient", "visit"));
});
test("queue guard rejects reversed responses, regressed revisions and previous contexts", () => {
  const guard = createSnapshotGuard(), first = guard.begin("one"), second = guard.begin("one");
  assert.equal(guard.accept(second, { queueRevision: 4 }), true); assert.equal(guard.accept(first, { queueRevision: 3 }), false);
  assert.equal(guard.accept(guard.begin("one"), { queueRevision: 2 }), false);
  const old = guard.begin("one"), newer = guard.begin("two");
  assert.equal(guard.accept(old, { queueRevision: 999 }), false); assert.equal(guard.accept(newer, { queueRevision: 1 }), true);
  guard.reset(); assert.equal(guard.accept(newer, { queueRevision: 4 }), false);
});

test("automatic queue changes accept the new queue revision without admitting late old responses", () => {
  const guard = createSnapshotGuard(), first = guard.begin("");
  assert.equal(guard.accept(first, { queueKey: "morning", queueRevision: 50 }), true);
  const pending = guard.begin(""), next = guard.begin("");
  assert.equal(guard.accept(next, { queueKey: "evening", queueRevision: 1 }), true);
  assert.equal(guard.accept(pending, { queueKey: "morning", queueRevision: 51 }), false);
  assert.equal(guard.accept(guard.begin(""), { queueKey: "evening", queueRevision: 0 }), false);
});
