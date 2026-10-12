import mongoose from "mongoose";
import crypto from "node:crypto";
import Prescription from "../model/prescription.js";
import PharmacyInventory from "../model/pharmacyInventory.js";
import { clinicalStaff, loadClinicalRecord } from "./clinicalOrderAccess.js";
import { clinicalText } from "./clinicalOrderItems.js";
import { accessError, idOf, requireRecordId } from "./hospitalAccess.js";

let testFault;
export function setPharmacyTransactionFault(callback) {
  if (process.env.NODE_ENV !== "test") throw new Error("Transaction fault injection is only available in tests");
  testFault = callback;
}
const fault = async phase => { if (process.env.NODE_ENV === "test" && testFault) await testFault(phase); };
const whole = (value, label, min = 0) => {
  if (!Number.isSafeInteger(value) || value < min || value > 1000000000) throw accessError(400, `${label} must be a bounded whole number`);
  return value;
};
const keyOf = key => {
  if (!key) throw accessError(428, "Idempotency-Key is required");
  if (typeof key !== "string" || !/^[a-zA-Z0-9._:-]{8,128}$/.test(key)) throw accessError(400, "Invalid Idempotency-Key");
  return key;
};
const hash = input => crypto.createHash("sha256").update(JSON.stringify(input)).digest("hex");
const batchName = value => {
  if (typeof value !== "string" || !value.trim() || value.length > 80) throw accessError(400, "Invalid batch number");
  return value.trim().toUpperCase();
};

async function transaction(callback) {
  if (mongoose.connection.readyState !== 1) throw accessError(503, "Database service is unavailable");
  const session = await mongoose.startSession();
  try { return await session.withTransaction(() => callback(session), { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, maxCommitTimeMS: 10000 }); }
  catch (error) {
    if (error.code === 20 || error.code === 303) throw accessError(503, "Pharmacy operations require a transaction-capable database");
    throw error;
  } finally { await session.endSession(); }
}

function stockTotal(inventory) {
  const names = new Set();
  let total = 0;
  for (const batch of inventory.batches) {
    const name = batchName(batch.batchNumber);
    if (names.has(name)) throw accessError(409, "Duplicate stock batches need reviewed repair");
    names.add(name);
    whole(batch.quantityAvailable, "Available stock"); whole(batch.quantityReserved, "Reserved stock");
    whole(batch.quantityQuarantined, "Quarantined stock");
    if (batch.quantityReserved > batch.quantityAvailable || !Number.isFinite(new Date(batch.expiryDate).getTime())) {
      throw accessError(409, "Stock batch needs reviewed repair");
    }
    total = whole(total + batch.quantityAvailable, "Total stock");
  }
  return total;
}

