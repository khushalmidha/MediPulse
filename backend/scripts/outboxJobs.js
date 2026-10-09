import mongoose from "mongoose";
import OutboxJob from "../model/outboxJob.js";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
// Explicit target only. Operator output excludes secret bodies, addresses and provider messages.
try {
  await mongoose.connect(requireDatabaseUrl(), { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  const args = process.argv.slice(2);
  if (args.includes("--retry")) {
    const id = args[args.indexOf("--id") + 1];
    if (!args.includes("--id") || !id) throw new Error("Select one failed job");
    const result = await OutboxJob.updateOne({ _id: id, state: "failed", $or: [{ expiresAt: { $exists: false } }, { expiresAt: { $gt: new Date() } }] },
      { $set: { state: "pending", availableAt: new Date(), attempts: 0 }, $unset: { lastError: "" } });
    console.log(JSON.stringify({ retried: result.modifiedCount }));
  }
  const counts = await OutboxJob.aggregate([{ $group: { _id: { state: "$state", kind: "$kind" }, count: { $sum: 1 }, oldest: { $min: "$createdAt" } } }]);
  const failed = await OutboxJob.find({ state: "failed" }).select("_id kind attempts lastError availableAt").limit(50).lean();
  console.log(JSON.stringify({ counts, failed }));
} catch { console.error("Outbox operation failed; verify the explicit database target and job selection"); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
