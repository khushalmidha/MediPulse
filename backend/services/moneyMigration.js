import crypto from "node:crypto";
import Wallet from "../model/wallet.js";
import VirtualTransaction from "../model/virtualTransaction.js";
import VirtualRefund from "../model/virtualRefund.js";
import Appointment from "../model/appointment.js";
import { amountToMinor, fromMinor, fingerprint } from "../util/money.js";
import { transactionFingerprint } from "./virtualLedger.js";
export const moneyModels = [Wallet, VirtualTransaction, VirtualRefund, Appointment];
const hash = (rows) => fingerprint(rows.map((row) => JSON.stringify(row)).sort());
export const inspectMoneyMigration = async () => {
  const [wallets, transactions, refunds, appointments] = await Promise.all(moneyModels.map((model) => model.collection.find({}).toArray()));
  const issues = [], plans = [[], [], [], []], paymentById = new Map(transactions.map((row) => [row.transactionId, row]));
  const minor = (value, zero = false) => amountToMinor(value, { zero, legacy: true });
  const checkExisting = (row, field, value) => { if (row[field] !== undefined && row[field] !== value) throw new Error(); return value; };
  const seen = new Set();
  for (const row of wallets) try {
    if (row.currency && row.currency !== "INR") throw new Error();
    const updated = { ...row, currency: row.currency || "INR" };
    for (const field of ["balance", "totalSent", "totalReceived"]) { updated[`${field}Minor`] = checkExisting(row, `${field}Minor`, minor(row[field] || 0, true)); updated[field] = fromMinor(updated[`${field}Minor`]); }
    // Historical demo credit provenance is unknown; never silently mint new credits.
    if (row.initialCreditApplied === undefined) updated.initialCreditApplied = true;
    const key = `wallet:${row.userRole}:${row.userId}`; if (seen.has(key)) issues.push("duplicate_wallet"); seen.add(key);
    plans[0].push(updated);
  } catch { issues.push("invalid_wallet_amount"); }
  for (const row of transactions) try {
    const amountMinor = checkExisting(row, "amountMinor", minor(row.amount));
    const linked = transactions.filter((txn) => txn.type === "REFUND" && txn.status === "SUCCESS" && txn.relatedTransactionId === row.transactionId);
    const refundedMinor = linked.reduce((sum, txn) => sum + minor(txn.amount), 0);
    if (row.refundedMinor !== undefined && row.refundedMinor !== refundedMinor) throw new Error();
    if (refundedMinor > amountMinor || (row.status === "REFUNDED" && refundedMinor !== amountMinor)) throw new Error();
    if (row.type === "REFUND" && row.status === "SUCCESS") {
      const original = paymentById.get(row.relatedTransactionId);
      if (!original || original.type !== "PAYMENT" || String(original.senderId) !== String(row.receiverId)
        || String(original.receiverId) !== String(row.senderId) || original.senderRole !== row.receiverRole || original.receiverRole !== row.senderRole) throw new Error();
    }
    if (typeof row.referenceId === "string") { const key = `reference:${row.senderRole}:${row.senderId}:${row.referenceId}`; if (seen.has(key)) issues.push("duplicate_transaction_reference"); seen.add(key); }
    plans[1].push({ ...row, amountMinor, amount: fromMinor(amountMinor), refundedMinor,
      status: row.type === "PAYMENT" && refundedMinor === amountMinor ? "REFUNDED" : row.status,
      fingerprint: row.fingerprint || transactionFingerprint(row, amountMinor),
      metadata: { ...row.metadata, ...(row.type === "PAYMENT" ? { refundedAmount: fromMinor(refundedMinor) } : {}) } });
  } catch { issues.push("invalid_ledger_or_refund_total"); }
  for (const row of refunds) try {
    const amountMinor = checkExisting(row, "amountMinor", minor(row.amount));
    const matches = transactions.filter((txn) => txn.type === "REFUND" && txn.status === "SUCCESS" && txn.relatedTransactionId === row.paymentId
      && (txn.transactionId === row.refundTransactionId || txn.metadata?.refundId === row.refundId));
    if (matches.length > 1 || (row.status === "COMPLETED" && matches.length !== 1) || (matches[0] && minor(matches[0].amount) !== amountMinor)) throw new Error();
    const idempotencyKey = row.idempotencyKey || `legacy:${row.refundId}`;
    const key = `refund:${row.paymentId}:${idempotencyKey}`; if (seen.has(key)) issues.push("duplicate_refund_request"); seen.add(key);
    plans[2].push({ ...row, amountMinor, idempotencyKey, fingerprint: row.fingerprint || fingerprint({ amount: amountMinor, reason: row.reason || "Refund issued" }),
      ...(matches[0] ? { status: "COMPLETED", refundTransactionId: matches[0].transactionId, failureReason: "" }
        : { status: "FAILED", failureReason: "Legacy refund has no committed ledger transfer; reviewed retry required" }) });
  } catch { issues.push("invalid_refund_link"); }
  for (const row of appointments) try {
    const id = row.payment?.paymentId || row.payment?.orderId;
    if (!id) { plans[3].push(row); continue; }
    const original = paymentById.get(id), amountMinor = minor(row.payment.amount);
    if (!original || original.type !== "PAYMENT" || minor(original.amount) !== amountMinor
      || String(original.senderId) !== String(row.user) || String(original.receiverId) !== String(row.doctor)) throw new Error();
    plans[3].push({ ...row, payment: { ...row.payment, amountMinor, amount: fromMinor(amountMinor) } });
  } catch { issues.push("invalid_appointment_payment"); }
  return { plans, issues, summary: { wallets: wallets.length, transactions: transactions.length, refunds: refunds.length, appointments: appointments.length,
    issues: Object.fromEntries([...new Set(issues)].map((key) => [key, issues.filter((issue) => issue === key).length])) } };
};
export const applyMoneyMigration = async (connection, plan) => {
  if (plan.issues.length) throw new Error("Ledger migration requires reviewed correction; no writes performed");
  const db = connection.db, runId = crypto.randomBytes(8).toString("hex"), backups = [];
  for (const model of moneyModels) {
    const collection = model.collection.collectionName, backup = `p04_backup_${runId}_${collection}`, rows = await model.collection.find({}).toArray();
    if (rows.length) await db.collection(backup).insertMany(rows);
    let indexes = []; try { indexes = await model.collection.listIndexes().toArray(); } catch (error) { if (error.code !== 26) throw error; }
    backups.push({ collection, backup, indexes });
  }
  await db.collection("p04_migrations").insertOne({ _id: runId, state: "applying", backups, createdAt: new Date() });
  for (let i = 0; i < moneyModels.length; i++) {
    for (const row of plan.plans[i]) await moneyModels[i].collection.replaceOne({ _id: row._id }, row);
    await moneyModels[i].createIndexes();
  }
  const fingerprints = {};
  for (const model of moneyModels) fingerprints[model.collection.collectionName] = hash(await model.collection.find({}).toArray());
  await db.collection("p04_migrations").updateOne({ _id: runId }, { $set: { state: "completed", fingerprints } });
  return runId;
};
export const rollbackMoneyMigration = async (connection, runId) => {
  if (!/^[a-f0-9]{16}$/.test(runId)) throw new Error("Invalid recovery ID");
  const db = connection.db, run = await db.collection("p04_migrations").findOne({ _id: runId, state: "completed" });
  if (!run) throw new Error("Completed recovery snapshot unavailable");
  for (const backup of run.backups) if (hash(await db.collection(backup.collection).find({}).toArray()) !== run.fingerprints[backup.collection]) throw new Error("Data changed after migration; rollback refused");
  for (const backup of run.backups) {
    const collection = db.collection(backup.collection);
    for (const index of await collection.listIndexes().toArray()) if (index.name !== "_id_") await collection.dropIndex(index.name);
    await collection.deleteMany({});
    const rows = await db.collection(backup.backup).find({}).toArray(); if (rows.length) await collection.insertMany(rows);
    for (const index of backup.indexes) if (index.name !== "_id_") { const { key, v, ns, ...options } = index; await collection.createIndex(key, options); }
  }
  await db.collection("p04_migrations").updateOne({ _id: runId }, { $set: { state: "rolled_back" } });
};
export const assertMoneyReady = async () => {
  const indexes = await VirtualTransaction.collection.listIndexes().toArray();
  if (!indexes.some((row) => row.name === "ledger_reference_p04" && row.unique)) throw new Error("P04 ledger indexes require migration");
  for (const [model, key] of [[Wallet, { userId: 1, userRole: 1 }], [VirtualTransaction, { transactionId: 1 }], [VirtualRefund, { paymentId: 1, idempotencyKey: 1 }]]) {
    if (!(await model.collection.listIndexes().toArray()).some((row) => row.unique && JSON.stringify(row.key) === JSON.stringify(key))) throw new Error("Financial identity indexes require migration");
  }
  for (const [model, fields] of [[Wallet, ["balanceMinor", "totalSentMinor", "totalReceivedMinor"]], [VirtualTransaction, ["amountMinor", "refundedMinor", "fingerprint"]], [VirtualRefund, ["amountMinor", "fingerprint"]]]) {
    if (await model.collection.countDocuments({ $or: fields.map((field) => ({ [field]: { $exists: false } })) })) throw new Error("P04 ledger metadata requires migration");
  }
};
