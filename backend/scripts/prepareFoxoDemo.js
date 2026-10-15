import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import { requireDatabaseUrl } from "../util/databaseConfig.js";
import { inspectFoxoDemo, applyFoxoDemo, foxoHash } from "../services/foxoDemo.js";

const { EJSON } = mongoose.mongo.BSON;
const repo = fileURLToPath(new URL("../../", import.meta.url));
function privatePath(value) {
  if (!value || !path.isAbsolute(value)) throw new Error("Absolute private output path required");
  const relative = path.relative(repo, value);
  if (!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative)) throw new Error("Keep private files outside the checkout");
  return value;
}
let client;
try {
  const args = process.argv.slice(2), parsed = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!["--explicit-target", "--date", "--plan", "--apply", "--backup", "--writers-paused"].includes(key) || key in parsed) throw new Error("Unknown or repeated argument");
    if (["--date", "--plan", "--backup"].includes(key)) {
      if (!args[i + 1] || args[i + 1].startsWith("--")) throw new Error("Missing argument");
      parsed[key] = args[++i];
    } else parsed[key] = true;
  }
  if (!parsed["--explicit-target"]) throw new Error("Explicit target required");
  const planPath = privatePath(parsed["--plan"]);
  const apply = parsed["--apply"] === true;
  if (apply && (process.env.FOXO_DEMO_APPROVED !== "true" || !parsed["--writers-paused"])) throw new Error("Reviewed production approval and paused writers required");
  const uri = requireDatabaseUrl();
  if (new URL(uri).pathname !== "/medipulse" && !/^\/medipulse_test_[a-zA-Z0-9_]+$/.test(new URL(uri).pathname)) throw new Error("Only explicit medipulse or isolated test target supported");
  client = new mongoose.mongo.MongoClient(uri, { serverSelectionTimeoutMS: 15000 });
  await client.connect();
  const db = client.db();
  if (!apply) {
    if (!parsed["--date"] || parsed["--backup"] || parsed["--writers-paused"]) throw new Error("Dry-run needs date and plan only");
    const plan = await inspectFoxoDemo(db, parsed["--date"]);
    await mkdir(path.dirname(planPath), { recursive: true });
    await writeFile(planPath, EJSON.stringify(plan, { relaxed: false }), { flag: "wx", mode: 0o600 });
    console.log(JSON.stringify({ mode: "read-only-plan", state: plan.mode, database: db.databaseName,
      proposed: plan.mode === "additive" ? { familyProfiles: 1, completedVisits: 3, linkedDocuments: 9, liveBookings: 0, financialWrites: 0 } : {} }));
  } else {
    if (parsed["--date"]) throw new Error("Apply uses the reviewed plan's date");
    const plan = EJSON.parse(await readFile(planPath, "utf8"), { relaxed: false });
    const backupPath = privatePath(parsed["--backup"]);
    if (backupPath === planPath || plan.mode !== "additive" || plan.database !== db.databaseName) throw new Error("Reviewed plan/backup target mismatch");
    const patient = await db.collection("users").findOne({ _id: plan.source.patient._id });
    if (!patient || patient.email !== plan.source.patient.email) throw new Error("Patient target changed");
    const backup = { task: plan.task, database: db.databaseName, planHash: plan.hash, patient, recordedAt: new Date() };
    await mkdir(path.dirname(backupPath), { recursive: true });
    await writeFile(backupPath, EJSON.stringify(backup, { relaxed: false }), { flag: "wx", mode: 0o600 });
    const backupVerified = foxoHash(backup) === foxoHash(EJSON.parse(await readFile(backupPath, "utf8"), { relaxed: false }));
    console.log(JSON.stringify(await applyFoxoDemo(db, client, plan, { approved: true, writersPaused: true, backupVerified })));
  }
} catch {
  console.error("FOXO fixture refused/failed. Verify explicit target, confirmed roles, date, unchanged private plan, backup and reviewed approval. No private values printed.");
  process.exitCode = 1;
} finally { await client?.close(); }
