export function returnAllocations(rx) {
  const returned = new Map();
  for (const operation of rx.fulfillmentOperations || []) {
    if (operation.kind !== "return") continue;
    for (const row of operation.allocations || []) returned.set(row.allocationId, (returned.get(row.allocationId) || 0) + row.quantity);
  }
  const items = new Map((rx.items || []).map(item => [item._id, item]));
  return (rx.fulfillmentOperations || []).filter(operation => operation.kind === "dispense")
    .flatMap(operation => operation.allocations || []).map(row => ({ allocationId: row._id, batchNumber: row.batchNumber,
      medicationName: items.get(row.itemId)?.medicationName || "Medication", quantityDispensed: row.quantity - (returned.get(row._id) || 0),
      quantity: 0 })).filter(row => row.quantityDispensed > 0);
}
export const pendingPharmacyKey = (hospitalId, staffId) => `medipulse.pharmacy.pending.v1:${hospitalId}:${staffId}`;
export function readPendingPharmacy(storage, key) {
  const raw = storage.getItem(key);
  if (!raw) return null;
  const packet = JSON.parse(raw);
  if (!packet || !["dispense", "return"].includes(packet.kind) || !/^[a-f\d]{24}$/i.test(packet.rxId)
    || !/^[a-zA-Z0-9._:-]{8,128}$/.test(packet.key) || !Array.isArray(packet.body?.items)
    || !Number.isSafeInteger(packet.body.expectedRevision)) throw new Error("Pending pharmacy operation needs review");
  return packet;
}
