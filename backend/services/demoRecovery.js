import crypto from "node:crypto";
import mongoose from "mongoose";
import { inspectQueueMigration } from "./queueMigration.js";
import { inspectMoneyMigration } from "./moneyMigration.js";
import OpdToken from "../model/opdToken.js";
import Appointment from "../model/appointment.js";
import VirtualRefund from "../model/virtualRefund.js";

const id = row => String(row?._id || row || "");
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const recoveryHash = row => crypto.createHash("sha256").update(JSON.stringify(canonical(JSON.parse(mongoose.mongo.BSON.EJSON.stringify(row, { relaxed: false }))))).digest("hex");
const collectionHash = rows => recoveryHash(rows.map(recoveryHash).sort());
const models = [OpdToken, Appointment, VirtualRefund];

// This plan is for owner-confirmed synthetic data only. It never invents missing identities or transfers.
export function planDemoRecovery({ database, tokens, appointments, refunds, queue, money }) {
  const supportedQueue = new Set(["unresolvable_token_context", "unresolvable_appointment_context", "hospital_appointment_without_token", "linked_state_mismatch"]);
  const supportedMoney = new Set(["invalid_refund_link", "invalid_appointment_payment"]);
  if (queue.issues.some(issue => !supportedQueue.has(issue)) || money.issues.some(issue => !supportedMoney.has(issue))) throw new Error("Unreviewed issue type; recovery refused");
  const validTokens = new Set(queue.tokens.map(id)), validAppointments = new Set(queue.appointments.map(id));
  const validRefunds = new Set(money.plans[2].map(id)), validPayments = new Set(money.plans[3].map(id));
  const selected = new Map();
  const select = (collection, row, reason) => {
    const key = `${collection}:${id(row)}`;
    if (!selected.has(key)) selected.set(key, { collection, original: row, beforeHash: recoveryHash(row), reasons: [] });
    const reasons = selected.get(key).reasons;
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const tn = OpdToken.collection.collectionName, an = Appointment.collection.collectionName, rn = VirtualRefund.collection.collectionName;
  for (const row of tokens) if (!validTokens.has(id(row))) select(tn, row, "unresolvable_token_context");
  for (const row of appointments) {
    if (!validAppointments.has(id(row))) select(an, row, "unresolvable_appointment_context");
    if (!validPayments.has(id(row))) select(an, row, "invalid_appointment_payment");
  }
  for (const row of refunds) if (!validRefunds.has(id(row))) select(rn, row, "invalid_refund_link");
  const originalAppointments = new Map(appointments.map(row => [id(row), row]));
  for (const projected of queue.appointments) if (projected.visitMode === "in_person" && !projected.opdTokenId) select(an, originalAppointments.get(id(projected)), "hospital_appointment_without_token");
  const expected = { reserved: "queued", waiting: "queued", vitals_done: "queued", in_consultation: "active", completed: "completed", cancelled: "cancelled", no_show: "cancelled", booking: "booking", refund_pending: "refund_pending" };
  const originalTokens = new Map(tokens.map(row => [id(row), row]));
  for (const projected of queue.tokens) {
    const appointment = originalAppointments.get(id(projected.appointmentId));
    if (appointment && appointment.status !== expected[projected.status]) {
      select(tn, originalTokens.get(id(projected)), "linked_state_mismatch"); select(an, appointment, "linked_state_mismatch");
    }
  }
  // Preserve the complete connected pair: never leave an active counterpart to an archived visit.
  let changed;
  do {
    const count = selected.size;
    for (const token of tokens) for (const appointment of appointments) {
      if (id(token.appointmentId) !== id(appointment) && id(appointment.opdTokenId) !== id(token)) continue;
      if (selected.has(`${tn}:${id(token)}`) || selected.has(`${an}:${id(appointment)}`)) {
        select(tn, token, "linked_visit_preservation"); select(an, appointment, "linked_visit_preservation");
      }
    }
    changed = count !== selected.size;
  } while (changed);
  const rows = [...selected.values()];
  return { task: "P23_SYNTHETIC_RECOVERY", database, rows,
    fingerprints: { [tn]: collectionHash(tokens), [an]: collectionHash(appointments), [rn]: collectionHash(refunds) },
    summary: Object.fromEntries(models.map(model => [model.collection.collectionName, rows.filter(row => row.collection === model.collection.collectionName).length])) };
}

export async function inspectDemoRecovery() {
  const [queue, money, tokens, appointments, refunds] = await Promise.all([
    inspectQueueMigration(), inspectMoneyMigration(), ...models.map(model => model.collection.find({}).toArray())]);
  return planDemoRecovery({ database: mongoose.connection.name, tokens, appointments, refunds, queue, money });
}

export async function applyDemoRecovery(connection, plan, { syntheticConfirmed, writersPaused, backupVerified } = {}) {
  if (syntheticConfirmed !== true || writersPaused !== true || backupVerified !== true) throw new Error("Explicit synthetic-data confirmation, paused writers and verified backup required");
  if (plan.task !== "P23_SYNTHETIC_RECOVERY" || plan.database !== connection.name || !Array.isArray(plan.rows)) throw new Error("Recovery target mismatch");
  for (const model of models) if (collectionHash(await model.collection.find({}).toArray()) !== plan.fingerprints[model.collection.collectionName]) throw new Error("Data changed since review; recovery refused");
  for (const item of plan.rows) if (!models.some(model => model.collection.collectionName === item.collection) || recoveryHash(item.original) !== item.beforeHash) throw new Error("Invalid recovery row");
  const runId = crypto.randomUUID(), archive = connection.db.collection("p23_preserved_demo_records");
  if (!(await connection.db.listCollections({ name: archive.collectionName }).toArray()).length) await connection.db.createCollection(archive.collectionName);
  const runs = connection.db.collection("p23_demo_recovery_runs");
  if (!(await connection.db.listCollections({ name: runs.collectionName }).toArray()).length) await connection.db.createCollection(runs.collectionName);
  const session = await connection.startSession();
  try {
    await session.withTransaction(async () => {
      for (const item of plan.rows) {
        const collection = connection.db.collection(item.collection);
        const current = await collection.findOne({ _id: item.original._id }, { session });
        if (!current || recoveryHash(current) !== item.beforeHash) throw new Error("Record changed; recovery refused");
        await archive.insertOne({ _id: `${runId}:${item.collection}:${id(item.original)}`, runId, ...item, preservedAt: new Date() }, { session });
        const result = await collection.deleteOne({ _id: item.original._id }, { session });
        if (result.deletedCount !== 1) throw new Error("Recovery conflict");
      }
      const fingerprints = {};
      for (const model of models) fingerprints[model.collection.collectionName] = collectionHash(await model.collection.find({}, { session }).toArray());
      await runs.insertOne({ _id: runId, state: "preserved", fingerprints, summary: plan.summary, createdAt: new Date() }, { session });
    });
  } finally { await session.endSession(); }
  return { runId, preserved: plan.rows.length, summary: plan.summary };
}

export async function verifyDemoPreservation(connection, plan, runId) {
  const archived = await connection.db.collection("p23_preserved_demo_records").find({ runId }).toArray();
  if (archived.length !== plan.rows.length) throw new Error("Archive count mismatch");
  for (const item of plan.rows) if (!archived.some(row => row.collection === item.collection && id(row.original) === id(item.original) && recoveryHash(row.original) === item.beforeHash)) throw new Error("Preserved original mismatch");
  // Transfers and wallet balances are intentionally untouched by archival; migrations handle their schema separately.
  return true;
}

// Roll back P07/P04/P03 first. Refuse restoration if any visit/refund changed afterward.
export async function restoreDemoRecovery(connection, runId, { syntheticConfirmed, writersPaused } = {}) {
  if (syntheticConfirmed !== true || writersPaused !== true || !/^[a-f0-9-]{36}$/.test(runId)) throw new Error("Reviewed synthetic restoration and paused writers required");
  const runs = connection.db.collection("p23_demo_recovery_runs"), archive = connection.db.collection("p23_preserved_demo_records");
  const session = await connection.startSession();
  try {
    await session.withTransaction(async () => {
      const run = await runs.findOne({ _id: runId, state: "preserved" }, { session });
      if (!run) throw new Error("Preservation run unavailable");
      for (const model of models) if (collectionHash(await model.collection.find({}, { session }).toArray()) !== run.fingerprints[model.collection.collectionName]) throw new Error("Data changed since recovery; restoration refused");
      const rows = await archive.find({ runId }, { session }).toArray();
      if (rows.length !== Object.values(run.summary).reduce((sum, count) => sum + count, 0)) throw new Error("Incomplete archive");
      for (const item of rows) {
        if (!models.some(model => model.collection.collectionName === item.collection) || recoveryHash(item.original) !== item.beforeHash) throw new Error("Invalid preserved original");
        await connection.db.collection(item.collection).insertOne(item.original, { session });
      }
      await runs.updateOne({ _id: runId }, { $set: { state: "restored", restoredAt: new Date() } }, { session });
    });
  } finally { await session.endSession(); }
}
