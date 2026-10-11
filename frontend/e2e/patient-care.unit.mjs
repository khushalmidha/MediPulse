import test from "node:test";
import assert from "node:assert/strict";
import { familyPayload, hospitalPath, hospitalLocation, careSystem, personName, filterRecords, overallRating, ratingFields } from "../src/utils/patientCare.js";
test("family payload requires identity, validates actual calendar dates and omits unknown optional details", () => {
  assert.deepEqual(familyPayload({ name: "  Synthetic  ", relation: " Child ", dob: "", gender: "", bloodGroup: "" }, "2026-10-10"), { name: "Synthetic", relation: "Child" });
  for (const dob of ["2026-02-31", "2026-10-11", "invalid"]) assert.throws(() => familyPayload({ name: "Synthetic", relation: "Child", dob }, "2026-10-10"));
  assert.throws(() => familyPayload({ name: " ", relation: "Child" }, "2026-10-10"));
  assert.throws(() => familyPayload({ name: "Synthetic", relation: "Child", gender: "unsupported" }, "2026-10-10"));
});
test("hospital cards retain actual metadata and do not invent a care system or destination", () => {
  assert.equal(hospitalPath({ slug: "synthetic-clinic" }), "/hospitals/synthetic-clinic");
  for (const slug of ["", "../login", "other/path", "https://external.invalid"]) assert.equal(hospitalPath({ slug }), null);
  assert.equal(hospitalLocation({ address: { city: "Synthetic" } }), "Synthetic");
  assert.equal(careSystem(undefined), "Care system not listed");
});
test("record filters distinguish self/family without exposing another person or inventing a missing name", () => {
  const rows = [{ id: "self", type: "appointment", title: "Synthetic online visit" }, { id: "family", type: "opd_token", title: "Synthetic hospital", familyMemberId: "child" }];
  assert.deepEqual(filterRecords(rows, { person: "self" }).map(row => row.id), ["self"]);
  assert.deepEqual(filterRecords(rows, { person: "child", search: "HOSPITAL" }).map(row => row.id), ["family"]);
  assert.equal(personName(rows[1], []), "Family member (name not available)");
});
test("ratings have no automatic five-star selection and average only five explicit choices", () => {
  const ratings = Object.fromEntries(ratingFields.map(([key]) => [key, 0])); assert.equal(overallRating(ratings), null);
  for (const [key] of ratingFields) ratings[key] = 3;
  assert.equal(overallRating(ratings), 3); ratings.waitTime = 6; assert.equal(overallRating(ratings), null);
});