function ledger(rx) {
  if (rx.fulfillmentLedgerVersion === undefined && rx.status === "approved_by_doctor"
    && !rx.fulfillmentOperations.length && rx.auditHistory.every(entry => entry.stage === "approved_by_doctor")
    && rx.items.every(item => item.quantityDispensed === 0 && !item.quantityReturned && !item.quantityFulfilled && !item.batchNumber && item.itemStatus === "pending")) {
    // Only a virgin, source-validated prescription can adopt the new ledger without historical guesses.
    rx.fulfillmentLedgerVersion = 1;
  }
  if (rx.fulfillmentLedgerVersion !== 1) throw accessError(409, "Existing dispensing history needs reviewed allocation repair");
  const allocations = new Map(), filled = new Map(), returned = new Map(), returnedByAllocation = new Map();
  for (const op of rx.fulfillmentOperations) {
    if (op.kind !== "dispense") continue;
    for (const allocation of op.allocations) {
      const itemId = idOf(allocation.itemId), allocationId = idOf(allocation._id);
      if (!rx.items.id(itemId) || idOf(rx.items.id(itemId).inventoryId) !== idOf(allocation.inventoryId) || allocations.has(allocationId)) throw accessError(409, "Allocation history needs reviewed repair");
      whole(allocation.quantity, "Allocated quantity", 1);
      allocations.set(allocationId, allocation);
      filled.set(itemId, (filled.get(itemId) || 0) + allocation.quantity);
    }
  }
  for (const op of rx.fulfillmentOperations) {
    if (op.kind !== "return") continue;
    for (const entry of op.allocations) {
      const original = allocations.get(idOf(entry.allocationId)), itemId = idOf(entry.itemId);
      if (!original || itemId !== idOf(original.itemId) || idOf(entry.inventoryId) !== idOf(original.inventoryId)
        || idOf(entry.batchId) !== idOf(original.batchId)) throw accessError(409, "Return allocation history needs reviewed repair");
      whole(entry.quantity, "Returned quantity", 1);
      returned.set(itemId, (returned.get(itemId) || 0) + entry.quantity);
      const total = (returnedByAllocation.get(idOf(original._id)) || 0) + entry.quantity;
      if (total > original.quantity) throw accessError(409, "Return quantity exceeds original allocation");
      returnedByAllocation.set(idOf(original._id), total);
    }
  }
  for (const item of rx.items) {
    const total = filled.get(idOf(item)) || 0, back = returned.get(idOf(item)) || 0;
    whole(item.quantityPrescribed, "Prescribed quantity", 1);
    if (total > item.quantityPrescribed || item.quantityDispensed !== total - back
      || item.quantityFulfilled !== total || item.quantityReturned !== back) throw accessError(409, "Prescription totals need reviewed allocation repair");
  }
  return { allocations, returnedByAllocation };
}

function command(input, kind, actor) {
  const key = keyOf(input.requestKey);
  if (input.expectedRevision === undefined) throw accessError(428, "The current fulfillment revision is required");
  whole(input.expectedRevision, "Fulfillment revision");
  const rows = kind === "dispense" ? input.dispenseItems : input.returnItems;
  if (!Array.isArray(rows) || !rows.length || rows.length > 30) throw accessError(400, "Provide one to thirty distinct fulfillment items");
  const entries = rows.map(row => kind === "dispense"
    ? { itemId: requireRecordId(row?.itemId, "prescription item"), quantity: whole(row.quantityToDispense, "Dispense quantity", 1), batchNumber: row.batchNumber ? batchName(row.batchNumber) : "" }
    : { allocationId: requireRecordId(row?.allocationId, "dispense allocation"), quantity: whole(row.quantity, "Return quantity", 1) });
  const field = kind === "dispense" ? "itemId" : "allocationId";
  if (new Set(entries.map(row => row[field])).size !== entries.length) throw accessError(400, "Duplicate fulfillment entries are not allowed");
  entries.sort((a, b) => a[field].localeCompare(b[field]));
  const reason = kind === "return" ? clinicalText(input.reason, "Return reason", 1000) : "";
  if (kind === "return" && !reason) throw accessError(400, "Reason for medication return is required");
  return { key, entries, reason, requestHash: hash({ kind, actorId: actor.id, revision: input.expectedRevision, entries, reason }) };
}

async function saveStock(inventory, session) {
  inventory.totalStock = stockTotal(inventory);
  await inventory.save({ session });
  await fault("afterInventorySave");
}

