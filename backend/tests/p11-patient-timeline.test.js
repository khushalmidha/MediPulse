import test from "node:test";
import assert from "node:assert/strict";
import OpdToken from "../model/opdToken.js";
import Appointment from "../model/appointment.js";
import { getHealthTimeline } from "../controller/patientPortal.js";

const query = rows => { const chain = { sort: () => chain, populate: () => chain, lean: async () => rows }; return chain; };
test("patient timeline counts a linked in-person encounter once and retains owned family identity", async t => {
  const searches = [], family = "000000000000000000000008";
  t.mock.method(OpdToken, "find", filter => { searches.push(filter); return query([{ _id: "token", appointmentId: "linked", familyMemberId: family, status: "completed", date: "2026-10-10T09:00:00Z", hospitalId: { name: "Synthetic Hospital" } }]); });
  t.mock.method(Appointment, "find", filter => { searches.push(filter); return query([{ _id: "linked", visitMode: "in_person", status: "completed", doctorNotes: "Synthetic linked notes", receiptText: "Synthetic linked draft", patientBrief: { agentSummary: "Synthetic linked summary" } }, { _id: "online", status: "completed", visitMode: "online", doctor: { firstName: "Synthetic", lastName: "Doctor" }, endedAt: "2026-10-10T10:00:00Z" }, { _id: "unlinked-hospital", status: "completed", visitMode: "in_person", familyMemberId: family }]); });
  let body; const res = { status: value => { assert.equal(value, 200); return res; }, json: value => { body = value; } };
  await getHealthTimeline({ auth: { role: "user", id: "owner" } }, res);
  assert.equal(body.items.length, 3); assert.ok(!body.items.some(row => row.id === "linked"));
  assert.equal(body.items.find(row => row.id === "token").familyMemberId, family);
  assert.equal(body.items.find(row => row.id === "token").visitMode, "in_person");
  assert.equal(body.items.find(row => row.id === "token").doctorNotes, "Synthetic linked notes");
  assert.equal(body.items.find(row => row.id === "token").receiptText, "Synthetic linked draft");
  assert.equal(body.items.find(row => row.id === "token").patientBrief.agentSummary, "Synthetic linked summary");
  assert.equal(body.items.find(row => row.id === "unlinked-hospital").title, "Hospital appointment");
  assert.equal(body.items.find(row => row.id === "online").visitMode, "online");
  assert.deepEqual(searches, [{ patientId: "owner", status: "completed" }, { user: "owner", status: "completed" }]);
});
test("nonpatient timeline access is denied before querying clinical records", async t => {
  const find = t.mock.method(OpdToken, "find", () => { throw new Error("must not query"); });
  let status; const res = { status: value => { status = value; return res; }, json: () => {} };
  await getHealthTimeline({ auth: { role: "doctor", id: "other" } }, res);
  assert.equal(status, 403); assert.equal(find.mock.callCount(), 0);
});
test("a hospital record preserves saved clinician notes without a linked appointment", async t => {
  t.mock.method(OpdToken, "find", () => query([{ _id: "token", status: "completed", consultationNotes: "Synthetic recorded clinician notes" }]));
  t.mock.method(Appointment, "find", () => query([]));
  let body; const res = { status: () => res, json: value => { body = value; } };
  await getHealthTimeline({ auth: { role: "user", id: "owner" } }, res);
  assert.equal(body.items[0].doctorNotes, "Synthetic recorded clinician notes");
});
