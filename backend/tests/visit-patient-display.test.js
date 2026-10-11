import test from "node:test";
import assert from "node:assert/strict";
import { visitPatientDisplay } from "../services/visitPatientDisplay.js";

test("private clinician names describe the actual family patient including historical profiles", () => {
  const member = { _id: "000000000000000000000002", name: "Synthetic child", archivedAt: new Date(), relation: "Private relation" };
  const account = { firstName: "Synthetic", lastName: "Owner", familyMembers: [member, { _id: "000000000000000000000003", name: "Other child" }] };
  assert.deepEqual(visitPatientDisplay({ user: account, familyMemberId: member._id }), { familyMemberId: member._id, patientDisplayName: member.name });
  assert.deepEqual(visitPatientDisplay({ user: account }), { familyMemberId: null, patientDisplayName: "Synthetic Owner" });
  assert.equal(visitPatientDisplay({ user: account, familyMemberId: "000000000000000000000004" }).patientDisplayName, null);
  assert.deepEqual(visitPatientDisplay({ user: null }), { familyMemberId: null, patientDisplayName: null });
});
