import mongoose from "mongoose";
import { readFile, writeFile } from "node:fs/promises";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
import {
  inspectClinicalSchema,
  applyClinicalSchema,
  rollbackClinicalSchema,
  clinicalModels,
} from "../services/clinicalSchema.js";

// Explicit environment only; never default to deployment .env or print connection strings.
try {
  const args = process.argv.slice(2);
  if (!args.includes("--explicit-target")) throw new Error("Explicit target required");

  const apply = args.includes("--apply");
  const rollback = args.includes("--rollback");
  const backupIdx = args.indexOf("--backup");
  const backup = backupIdx >= 0 ? args[backupIdx + 1] : null;

  if ((apply && rollback) || ((apply || rollback) && (!args.includes("--writers-paused") || !backup || backup.startsWith("--")))) {
    throw new Error("Apply/rollback require --writers-paused and a valid private --backup <path>");
  }

  await mongoose.connect(requireDatabaseUrl(), { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });

  if (rollback) {
    const snapshot = JSON.parse(await readFile(backup, "utf8"));
    await rollbackClinicalSchema(snapshot);
    console.log("AG01 added indexes removed; documents and collections retained.");
  } else {
    const plan = await inspectClinicalSchema();
    console.log(
      JSON.stringify({
        ready: plan.ready,
        issues: plan.issues,
        collections: plan.collections.map(item => ({
          collection: item.collection,
          count: item.count,
          missing: item.missing.map(row => row.options.name),
          conflicts: item.conflicts,
        })),
        summary: plan.summary,
      })
    );

    if (apply) {
      if (plan.issues.length) {
        throw new Error(`Data duplicates require operator review before apply: ${plan.issues.join(", ")}`);
      }
      if (plan.collections.some(item => item.conflicts.length)) {
        throw new Error("Conflicting indexes require operator review before apply");
      }

      await writeFile(
        backup,
        JSON.stringify({ task: "AG01", database: mongoose.connection.name, ...plan }),
        { flag: "wx", mode: 0o600 }
      );
      await applyClinicalSchema();
      console.log("AG01 clinical and encounter indexes initialized; legacy documents unchanged.");
    }
  }
} catch (error) {
  console.error("AG01 schema operation refused:", error.message);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
