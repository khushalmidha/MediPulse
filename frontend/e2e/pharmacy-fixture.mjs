const rxId = "000000000000000000000081", itemId = "000000000000000000000082";
const secondItem = "000000000000000000000083", inventoryId = "000000000000000000000084";
export async function handlePharmacy({ req, state, reply }) {
  const path = new URL(req.url, "http://fixture.invalid").pathname;
  if (!state.pharmacy || !path.startsWith("/api/pharmacy/")) return false;
  const respond = (data, status = 200) => { reply(data, status); return true; };
  state.pharmacyReads = (state.pharmacyReads || 0) + (req.method === "GET" ? 1 : 0);
  const rx = state.pharmacyRecord ||= { _id: rxId, patientInfo: { name: "Synthetic Pharmacy Patient" },
    prescribingDoctorName: "Dr. Dr. Synthetic Clinician", createdAt: "2026-10-12T00:00:00Z", status: "approved_by_doctor",
    verificationToken: "RX-1234567890ABCDEF", fulfillmentLedgerVersion: 1, fulfillmentRevision: 0, fulfillmentOperations: [],
    items: [{ _id: itemId, medicationName: "Synthetic Medication", medicationCode: "SYN", quantityPrescribed: 6,
      quantityFulfilled: 0, quantityDispensed: 0, quantityReturned: 0, itemStatus: "pending", directions: "Synthetic directions" },
    { _id: secondItem, medicationName: "Second Synthetic Medication", medicationCode: "SYN-2", quantityPrescribed: 2,
      quantityFulfilled: 0, quantityDispensed: 0, quantityReturned: 0, itemStatus: "pending", directions: "Synthetic directions" }] };
  state.pharmacyAvailable ??= 10; state.pharmacyQuarantined ??= 0;
  if (req.method === "GET" && state.pharmacyReadStatus) return respond({ message: "Synthetic pharmacy read failure" }, state.pharmacyReadStatus);
  if (path === "/api/pharmacy/prescriptions") return respond({ prescriptions: [rx] });
  if (path === "/api/pharmacy/prescriptions/" + rxId && req.method === "GET") return respond({ prescription: rx });
  if (path === "/api/pharmacy/inventory") return respond({ inventory: [{ _id: inventoryId, medicationName: "Synthetic Medication", medicationCode: "SYN",
    totalStock: state.pharmacyAvailable, reorderThreshold: 2, batches: [{ batchNumber: "SYN-BATCH", expiryDate: "2099-01-01", quantityAvailable: state.pharmacyAvailable, quantityReserved: 0, quantityQuarantined: state.pharmacyQuarantined }] }] });
  const action = /^\/api\/pharmacy\/prescriptions\/[^/]+\/(dispense|return)$/.exec(path);
  if (!action || req.method !== "POST") return false;
  let raw = ""; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw || "{}"), key = req.headers["idempotency-key"], kind = action[1];
  (state.pharmacyRequests ||= []).push({ key, body, kind });
  if (req.headers["x-csrf-token"] !== "fixture-staff-csrf") return respond({ message: "Invalid fixture CSRF" }, 403);
  if (!key) return respond({ message: "Idempotency-Key is required" }, 428);
  const prior = rx.fulfillmentOperations.find(op => op.key === key);
  if (prior) return respond({ prescription: rx, replayed: true, message: "Previously recorded operation confirmed" });
  if (state.pharmacyStale) { state.pharmacyStale = false; rx.fulfillmentRevision++; }
  if (body.expectedRevision !== rx.fulfillmentRevision) return respond({ message: "Prescription changed; refresh before starting another operation" }, 409);
  const allocations = [];
  for (const row of body.items) {
    if (kind === "dispense") {
      const item = rx.items.find(item => item._id === row.itemId), qty = row.quantityToDispense;
      if (!item || !Number.isInteger(qty) || qty < 1 || qty > item.quantityPrescribed - item.quantityFulfilled) return respond({ message: "Invalid fixture fill" }, 400);
      item.quantityFulfilled += qty; item.quantityDispensed += qty; state.pharmacyAvailable -= qty;
      item.itemStatus = item.quantityFulfilled === item.quantityPrescribed ? "dispensed" : "pending";
      allocations.push({ _id: "0000000000000000000000" + String(90 + rx.fulfillmentOperations.length).padStart(2, "0"), itemId: item._id, batchNumber: "SYN-BATCH", quantity: qty });
    } else {
      const original = rx.fulfillmentOperations.filter(op => op.kind === "dispense").flatMap(op => op.allocations).find(row2 => row2._id === row.allocationId);
      const item = rx.items.find(item => item._id === original?.itemId);
      if (!item || !Number.isInteger(row.quantity) || row.quantity < 1) return respond({ message: "Invalid fixture return" }, 400);
      item.quantityReturned += row.quantity; item.quantityDispensed -= row.quantity; item.itemStatus = "returned"; state.pharmacyQuarantined += row.quantity;
      allocations.push({ _id: "000000000000000000000099", allocationId: original._id, itemId: item._id, batchNumber: original.batchNumber, quantity: row.quantity });
    }
  }
  rx.status = kind === "return" && rx.items.every(item => item.quantityDispensed === 0) ? "returned"
    : rx.items.every(item => item.quantityFulfilled === item.quantityPrescribed && !item.quantityReturned) ? "dispensed" : "partially_dispensed";
  rx.fulfillmentRevision++; rx.fulfillmentOperations.push({ _id: "fixture-operation-" + rx.fulfillmentRevision, key, kind, allocations });
  if (state.pharmacyLoseResponse) { state.pharmacyLoseResponse = false; return respond({ message: "Synthetic lost response after commit" }, 503); }
  return respond({ prescription: rx, message: kind === "return" ? "Medication return recorded in quarantine" : "Dispensing recorded" });
}
