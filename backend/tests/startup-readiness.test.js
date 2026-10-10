import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
import { assertRuntimeConfig } from "../util/runtimeEnv.js";
import { inspectStartupReadiness, requireStartupReady } from "../services/startupReadiness.js";
import { attachHealthRoutes } from "../services/readiness.js";

test("runtime uses the owner-selected medipulse only for an omitted database path", () => {
  const env = { MONGODB_URI: ' MONGODB_URI="mongodb+srv://fixture.invalid/?retryWrites=true&w=majority" ', JWT_SECRET: "synthetic-startup-test-signing-key" };
  assertRuntimeConfig(env);
  assert.equal(env.DATABASE_URL, "mongodb+srv://fixture.invalid/medipulse?retryWrites=true&w=majority");
  assert.equal(env.TOKEN_KEY, env.JWT_SECRET);
  assert.equal(requireDatabaseUrl({ DATABASE_URL: "mongodb://localhost:27017/existing" }), "mongodb://localhost:27017/existing");
  assert.throws(() => requireDatabaseUrl({ DATABASE_URL: "mongodb://localhost:27017/" }));
  assert.equal(requireDatabaseUrl({ DATABASE_URL: "mongodb://fixture-user:fixture-pass@localhost:27017/?replicaSet=rs0" }, { defaultDatabaseName: "medipulse" }), "mongodb://fixture-user:fixture-pass@localhost:27017/medipulse?replicaSet=rs0&authSource=admin");
  assert.equal(requireDatabaseUrl({ DATABASE_URL: "mongodb://fixture-user:fixture-pass@localhost:27017/?authSource=existing" }, { defaultDatabaseName: "medipulse" }), "mongodb://fixture-user:fixture-pass@localhost:27017/medipulse?authSource=existing");
});
test("database errors distinguish absent configuration and never echo credentials", () => {
  assert.throws(() => requireDatabaseUrl({}), /is missing/);
  assert.throws(() => requireDatabaseUrl({ DATABASE_URL: "mongodb+srv://synthetic-user:synthetic-private@fixture.invalid/" }), error => /explicit database/.test(error.message) && !/synthetic-private|fixture.invalid/.test(error.message));
});
test("schema failures remain visible and dependency failure cannot report ready", async () => {
  const startup = await inspectStartupReadiness({ checks: { queue: async () => { throw new Error("private record details"); }, auth: async () => {} }, dependencies: async () => ({ ready: true, dependencies: { mongodb: "ready" } }) });
  assert.equal(startup.initial.ready, false); assert.equal(startup.initial.schemas.queue, "migration-required");
  assert.doesNotMatch(JSON.stringify(startup.initial), /private record details/);
  const unavailable = await inspectStartupReadiness({ checks: { queue: async () => {} }, dependencies: async () => { throw new Error("private provider connection"); } });
  assert.equal(unavailable.initial.ready, false);
});
test("health stays available while care requests return 503 and execute no writes", async t => {
  const startup = await inspectStartupReadiness({ checks: { ledger: async () => { throw new Error(); } }, dependencies: async () => ({ ready: true, dependencies: {} }) });
  const app = express(); let writes = 0;
  attachHealthRoutes(app, startup.probe); app.use(requireStartupReady(startup.initial));
  app.post("/appointment", (req, res) => { writes++; res.json({ created: true }); });
  const server = createServer(app).listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(origin + "/health/live")).status, 200);
  assert.equal((await fetch(origin + "/health/ready")).status, 503);
  const denied = await fetch(origin + "/appointment", { method: "POST" });
  assert.equal(denied.status, 503); assert.equal(denied.headers.get("cache-control"), "no-store"); assert.equal(writes, 0);
  assert.equal((await denied.json()).code, "SERVICE_NOT_READY");
});
test("ready startup permits care and probes current dependency health", async () => {
  let available = true;
  const startup = await inspectStartupReadiness({ checks: { queue: async () => {} }, dependencies: async () => ({ ready: available, dependencies: {} }) });
  let next = 0; requireStartupReady(startup.initial)({}, {}, () => { next++; }); assert.equal(next, 1);
  available = false; assert.equal((await startup.probe()).ready, false);
});
test("startup contains no best-effort index creation or swallowed schema checks", async () => {
  const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
  const connection = await readFile(new URL("../connection.js", import.meta.url), "utf8");
  assert.match(connection, /autoIndex:\s*false/);
  assert.match(connection, /autoCreate:\s*false/);
  assert.doesNotMatch(source, /createIndexes\(|applyAuthSchema|applyDurableSchema|applySchedulingSchema/);
  assert.match(source, /readiness\.ready \? initSocket/);
  for (const worker of ["startPaymentRecoveryWorker", "startAutoRefundWorker", "startScheduleExpiryWorker", "startReviewRequestWorker", "startOutboxWorker"]) assert.match(source, new RegExp("readiness\\.ready \\? " + worker));
});