export async function fulfillPrescription(input, kind) {
  return transaction(async session => {
    const rx = await loadClinicalRecord(Prescription, input.prescriptionId, input.hospitalId, input.actor, "pharmacy", ["PHARMACIST"], { session });
    const actor = rx.$locals.clinicalActor, cmd = command(input, kind, actor);
    const prior = rx.fulfillmentOperations.find(op => op.key === cmd.key);
    if (prior) {
      if (prior.requestHash !== cmd.requestHash) throw accessError(409, "Idempotency-Key was already used for another command");
      rx.$locals.fulfillmentOperation = prior; rx.$locals.replayed = true;
      return rx;
    }
    if (rx.fulfillmentRevision !== input.expectedRevision) throw accessError(409, "Prescription changed; refresh before starting another operation");
    const history = ledger(rx);
    if (rx.fulfillmentOperations.length >= 256 || rx.fulfillmentOperations.reduce((sum, op) => sum + op.allocations.length, 0) >= 2048) {
      throw accessError(409, "Prescription allocation history requires operator review before more operations");
    }
    const now = new Date(), applied = [];
    if (kind === "dispense") {
      if (!["approved_by_doctor", "partially_dispensed"].includes(rx.status)) throw accessError(409, "Prescription is not eligible for dispensing");
      for (const entry of cmd.entries) {
        const item = rx.items.id(entry.itemId);
        if (!item) throw accessError(400, "Unknown prescription item");
        if (item.itemStatus === "cancelled" || item.quantityReturned > 0) throw accessError(409, "Returned or cancelled medication requires a new clinician order");
        if (entry.quantity > item.quantityPrescribed - item.quantityFulfilled) throw accessError(409, "Dispense quantity exceeds the prescribed remainder");
        requireRecordId(item.inventoryId, "inventory");
        const inventory = await PharmacyInventory.findOne({ _id: item.inventoryId, hospitalId: input.hospitalId, isActive: true }).session(session);
        if (!inventory || inventory.medicationCode !== item.medicationCode) throw accessError(409, "Prescribed inventory item is unavailable; no substitution was made");
        stockTotal(inventory);
        let batches = inventory.batches.filter(batch => new Date(batch.expiryDate) > now && batch.quantityAvailable > batch.quantityReserved);
        if (entry.batchNumber) batches = batches.filter(batch => batchName(batch.batchNumber) === entry.batchNumber);
        batches.sort((a, b) => new Date(a.expiryDate) - new Date(b.expiryDate) || idOf(a).localeCompare(idOf(b)));
        if (batches.reduce((sum, batch) => sum + batch.quantityAvailable - batch.quantityReserved, 0) < entry.quantity) {
          throw accessError(409, "Insufficient eligible stock in the requested batches; no medication was dispensed");
        }
        let remaining = entry.quantity;
        for (const batch of batches) {
          if (!remaining) break;
          const quantity = Math.min(remaining, batch.quantityAvailable - batch.quantityReserved);
          batch.quantityAvailable -= quantity; remaining -= quantity;
          applied.push({ itemId: item._id, inventoryId: inventory._id, batchId: batch._id, batchNumber: batch.batchNumber, expiryDate: batch.expiryDate, quantity });
        }
        item.quantityFulfilled += entry.quantity; item.quantityDispensed += entry.quantity;
        item.itemStatus = item.quantityFulfilled === item.quantityPrescribed ? "dispensed" : "pending";
        await saveStock(inventory, session);
      }
      rx.status = rx.items.every(item => item.quantityFulfilled === item.quantityPrescribed && !item.quantityReturned) ? "dispensed" : "partially_dispensed";
      rx.dispensedAt = now; rx.dispensedBy = actor.id; rx.dispensedByName = actor.name;
    } else {
      if (!["partially_dispensed", "dispensed"].includes(rx.status)) throw accessError(409, "Prescription has no eligible medication to return");
      for (const entry of cmd.entries) {
        const original = history.allocations.get(entry.allocationId);
        if (!original) throw accessError(400, "Return must reference an original dispense allocation");
        const outstanding = original.quantity - (history.returnedByAllocation.get(entry.allocationId) || 0);
        if (entry.quantity > outstanding) throw accessError(409, "Return quantity exceeds the outstanding allocation");
        const inventory = await PharmacyInventory.findOne({ _id: original.inventoryId, hospitalId: input.hospitalId }).session(session);
        const batch = inventory?.batches.id(original.batchId);
        if (!batch || batch.batchNumber !== original.batchNumber || +batch.expiryDate !== +original.expiryDate) throw accessError(409, "Original batch needs reviewed repair; no stock was changed");
        batch.quantityQuarantined = whole(batch.quantityQuarantined + entry.quantity, "Quarantined stock");
        const item = rx.items.id(original.itemId);
        item.quantityReturned += entry.quantity; item.quantityDispensed -= entry.quantity; item.itemStatus = "returned";
        applied.push({ itemId: original.itemId, inventoryId: original.inventoryId, batchId: original.batchId, batchNumber: original.batchNumber,
          expiryDate: original.expiryDate, quantity: entry.quantity, allocationId: original._id });
        await saveStock(inventory, session);
      }
      rx.status = rx.items.every(item => item.quantityDispensed === 0) ? "returned" : "partially_dispensed";
    }
    if (applied.length > 128 || rx.fulfillmentOperations.reduce((sum, op) => sum + op.allocations.length, 0) + applied.length > 2048) throw accessError(409, "This operation spans too many stock batches; select a smaller fill");
    rx.fulfillmentRevision += 1;
    rx.fulfillmentOperations.push({ key: cmd.key, requestHash: cmd.requestHash, kind, actorId: actor.id, actorName: actor.name, at: now,
      reason: cmd.reason || undefined, allocations: applied, resultingStatus: rx.status });
    rx.auditHistory.push({ stage: kind === "dispense" ? "dispensed" : "returned_to_quarantine", actorId: actor.id, actorName: actor.name, timestamp: now,
      notes: kind === "dispense" ? `Recorded ${applied.length} batch allocations` : cmd.reason });
    await fault("beforePrescriptionSave");
    await rx.save({ session });
    rx.$locals.fulfillmentOperation = rx.fulfillmentOperations.at(-1); rx.$locals.replayed = false;
    return rx;
  });
}

