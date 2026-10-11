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
