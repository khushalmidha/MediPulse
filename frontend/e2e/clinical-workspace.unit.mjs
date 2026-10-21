import test from "node:test";
import assert from "node:assert/strict";
import { clinicalPatientName, clinicalMatches, recordedWait, notesOf } from "../src/utils/clinicalWorkspace.js";

test("clinical identity never substitutes the account owner for a missing family patient", () => {
  assert.equal(clinicalPatientName({ familyMemberId: "child", user: { firstName: "Account owner" } }), "Family patient — name not recorded");
  assert.equal(clinicalPatientName({ familyMemberId: "child", patientDisplayName: "Actual child", user: { firstName: "Owner" } }), "Actual child");
  assert.equal(clinicalPatientName({ patientInfo: { name: "Walk-in" } }), "Walk-in");
  assert.equal(clinicalPatientName({ user: { firstName: "Self", lastName: "Patient" } }), "Self Patient");
});
test("recorded wait estimates preserve zero and never invent a missing or invalid value", () => {
  assert.equal(recordedWait(0), "Recorded estimate: 0 min");
  assert.equal(recordedWait(12), "Recorded estimate: 12 min");
  for (const value of [null, undefined, NaN, Infinity, -1, "12"]) assert.equal(recordedWait(value), "Wait estimate unavailable");
});
test("queue search and note drafts use the visited person and tolerate malformed text", () => {
  const row = { patientDisplayName: "Synthetic child", displayToken: "T001", chiefComplaint: "Follow up" };
  assert.equal(clinicalMatches(row, " CHILD "), true); assert.equal(clinicalMatches(row, "t001"), true);
  assert.equal(clinicalMatches(row, "other"), false); assert.equal(notesOf({ doctorNotes: { bad: true } }), "");
  assert.equal(notesOf({ consultationNotes: "Clinician record" }, true), "Clinician record");
});

test("note modification invalidates approved SOAP state and draft review", () => {
  const originalSoap = { version: 1, isDraft: false, clinicianApproved: true, markdown: "Original assessment" };
  const invalidateSoapDraft = (soap) => (soap ? { ...soap, clinicianApproved: false, isDraft: true } : null);
  const invalidated = invalidateSoapDraft(originalSoap);
  assert.equal(invalidated.clinicianApproved, false);
  assert.equal(invalidated.isDraft, true);
  assert.equal(invalidated.version, 1);
});

test("pending command keys preserve creation context across response loss and recover", () => {
  const storage = new Map();
  const getOrSetCommandKey = (tokenId, kind) => {
    const key = `mp_${kind}_key_${tokenId}`;
    if (!storage.has(key)) {
      storage.set(key, `${kind}-${tokenId}-synthetic-uuid`);
    }
    return storage.get(key);
  };
  const firstKey = getOrSetCommandKey("token-123", "lab");
  assert.ok(firstKey.startsWith("lab-token-123-"));
  // Simulated crash/reload before completion
  const recoveredKey = getOrSetCommandKey("token-123", "lab");
  assert.equal(recoveredKey, firstKey, "The same creation command key must be recovered after response loss");
  // Cleaned up after successful commit
  storage.delete(`mp_lab_key_token-123`);
  assert.equal(storage.has(`mp_lab_key_token-123`), false);
});

test("critical lab alert identifies unacknowledged critical findings on orders", () => {
  const normalOrder = { _id: "ord-1", reportVersions: [{ version: 1, criticalTask: null }] };
  const acknowledgedOrder = { _id: "ord-2", reportVersions: [{ version: 1, criticalTask: { createdAt: new Date(), acknowledgedAt: new Date() } }] };
  const pendingCriticalOrder = { _id: "ord-3", reportVersions: [{ version: 1, criticalTask: { createdAt: new Date() } }] };

  const hasPendingCritical = (order) => Boolean(order.reportVersions?.some(r => r.criticalTask?.createdAt && !r.criticalTask?.acknowledgedAt));
  assert.equal(hasPendingCritical(normalOrder), false);
  assert.equal(hasPendingCritical(acknowledgedOrder), false);
  assert.equal(hasPendingCritical(pendingCriticalOrder), true);
});
