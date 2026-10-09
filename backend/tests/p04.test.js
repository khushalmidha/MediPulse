import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { amountToMinor, fromMinor, fingerprint, requestKey } from "../util/money.js";
import { financialEffects } from "../services/virtualLedger.js";
import { moneyTransaction } from "../services/moneyTransaction.js";
import { paymentGateway } from "../services/paymentGateway.js";
import { buildTxnQuery } from "../controller/virtualPayment.js";
test("demo credit amounts retain exact hundredths and reject invalid or lossy input", () => {
  for (const value of ["0.01", 0.01, 19.99, "10.10"]) assert.equal(fromMinor(amountToMinor(value)), Number(value));
  for (const value of [0, -1, NaN, Infinity, 1.001, "1.001", "1e3", true, {}, null, "", 1e12]) assert.throws(() => amountToMinor(value));
  assert.equal(amountToMinor(0, { zero: true }), 0);
});
test("persistent request keys are validated and fingerprints ignore property order", () => {
  assert.equal(requestKey("valid-request-key"), "valid-request-key");
  for (const key of ["", "bad key!", [], "x".repeat(129)]) assert.throws(() => requestKey(key));
  assert.equal(fingerprint({ a: 1, b: 2 }), fingerprint({ b: 2, a: 1 }));
});
test("financial post-commit delivery failures preserve success and run later effects", async (t) => {
  t.mock.method(console, "error", () => {}); let ran = false;
  await assert.doesNotReject(financialEffects(async () => { throw new Error("synthetic outage"); }, async () => { ran = true; }));
  assert.equal(ran, true);
});
test("first-wallet/index duplicate races restart the whole transaction and close sessions", async (t) => {
  let sessions = 0, closed = 0;
  t.mock.method(mongoose, "startSession", async () => { sessions++; return { withTransaction: async (fn) => fn(), endSession: async () => { closed++; } }; });
  let calls = 0;
  assert.equal(await moneyTransaction(async () => { if (++calls === 1) throw Object.assign(new Error("collision"), { code: 11000 }); return "committed"; }), "committed");
  assert.equal(sessions, 2); assert.equal(closed, 2);
});
test("transaction business failures propagate with session cleanup", async (t) => {
  let closed = false;
  t.mock.method(mongoose, "startSession", async () => ({ withTransaction: async (fn) => fn(), endSession: async () => { closed = true; } }));
  await assert.rejects(moneyTransaction(async () => { throw new Error("synthetic rollback"); }), /rollback/);
  assert.equal(closed, true);
});
test("gateway contract exposes only the demo adapter and refuses real collection", () => {
  assert.equal(paymentGateway().collectsRealMoney, false);
  assert.equal(typeof paymentGateway().refund, "function");
  assert.throws(() => paymentGateway("real"), /not configured/);
});
test("transaction search retains the authenticated account's ownership filter", () => {
  const owner = "000000000000000000000001";
  const query = buildTxnQuery({ userId: owner, userRole: "user", query: { search: "TXN" } });
  assert.equal(query.$or.length, 2);
  assert.equal(String(query.$or[0].senderId), owner); assert.equal(query.$or[0].senderRole, "user");
  assert.equal(String(query.$or[1].receiverId), owner); assert.equal(query.$or[1].receiverRole, "user");
  assert.equal(query.$and[0].$or.length, 3);
});
