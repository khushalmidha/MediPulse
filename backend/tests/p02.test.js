import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { createServer } from "node:http";
import { once } from "node:events";
import { localTestTargets } from "../util/testTargets.js";
import { assertRuntimeConfig } from "../util/runtimeEnv.js";
import { assertMongoTransactions, attachHealthRoutes, checkDependencies } from "../services/readiness.js";
import { consumerTopics, runVirtualConsumers } from "../services/virtualConsumers.js";
import { usesRealRedis } from "../services/redis.js";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("integration targets reject deployment databases, implicit URLs and shared Redis DB", () => {
  const valid = { TEST_DATABASE_URL: "mongodb://127.0.0.1:27017/medipulse_test?replicaSet=rs0", TEST_REDIS_URL: "redis://localhost:6379/15" };
  assert.equal(localTestTargets(valid).mongo, valid.TEST_DATABASE_URL);
  for (const url of ["mongodb://127.0.0.1:27017/medipulse", "mongodb://example.invalid/medipulse_test", "mongodb+srv://example.invalid/medipulse_test"]) {
    assert.throws(() => localTestTargets({ ...valid, TEST_DATABASE_URL: url }));
  }
  assert.throws(() => localTestTargets({ ...valid, TEST_REDIS_URL: "redis://localhost:6379/0" }));
  assert.throws(() => localTestTargets({ DATABASE_URL: valid.TEST_DATABASE_URL }));
});

test("legacy test utilities reject implicit production and provider configuration before external IO", () => {
  const run = (file, env) => {
    try { execFileSync(process.execPath, [fileURLToPath(new URL(file, import.meta.url))], {
      env: { ...process.env, ...env }, encoding: "utf8", timeout: 10000, stdio: ["ignore", "pipe", "pipe"],
    }); assert.fail("Utility should require explicit isolated configuration"); }
    catch (error) { assert.equal(error.status, 1); return String(error.stderr); }
  };
  assert.match(run("../testVirtualLedger.js", { TEST_DATABASE_URL: "mongodb://fixture.invalid/production", TEST_REDIS_URL: "redis://localhost:6379/15" }), /local MongoDB/);
  assert.match(run("../test-gemini.js", { ALLOW_PROVIDER_TEST: "false", TEST_GEMINI_API_KEY: "" }), /Provider test requires/);
});

test("startup rejects absent DB/key/invalid port and production always selects real Redis", () => {
  const env = { DATABASE_URL: "mongodb://localhost:27017/medipulse_dev", TOKEN_KEY: "synthetic-long-test-key" };
  assert.doesNotThrow(() => assertRuntimeConfig(env));
  assert.throws(() => assertRuntimeConfig({ ...env, TOKEN_KEY: "" }));
  assert.throws(() => assertRuntimeConfig({ ...env, PORT: "99999" }));
  assert.equal(usesRealRedis({ NODE_ENV: "production", USE_REAL_REDIS: "false" }), true);
  assert.equal(usesRealRedis({ NODE_ENV: "development", USE_REAL_REDIS: "true" }), true);
});

test("transactions require connected writable replica set and reject a standalone database", async () => {
  const connection = (hello) => ({ readyState: 1, db: { admin: () => ({ command: async () => hello }) } });
  await assert.rejects(assertMongoTransactions(connection({ isWritablePrimary: true })));
  await assert.rejects(assertMongoTransactions(connection({ setName: "rs0", isWritablePrimary: false })));
  await assert.doesNotReject(assertMongoTransactions(connection({ setName: "rs0", isWritablePrimary: true })));
});

test("readiness degrades on a dependency failure and never serializes provider errors", async () => {
  const result = await checkDependencies({ mongo: async () => {}, redis: async () => {}, kafka: async () => { throw new Error("synthetic-private-provider-message"); },
    env: { USE_REAL_REDIS: "true", KAFKA_BROKERS: "fixture:9092", MAIL_DELIVERY: "disabled" } });
  assert.equal(result.ready, true); assert.equal(result.degraded, true); assert.equal(result.dependencies.kafka, "unavailable");
  assert.doesNotMatch(JSON.stringify(result), /synthetic-private/);
});

test("liveness remains available while readiness returns 503", async (t) => {
  const app = express(); attachHealthRoutes(app, async () => ({ ready: false, dependencies: { mongodb: "unavailable" } }));
  const server = createServer(app).listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await fetch(`${origin}/health/live`)).status, 200);
  const ready = await fetch(`${origin}/health/ready`); assert.equal(ready.status, 503); assert.equal(ready.headers.get("cache-control"), "no-store");
});

test("consumer creates topics before subscribing, reports group join, and disconnects failed startup", async (t) => {
  const oldBrokers = process.env.KAFKA_BROKERS, oldCreate = process.env.KAFKA_CREATE_TOPICS;
  process.env.KAFKA_BROKERS = "fixture:9092"; process.env.KAFKA_CREATE_TOPICS = "true";
  t.after(() => { process.env.KAFKA_BROKERS = oldBrokers; process.env.KAFKA_CREATE_TOPICS = oldCreate; });
  const calls = [], handlers = {};
  const admin = { connect: async () => calls.push("admin-connect"), createTopics: async ({ topics }) => {
    assert.deepEqual(topics.map((topic) => topic.topic), consumerTopics()); calls.push("topics-created");
  }, disconnect: async () => calls.push("admin-disconnect") };
  const consumer = { events: { GROUP_JOIN: "join", CRASH: "crash" }, on: (event, handler) => { handlers[event] = handler; },
    connect: async () => calls.push("consumer-connect"), subscribe: async () => calls.push("subscribe"),
    run: async () => calls.push("run"), disconnect: async () => calls.push("consumer-disconnect") };
  let ready = false; const kafka = { consumer: () => consumer, admin: () => admin };
  await runVirtualConsumers({ kafka, onReady: () => { ready = true; } });
  assert.equal(ready, false); handlers.join(); assert.equal(ready, true);
  assert.ok(calls.indexOf("topics-created") < calls.indexOf("consumer-connect"));
  consumer.subscribe = async () => { throw new Error("synthetic subscribe failure"); };
  await assert.rejects(runVirtualConsumers({ kafka }));
  assert.equal(calls.at(-1), "consumer-disconnect");
});
