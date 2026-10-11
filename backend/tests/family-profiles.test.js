import test from "node:test";
import assert from "node:assert/strict";
import { familyViews, normalizeFamilyProfile } from "../services/familyProfiles.js";
import { activeFamilyFilter } from "../services/patientIdentity.js";
import User from "../model/user.js";
import { updateUserData } from "../controller/user.js";
test("family profile inputs reject fabricated demographics and preserve supplied valid fields", () => {
  assert.deepEqual(normalizeFamilyProfile({ name: " Synthetic Parent ", relation: " Parent ", ignored: "unused", gender: "", bloodGroup: "" }, "2026-10-11"), { name: "Synthetic Parent", relation: "Parent" });
  assert.equal(normalizeFamilyProfile({ name: "Synthetic", relation: "Child", dob: "2020-02-29", bloodGroup: "O+" }, "2026-10-11").dob.toISOString(), "2020-02-29T00:00:00.000Z");
  for (const input of [{ name: {} }, { relation: " " }, { name: "x".repeat(101) }, { relation: "x".repeat(61) }, { dob: "2023-02-29" }, { dob: "2026-10-12" }, { dob: {} }, { gender: "unknown" }, { bloodGroup: "unknown" }]) assert.throws(() => normalizeFamilyProfile({ name: "Synthetic", relation: "Child", ...input }, "2026-10-11"), error => error.status === 400);
});
test("family views retain archived identities while new bookings require an active member", () => {
  const active = { _id: "000000000000000000000001", name: "Active" }, archived = { _id: "000000000000000000000002", name: "Historical", archivedAt: new Date("2026-10-11") };
  assert.deepEqual(familyViews({ familyMembers: [active, archived] }), { items: [active], archivedItems: [archived] });
  assert.deepEqual(activeFamilyFilter(active._id), { $elemMatch: { _id: active._id, archivedAt: null } });
});
test("generic profile updates cannot replace family identities or use a doctor account", async t => {
  const update = t.mock.method(User, "findByIdAndUpdate", () => { throw new Error("must not replace historical identity"); });
  for (const [role, body, expected] of [["user", { familyMembers: [] }, 400], ["doctor", { firstName: "Synthetic" }, 403]]) {
    let status; const res = { status: value => { status = value; return res; }, json: () => res };
    await updateUserData({ auth: { role, id: "000000000000000000000001" }, body }, res); assert.equal(status, expected);
  }
  assert.equal(update.mock.callCount(), 0);
});
