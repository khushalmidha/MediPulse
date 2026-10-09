import mongoose from "mongoose";
import { readFile, writeFile } from "node:fs/promises";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
import { inspectSchedulingSchema, applySchedulingSchema, rollbackSchedulingSchema } from "../services/schedulingSchema.js";
try {
  const args = process.argv.slice(2);
  if (!args.includes("--explicit-target")) throw new Error("Explicit target required");
  const apply = args.includes("--apply"), rollback = args.includes("--rollback"), index = args.indexOf("--backup"), backup = index >= 0 ? args[index + 1] : null;
  if (apply && rollback || (apply || rollback) && (!args.includes("--writers-paused") || !backup || backup.startsWith("--"))) throw new Error("Apply/rollback need paused writers and a private backup path");
  await mongoose.connect(requireDatabaseUrl(), { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  if (rollback) {
    await rollbackSchedulingSchema(JSON.parse(await readFile(backup, "utf8"))); console.log("P09 added indexes removed; empty collections retained");
  } else {
    const plan = await inspectSchedulingSchema();
    console.log(JSON.stringify({ ready: plan.ready, collections: plan.collections.map(item => ({ collection: item.collection, count: item.count, missing: item.missing.map(row => row.options.name), conflicts: item.conflicts })) }));
    if (apply) {
      if (plan.collections.some(item => item.conflicts.length)) throw new Error("Conflicting indexes");
      await writeFile(backup, JSON.stringify({ task: "P09", database: mongoose.connection.name, ...plan }), { flag: "wx", mode: 0o600 });
      await applySchedulingSchema(); console.log("P09 scheduling indexes initialized; legacy visits unchanged");
    }
  }
} catch { console.error("P09 schema operation refused. Check explicit target, conflicts, paused writers, private backup and existing scheduling data."); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
