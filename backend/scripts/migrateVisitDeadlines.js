import mongoose from "mongoose";
import { readFile, writeFile } from "node:fs/promises";
import Appointment from "../model/appointment.js";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
// Explicit target and paused writers. Existing active visits remain manually completed.
try {
  const args = process.argv.slice(2), apply = args.includes("--apply"), rollback = args.includes("--rollback");
  const backup = args[args.indexOf("--backup") + 1];
  if (apply && rollback || (apply || rollback) && (!args.includes("--writers-paused") || !args.includes("--backup") || !backup)) throw new Error("Invalid migration arguments");
  await mongoose.connect(requireDatabaseUrl(), { autoIndex: false, autoCreate: false, serverSelectionTimeoutMS: 5000 });
  if (rollback) {
    const plan = JSON.parse(await readFile(backup, "utf8"));
    if (plan.task !== "P06-deadlines" || plan.database !== mongoose.connection.name || !Array.isArray(plan.rows)) throw new Error("Invalid backup target");
    for (const row of plan.rows) {
      const current = await Appointment.findById(row._id).select("status revision refundDueAt").lean();
      if (!current || current.status !== row.status || current.revision !== row.revision || current.refundDueAt?.toISOString() !== row.refundDueAt) throw new Error("Visit changed; recovery requires operator review");
    }
    for (const row of plan.rows) await Appointment.updateOne({ _id: row._id, status: row.status, revision: row.revision, refundDueAt: new Date(row.refundDueAt) }, { $unset: { refundDueAt: "" } });
    console.log("P06 legacy refund deadlines restored to the prior missing field; jobs retained.");
  } else {
    const records = await Appointment.find({ status: { $in: ["queued", "refund_pending"] }, visitMode: "online", refundDueAt: { $exists: false }, "payment.paidAt": { $type: "date" } }).select("_id status revision createdAt payment.paidAt").lean();
    if (records.some(row => !(row.createdAt instanceof Date) || !Number.isInteger(row.revision))) throw new Error("Legacy visits need queue migration/review first");
    const rows = records.map(row => ({ _id: String(row._id), status: row.status, revision: row.revision,
      refundDueAt: new Date(Math.max(row.createdAt.getTime(), row.payment.paidAt.getTime()) + 1800000).toISOString() }));
    console.log(JSON.stringify({ eligibleLegacyOnlineRefunds: rows.length, activeLegacyVisitsRemainManual: await Appointment.countDocuments({ status: "active", consultationDeadline: { $exists: false } }) }));
    if (apply) {
      await writeFile(backup, JSON.stringify({ task: "P06-deadlines", database: mongoose.connection.name, rows }), { encoding: "utf8", flag: "wx", mode: 0o600 });
      for (const row of rows) {
        const saved = await Appointment.updateOne({ _id: row._id, status: row.status, revision: row.revision, refundDueAt: { $exists: false } }, { $set: { refundDueAt: new Date(row.refundDueAt) } });
        if (!saved.modifiedCount) throw new Error("Writers were not paused; use the private recovery plan");
      }
      console.log("P06 legacy online refund deadlines initialized.");
    }
  }
} catch { console.error("P06 deadline operation refused; verify explicit target, paused writers, valid dates and private backup"); process.exitCode = 1; }
finally { await mongoose.disconnect(); }
