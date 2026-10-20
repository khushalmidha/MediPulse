import test from "node:test";
import assert from "node:assert/strict";
import { returnAllocations, readPendingPharmacy, pendingPharmacyKey } from "../src/utils/pharmacy.js";
import { scopeForPath } from "../src/utils/sessionScope.js";
test("staff clinical writes get staff CSRF while patient and independent endpoints retain account scope", () => {
  for (const path of ["/api/pharmacy/prescriptions/abc/dispense", "/backend/api/pharmacy/prescriptions/abc/return", "/api/pharmacy/inventory/abc/batches", "/api/labs/orders/abc/release", "/api/labs/catalog", "/verify/staff", "/api/opd/tokens/abc/vitals"]) assert.equal(scopeForPath(path), "staff", path);
  for (const path of ["/api/pharmacy/patient-prescriptions", "/api/labs/patient-results", "/api/pharmacy/verify-qr/abc", "/appointment/abc/notes", "/api/opd/abc/book", "/api/opd/abc/my-token"]) assert.equal(scopeForPath(path), "account", path);
});
test("return choices preserve original batch allocations and subtract all previously returned quantities", () => {
  const rx = { items: [{ _id: "item", medicationName: "Synthetic" }], fulfillmentOperations: [
    { kind: "dispense", allocations: [{ _id: "a", itemId: "item", batchNumber: "EARLY", quantity: 2 }, { _id: "b", itemId: "item", batchNumber: "LATE", quantity: 5 }] },
    { kind: "return", allocations: [{ allocationId: "a", quantity: 2 }, { allocationId: "b", quantity: 1 }] },
    { kind: "return", allocations: [{ allocationId: "b", quantity: 1 }] },
  ] };
  assert.deepEqual(returnAllocations(rx), [{ allocationId: "b", batchNumber: "LATE", medicationName: "Synthetic", quantityDispensed: 3, quantity: 0 }]);
});
test("pending commands are scoped to staff/tenant and remain intact on invalid storage", () => {
  assert.notEqual(pendingPharmacyKey("hospital", "one"), pendingPharmacyKey("hospital", "two"));
  assert.notEqual(pendingPharmacyKey("one", "staff"), pendingPharmacyKey("two", "staff"));
  assert.equal(readPendingPharmacy({ getItem: () => null }, "key"), null);
  assert.throws(() => readPendingPharmacy({ getItem: () => "broken" }, "key"));
  const packet = { kind: "dispense", rxId: "000000000000000000000001", key: "synthetic-operation", body: { expectedRevision: 0, items: [{ itemId: "000000000000000000000002", quantityToDispense: 1 }] } };
  assert.deepEqual(readPendingPharmacy({ getItem: () => JSON.stringify(packet) }, "key"), packet);
});


test("account doctor copilot paths keep account CSRF even behind the production relay",()=>{
  for(const path of ["/api/copilot/abc/generate-soap","/backend/api/copilot/abc/generate-soap"]) assert.equal(scopeForPath(path),"account",path);
  for(const path of ["/api/opd-ai/tokens/abc/copilot","/backend/api/opd-ai/tokens/abc/copilot"]) assert.equal(scopeForPath(path),"staff",path);
});
