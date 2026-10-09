import mongoose from "mongoose";
import { writeFile, readFile } from "node:fs/promises";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
import { inspectDurableSchema, applyDurableSchema, durableModels } from "../services/durableSchema.js";

// Explicit environment only; never default to deployment .env or print its URI.
try {
  const args = process.argv.slice(2), apply = args.includes("--apply"), rollback = args.includes("--rollback");
  if (apply && rollback) throw new Error("Select apply or rollback");
  const backup = args[args.indexOf("--backup") + 1];
  if ((apply || rollback) && (!args.includes("--writers-paused") || !args.includes("--backup") || !backup)) throw new Error("Apply/rollback require --writers-paused and --backup <private-file>");
  await mongoose.connect(requireDatabaseUrl(), { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  if (rollback) {
    const snapshot = JSON.parse(await readFile(backup, "utf8"));
    if (snapshot.task !== "P06" || snapshot.database !== mongoose.connection.name || !Array.isArray(snapshot.collections)) throw new Error("Backup does not match this database/task");
    for (const item of snapshot.collections) {
      const Model = durableModels.find(model => model.collection.collectionName === item.collection);
      if (!Model) throw new Error("Unknown durable collection in backup");
      for (const index of item.missing || []) {
        const permitted = Model.schema.indexes().find(([key, options]) => options.name === index.options?.name && JSON.stringify(key) === JSON.stringify(index.key));
        if (!index.options?.name?.startsWith("p06_") || !permitted || permitted[1].expireAfterSeconds !== index.options.expireAfterSeconds || Boolean(permitted[1].unique) !== Boolean(index.options.unique)) throw new Error("Backup index is not a P06 index");
      }
    }
    for (const item of snapshot.collections) {
      const Model = durableModels.find(model => model.collection.collectionName === item.collection);
      for (const index of item.missing || []) {
        const current = (await Model.collection.listIndexes().toArray()).find(row => row.name === index.options.name);
        if (!current) continue;
        if (JSON.stringify(current.key) !== JSON.stringify(index.key) || current.expireAfterSeconds !== index.options.expireAfterSeconds || Boolean(current.unique) !== Boolean(index.options.unique)) throw new Error("Index changed after initialization; rollback refused");
        await Model.collection.dropIndex(index.options.name);
      }
    }
    console.log("P06 added indexes removed; documents retained. Keep writers paused for version rollback.");
  } else {
    const plan = await inspectDurableSchema();
    console.log(JSON.stringify({ ready: plan.ready, collections: plan.collections.map(item => ({ collection: item.collection, count: item.count, missing: item.missing.map(index => index.options.name), conflicts: item.conflicts })) }));
    if (apply) {
      if (plan.collections.some(item => item.conflicts.length)) throw new Error("Resolve index conflicts before apply");
      await writeFile(backup, JSON.stringify({ task: "P06", database: mongoose.connection.name, ...plan }), { encoding: "utf8", flag: "wx", mode: 0o600 });
      await applyDurableSchema(); console.log("P06 indexes ready; workflow documents retained.");
    }
  }
} catch { console.error("P06 schema operation refused. Check explicit target, conflicts, paused writers and private backup arguments."); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
