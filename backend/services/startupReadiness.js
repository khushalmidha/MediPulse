import { assertQueueIndexes } from "./queueMigration.js";
import { assertMoneyReady } from "./moneyMigration.js";
import { assertAuthSchema } from "./authSchema.js";
import { assertDurableSchema } from "./durableSchema.js";
import { assertSchedulingSchema } from "./schedulingSchema.js";
import { checkDependencies } from "./readiness.js";

const schemaChecks = { queue: assertQueueIndexes, ledger: assertMoneyReady, auth: assertAuthSchema, durable: assertDurableSchema, scheduling: assertSchedulingSchema };

// Read-only bootstrap checks. Index creation cannot substitute for reviewed data migrations.
export async function inspectStartupReadiness({ checks = schemaChecks, dependencies = checkDependencies } = {}) {
  const entries = Object.entries(checks);
  const outcomes = await Promise.allSettled(entries.map(([, check]) => check()));
  const schemas = Object.fromEntries(entries.map(([name], index) => [name, outcomes[index].status === "fulfilled" ? "ready" : "migration-required"]));
  const probe = async () => {
    let resources;
    try { resources = await dependencies(); }
    catch { resources = { ready: false, dependencies: { runtime: "unavailable" } }; }
    return { ...resources, ready: resources.ready && Object.values(schemas).every(status => status === "ready"), schemas };
  };
  return { initial: await probe(), probe };
}

export const requireStartupReady = readiness => (req, res, next) => {
  if (readiness.ready) return next();
  res.set("Cache-Control", "no-store").set("Retry-After", "60").status(503).json({ code: "SERVICE_NOT_READY", message: "Care services are undergoing maintenance. Please try again later." });
};
