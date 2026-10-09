import mongoose from "mongoose";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
import { inspectQueueMigration, applyQueueMigration, rollbackQueueMigration } from "../services/queueMigration.js";

// Explicit environment only: no .env loading, index synchronization or silent repair.
try {
  const uri = requireDatabaseUrl(), target = new URL(uri);
  const isolatedTest = target.protocol === "mongodb:" && ["localhost", "127.0.0.1", "[::1]", "mongo"].includes(target.hostname)
    && /^\/medipulse_test(?:_[a-zA-Z0-9_]+)?$/.test(target.pathname) && !target.username && !target.password;
  const mutates = process.argv.includes("--apply") || process.argv.includes("--rollback");
  if (mutates && !isolatedTest && (process.env.QUEUE_MIGRATION_APPROVED !== "true" || process.env.QUEUE_WRITES_PAUSED !== "true")) {
    throw new Error("Mutation requires reviewed approval and paused queue writers; use dry-run first");
  }
  await mongoose.connect(uri, { autoIndex: false, serverSelectionTimeoutMS: 5000 });
  if (process.argv.includes("--rollback")) {
    await rollbackQueueMigration(mongoose.connection, process.argv[process.argv.indexOf("--rollback") + 1]);
    console.log("Queue recovery completed");
  } else {
    const plan = await inspectQueueMigration();
    console.log(JSON.stringify({ mode: mutates ? "apply" : "dry-run", ...plan.summary }));
    if (plan.issues.length) process.exitCode = 1;
    else if (mutates) console.log(`Queue migration completed; recovery run ${await applyQueueMigration(mongoose.connection, plan)}`);
  }
} catch { console.error("Queue migration failed or requires reviewed correction/approval; no patient details printed"); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
