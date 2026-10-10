import mongoose from "mongoose";
import { readFile } from "node:fs/promises";
import { requireDatabaseUrl } from "../util/databaseConfig.js";

// Maintenance never loads deployment .env files or starts provider clients/workers.
process.env.NODE_ENV = "test";
process.env.MAIL_DELIVERY = "disabled";
process.env.KAFKA_BROKERS = "";
try {
  const args = process.argv.slice(2), apply = args.includes("--apply"), restore = args.includes("--restore");
  for (let index = 0; index < args.length; index++) {
    if (["--backup", "--restore"].includes(args[index])) { if (!args[++index] || args[index].startsWith("--")) throw new Error("Missing argument"); }
    else if (!["--apply", "--synthetic-data", "--writers-paused"].includes(args[index])) throw new Error("Invalid arguments");
  }
  if (apply && restore) throw new Error("Choose one operation");
  if ((apply || restore) && (process.env.DEMO_RECOVERY_APPROVED !== "true" || !args.includes("--synthetic-data") || !args.includes("--writers-paused"))) throw new Error("Reviewed approval and synthetic-data/writer confirmation required");
  const { inspectDemoRecovery, applyDemoRecovery, verifyDemoPreservation, restoreDemoRecovery, recoveryHash } = await import("../services/demoRecovery.js");
  await mongoose.connect(requireDatabaseUrl(), { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  if (restore) {
    await restoreDemoRecovery(mongoose.connection, args[args.indexOf("--restore") + 1], { syntheticConfirmed: true, writersPaused: true });
    console.log("Synthetic original restoration completed; archive retained");
  } else {
    const plan = await inspectDemoRecovery();
    console.log(JSON.stringify({ task: plan.task, mode: apply ? "apply" : "dry-run", database: plan.database, preserve: plan.summary, total: plan.rows.length }));
    if (apply) {
      const backupIndex = args.indexOf("--backup"), file = backupIndex >= 0 ? args[backupIndex + 1] : null;
      if (!file || file.startsWith("--")) throw new Error("Private backup required");
      const snapshot = mongoose.mongo.BSON.EJSON.parse(await readFile(file, "utf8"));
      const names = (await mongoose.connection.db.listCollections().toArray()).map(row => row.name).sort();
      if (snapshot.database !== plan.database || !Array.isArray(snapshot.collections) || JSON.stringify(names) !== JSON.stringify(snapshot.collections.map(row => row.name).sort())) throw new Error("Backup target/collections mismatch");
      for (const item of snapshot.collections) {
        const current = await mongoose.connection.db.collection(item.name).find({}).toArray();
        if (recoveryHash(current.map(recoveryHash).sort()) !== recoveryHash(item.documents.map(recoveryHash).sort())) throw new Error("Data changed since backup; recovery refused");
      }
      const result = await applyDemoRecovery(mongoose.connection, plan, { syntheticConfirmed: true, writersPaused: true, backupVerified: true });
      await verifyDemoPreservation(mongoose.connection, plan, result.runId);
      console.log(JSON.stringify({ ...result, originalPreservationVerified: true }));
    }
  }
} catch { console.error("Demo recovery refused or failed: verify reviewed synthetic-data approval, unchanged private backup and paused writers; no private records printed"); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