export async function receivePharmacyBatch({ inventoryId, hospitalId, actor, requestKey, batchNumber, expiryDate, quantity }) {
  return transaction(async session => {
    const staff = await clinicalStaff(actor, hospitalId, { session });
    if (!["PHARMACIST", "HOSPITAL_ADMIN"].includes(staff.role) && !staff.adminAccess) throw accessError(403, "Inventory administration is required");
    requireRecordId(inventoryId, "inventory");
    const inventory = await PharmacyInventory.findOne({ _id: inventoryId, hospitalId, isActive: true }).session(session);
    if (!inventory) throw accessError(404, "Active medication inventory was not found");
    const key = keyOf(requestKey), name = batchName(batchNumber), qty = whole(quantity, "Received quantity", 1);
    if (typeof expiryDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(expiryDate)) throw accessError(400, "Expiry date must be YYYY-MM-DD");
    const expiry = new Date(expiryDate + "T00:00:00.000Z");
    if (!Number.isFinite(+expiry) || expiry.toISOString().slice(0, 10) !== expiryDate) throw accessError(400, "Invalid expiry date");
    const requestHash = hash({ actorId: idOf(staff), name, expiryDate, quantity: qty });
    const prior = inventory.batches.find(batch => batch.receiptKey === key);
    if (prior) {
      if (prior.receiptHash !== requestHash) throw accessError(409, "Idempotency-Key was already used for another receipt");
      return inventory;
    }
    if (expiry <= new Date()) throw accessError(400, "Expiry date must be in the future");
    if (inventory.batches.some(batch => batchName(batch.batchNumber) === name)) throw accessError(409, "Batch already exists; use its original receipt key for a retry");
    if (inventory.batches.length >= 200) throw accessError(409, "Inventory batch history requires operator review");
    inventory.batches.push({ batchNumber: name, expiryDate: expiry, quantityAvailable: qty, quantityReserved: 0, quantityQuarantined: 0,
      receiptKey: key, receiptHash: requestHash, quantityReceived: qty, receivedBy: staff._id, receivedAt: new Date() });
    await saveStock(inventory, session);
    return inventory;
  });
}
