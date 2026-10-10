import test from "node:test";
import assert from "node:assert/strict";
import { planDemoRecovery, applyDemoRecovery, restoreDemoRecovery, recoveryHash } from "../services/demoRecovery.js";

const fixture = () => ({ database: "medipulse_test_demo", tokens: [{ _id: "token-a", appointmentId: "appointment-a", status: "waiting" }],
  appointments: [{ _id: "appointment-a", status: "cancelled", payment: { amount: 123 } }], refunds: [{ _id: "refund-a", status: "COMPLETED", amount: 123 }],
  queue: { tokens: [{ _id: "token-a", appointmentId: "appointment-a", status: "waiting" }], appointments: [{ _id: "appointment-a", status: "cancelled", visitMode: "online" }], issues: ["linked_state_mismatch"] },
  money: { plans: [[], [], [], [{ _id: "appointment-a" }]], issues: ["invalid_refund_link"] } });

test("synthetic recovery preserves full originals and never rewrites cancelled visits or refund history", () => {
  const data = fixture(), before = structuredClone(data), plan = planDemoRecovery(data);
  assert.equal(plan.rows.length, 3); assert.deepEqual(data, before);
  for (const item of plan.rows) assert.equal(item.beforeHash, recoveryHash(item.original));
  assert.equal(plan.rows.find(row => row.original._id === "appointment-a").original.status, "cancelled");
  assert.equal(plan.rows.find(row => row.original._id === "refund-a").original.status, "COMPLETED");
});
test("invalid context archives its linked counterpart and keeps valid disconnected visits", () => {
  const data = fixture();
  data.tokens.push({ _id: "token-b", status: "completed" });
  data.queue.tokens = [{ _id: "token-b", status: "completed" }]; data.queue.issues = ["unresolvable_token_context"];
  data.refunds = []; data.money.issues = []; const plan = planDemoRecovery(data);
  assert.equal(plan.rows.length, 2);
  assert.ok(plan.rows.some(row => row.original._id === "appointment-a" && row.reasons.includes("linked_visit_preservation")));
  assert.ok(!plan.rows.some(row => row.original._id === "token-b"));
});
test("new concurrency or financial inconsistencies require review rather than automatic archival", () => {
  const data = fixture(); data.queue.issues.push("duplicate_live_patient");
  assert.throws(() => planDemoRecovery(data), /Unreviewed issue/);
  data.queue.issues = []; data.money.issues.push("invalid_wallet_amount");
  assert.throws(() => planDemoRecovery(data), /Unreviewed issue/);
});
test("recovery refuses mutation without each explicit preservation prerequisite", async () => {
  const plan = planDemoRecovery(fixture());
  for (const options of [{}, { syntheticConfirmed: true }, { syntheticConfirmed: true, writersPaused: true }, { syntheticConfirmed: "true", writersPaused: true, backupVerified: true }]) {
    await assert.rejects(applyDemoRecovery({}, plan, options), /Explicit synthetic-data/);
  }
  await assert.rejects(applyDemoRecovery({ name: "wrong_database" }, plan, { syntheticConfirmed: true, writersPaused: true, backupVerified: true }), /target mismatch/);
  await assert.rejects(restoreDemoRecovery({}, "invalid", { syntheticConfirmed: true, writersPaused: true }), /restoration/);
});
