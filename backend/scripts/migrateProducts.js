import mongoose from "mongoose";
import { readFile, writeFile } from "node:fs/promises";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
import { inspectProductMigration, applyProductMigration } from "../services/productMigration.js";
try {
  const args = process.argv.slice(2), apply = args.includes("--apply"), rollback = args.includes("--rollback"), index = args.indexOf("--backup"), backup = index >= 0 ? args[index + 1] : null;
  if (apply && rollback || (apply || rollback) && (!args.includes("--writers-paused") || !backup || backup.startsWith("--"))) throw new Error("Invalid arguments");
  await mongoose.connect(requireDatabaseUrl(), { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  const plan = rollback ? mongoose.mongo.BSON.EJSON.parse(await readFile(backup, "utf8")) : await inspectProductMigration();
  console.log(JSON.stringify({ task: "P07", changes: plan.rows.length, issues: plan.issues, warnings: plan.warnings }));
  if (plan.issues.length) throw new Error("Resolve migration conflicts first");
  if (apply) await writeFile(backup, mongoose.mongo.BSON.EJSON.stringify(plan), { flag: "wx", mode: 0o600 });
  if (apply || rollback) { await applyProductMigration(plan, rollback); console.log(rollback ? "P07 rollback completed" : "P07 migration completed; legacy domains require fresh verification"); }
} catch { console.error("P07 operation refused: check explicit target, conflicts, paused writers and private backup"); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
