import mongoose from "mongoose";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
import { inspectMoneyMigration, applyMoneyMigration, rollbackMoneyMigration } from "../services/moneyMigration.js";
try {
  const uri = requireDatabaseUrl(), target = new URL(uri);
  const isolated = target.protocol === "mongodb:" && ["localhost", "127.0.0.1", "[::1]", "mongo"].includes(target.hostname)
    && /^\/medipulse_test(?:_[a-zA-Z0-9_]+)?$/.test(target.pathname) && !target.username && !target.password;
  const mutates = process.argv.includes("--apply") || process.argv.includes("--rollback");
  if (mutates && !isolated && (process.env.MONEY_MIGRATION_APPROVED !== "true" || process.env.MONEY_WRITES_PAUSED !== "true")) throw new Error();
  await mongoose.connect(uri, { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  if (process.argv.includes("--rollback")) { await rollbackMoneyMigration(mongoose.connection, process.argv[process.argv.indexOf("--rollback") + 1]); console.log("Ledger recovery completed"); }
  else {
    const plan = await inspectMoneyMigration(); console.log(JSON.stringify({ mode: mutates ? "apply" : "dry-run", ...plan.summary }));
    if (plan.issues.length) process.exitCode = 1;
    else if (mutates) console.log(`Ledger migration completed; recovery run ${await applyMoneyMigration(mongoose.connection, plan)}`);
  }
} catch { console.error("Ledger migration requires reviewed correction/approval; no private details printed"); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
