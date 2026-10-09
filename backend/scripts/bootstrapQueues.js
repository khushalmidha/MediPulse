import { requireDatabaseUrl } from "../util/databaseConfig.js";

let mongoose;
// Local empty databases only. Existing visits always require the reviewed migration.
try {
  const target = new URL(requireDatabaseUrl());
  if (target.protocol !== "mongodb:" || !["mongo", "127.0.0.1", "localhost", "[::1]"].includes(target.hostname)
    || !/^\/medipulse_(?:dev|test(?:_[a-zA-Z0-9_]+)?)$/.test(target.pathname) || target.username || target.password) throw new Error();
  mongoose = (await import("mongoose")).default;
  const { queueModels, assertQueueIndexes, inspectQueueMigration, applyQueueMigration } = await import("../services/queueMigration.js");
  await mongoose.connect(target.href, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  let current = false;
  try { await assertQueueIndexes(); current = true; } catch { /* Check empty legacy schema below. */ }
  if (!current) {
    if ((await Promise.all(queueModels.map((model) => model.countDocuments({})))).some(Boolean)) throw new Error();
    let writerRunning = false;
    try { await fetch(process.env.API_PROBE_URL || "http://backend:8080/health/live", { signal: AbortSignal.timeout(1500) }); writerRunning = true; }
    catch { /* A fresh stack has no API yet. */ }
    if (writerRunning) throw new Error();
    const plan = await inspectQueueMigration();
    await applyQueueMigration(mongoose.connection, plan);
    await assertQueueIndexes();
  }
  const { moneyModels, assertMoneyReady, inspectMoneyMigration, applyMoneyMigration } = await import("../services/moneyMigration.js");
  let moneyReady = false;
  try { await assertMoneyReady(); moneyReady = true; } catch { /* Empty schema only. */ }
  if (!moneyReady) {
    if ((await Promise.all(moneyModels.map((model) => model.countDocuments({})))).some(Boolean)) throw new Error();
    let writerRunning = false;
    try { await fetch(process.env.API_PROBE_URL || "http://backend:8080/health/live", { signal: AbortSignal.timeout(1500) }); writerRunning = true; } catch {}
    if (writerRunning) throw new Error();
    await applyMoneyMigration(mongoose.connection, await inspectMoneyMigration());
    await assertMoneyReady();
  }
  const { authModels, assertAuthSchema, applyAuthSchema } = await import("../services/authSchema.js");
  let authReady = false;
  try { await assertAuthSchema(); authReady = true; } catch {}
  if (!authReady) {
    if ((await Promise.all(authModels.map(model => model.countDocuments({})))).some(Boolean)) throw new Error();
    let writerRunning = false;
    try { await fetch(process.env.API_PROBE_URL || "http://backend:8080/health/live", { signal: AbortSignal.timeout(1500) }); writerRunning = true; } catch {}
    if (writerRunning) throw new Error();
    await applyAuthSchema();
  }
  const { durableModels, assertDurableSchema, applyDurableSchema } = await import("../services/durableSchema.js");
  let durableReady = false;
  try { await assertDurableSchema(); durableReady = true; } catch {}
  if (!durableReady) {
    if ((await Promise.all(durableModels.map(model => model.countDocuments({})))).some(Boolean)) throw new Error();
    let writerRunning = false;
    try { await fetch(process.env.API_PROBE_URL || "http://backend:8080/health/live", { signal: AbortSignal.timeout(1500) }); writerRunning = true; } catch {}
    if (writerRunning) throw new Error();
    await applyDurableSchema();
  }
  const Domain = (await import("../model/hospitalDomain.js")).default;
  await Domain.createIndexes();
  const { assertSchedulingSchema, applySchedulingSchema } = await import("../services/schedulingSchema.js");
  const { schedulingModels } = await import("../model/scheduling.js");
  try { await assertSchedulingSchema(); } catch {
    if ((await Promise.all(schedulingModels.map(model => model.countDocuments({})))).some(Boolean)) throw new Error();
    let writerRunning = false;
    try { await fetch(process.env.API_PROBE_URL || "http://backend:8080/health/live", { signal: AbortSignal.timeout(1500) }); writerRunning = true; } catch {}
    if (writerRunning) throw new Error();
    await applySchedulingSchema();
  }
  console.log("Local queue, demo ledger, auth, durable workflow and scheduling schema ready");
} catch { console.error("Local bootstrap refused: stop existing API/consumer first; nonempty queues require the reviewed migration"); process.exitCode = 1; }
finally { await mongoose?.disconnect(); }
