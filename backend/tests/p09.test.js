import test from "node:test";
import assert from "node:assert/strict";
import { sessionPlan, instant, schedulePolicy, admissionWindow, withinChangePolicy } from "../services/schedulingPolicy.js";
import { autoRefundDeadline } from "../services/consultationPolicy.js";
import { schedulingModels } from "../model/scheduling.js";
const now = new Date("2026-10-09T00:00:00Z");
const input = { startsAt: "2026-10-10T09:00:00+05:30", endsAt: "2026-10-10T10:00:00+05:30", appointmentType: "scheduled_online", timezone: "Asia/Kolkata" };
test("dated sessions produce only real slots outside configured breaks", () => {
  const plan = sessionPlan({ ...input, breaks: [{ startsAt: "2026-10-10T09:15:00+05:30", endsAt: "2026-10-10T09:30:00+05:30" }] }, now);
  assert.equal(plan.slots.length, 3); assert.equal(plan.serviceDate, "2026-10-10"); assert.equal(plan.slots[1].startsAt.toISOString(), "2026-10-10T04:00:00.000Z");
});
test("online OPD is a capacity window rather than fabricated appointment times", () => {
  const plan = sessionPlan({ ...input, appointmentType: "online_opd", capacity: 12 }, now);
  assert.equal(plan.slots.length, 1); assert.equal(plan.slots[0].capacity, 12);
  assert.throws(() => sessionPlan({ ...input, appointmentType: "online_opd", breaks: [{ startsAt: input.startsAt, endsAt: input.endsAt }] }, now), { status: 400 });
});
test("timestamps require offsets and reject impossible calendar or clock values", () => {
  for (const value of ["2026-10-10T09:00:00", "2026-02-30T09:00:00Z", "2026-10-10T24:00:00Z", "bad"]) assert.throws(() => instant(value), { status: 400 });
  assert.equal(instant(input.startsAt).toISOString(), "2026-10-10T03:30:00.000Z");
});
test("sessions cannot cross a local midnight or use an invalid timezone", () => {
  assert.throws(() => sessionPlan({ ...input, startsAt: "2026-10-10T23:30:00+05:30", endsAt: "2026-10-11T00:30:00+05:30" }, now), { status: 400 });
  assert.throws(() => sessionPlan({ ...input, timezone: "invalid-zone" }, now), { status: 400 });
});
test("offset-aware DST boundaries retain real instants", () => {
  const plan = sessionPlan({ ...input, timezone: "America/New_York", startsAt: "2026-11-01T01:00:00-04:00", endsAt: "2026-11-01T02:00:00-05:00", slotMinutes: 30 }, now);
  assert.equal(plan.slots.length, 4); assert.equal(plan.serviceDate, "2026-11-01");
});
test("breaks, capacity, duration and booking horizon are bounded", () => {
  for (const extra of [{ capacity: 0 }, { capacity: 1.5 }, { slotMinutes: 1 }, { endsAt: input.startsAt }, { startsAt: "2028-10-10T09:00:00Z", endsAt: "2028-10-10T10:00:00Z" }]) assert.throws(() => sessionPlan({ ...input, ...extra }, now), { status: 400 });
  assert.throws(() => sessionPlan({ ...input, breaks: [{ startsAt: "2026-10-10T08:00:00+05:30", endsAt: input.startsAt }] }, now), { status: 400 });
});
test("change deadlines and check-in windows are explicit", () => {
  const care = { policy: schedulePolicy({ cancelBeforeMinutes: 60 }), appointmentType: "scheduled_online" }, reservation = { startsAt: new Date("2026-10-10T09:00:00Z"), endsAt: new Date("2026-10-10T09:15:00Z") };
  assert.equal(withinChangePolicy(reservation, care, "cancel", new Date("2026-10-10T08:00:00Z")), false);
  assert.equal(admissionWindow(reservation, care, new Date("2026-10-10T08:45:00Z")), true);
  assert.equal(admissionWindow(reservation, care, new Date("2026-10-10T09:31:00Z")), false);
  assert.throws(() => schedulePolicy({ unknown: 1 }), { status: 400 });
});
test("future reservations do not acquire the immediate queue refund timer", () => {
  const paid = { visitMode: "online", payment: { paidAt: now }, admissionState: "reserved", scheduledStart: new Date("2026-10-10T09:00:00Z") };
  assert.equal(autoRefundDeadline(paid, now), null);
  assert.equal(autoRefundDeadline({ ...paid, admissionState: "arrived" }, now).toISOString(), "2026-10-10T09:30:00.000Z");
});
test("scheduling identity and capacity indexes are explicit and additive", () => {
  const indexes = schedulingModels.flatMap(Model => Model.schema.indexes());
  for (const name of ["p09_session_queue", "p09_session_slots", "p09_request_identity", "p09_reservation_appointment"]) assert.equal(indexes.find(([, options]) => options.name === name)[1].unique, true);
  assert.ok(indexes.some(([, options]) => options.name === "p09_expiring_holds"));
});
