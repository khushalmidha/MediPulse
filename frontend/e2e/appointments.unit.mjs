import test from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath, dateInZone, visitTime, feeText, canCheckIn, calendarReminder } from "../src/utils/appointments.js";
const visit = { reservation: { _id: "fixture-reservation", state: "confirmed", startsAt: "2026-10-10T09:00:00Z", endsAt: "2026-10-10T09:15:00Z" },
  session: { visitMode: "online", appointmentType: "scheduled_online", policy: { checkInLeadMinutes: 15, checkInGraceMinutes: 30 } }, appointment: { status: "queued", admissionState: "reserved" } };
test("login returns only to safe internal paths", () => {
  assert.equal(safeReturnPath("/appointment/book/id?type=online_opd"), "/appointment/book/id?type=online_opd");
  for (const value of [null, "https://example.invalid", "//example.invalid", "/\\example.invalid", "/login?returnTo=/login", "/signup", "/bad\npath"]) assert.equal(safeReturnPath(value), "/dashboard");
});
test("practice dates respect timezone boundaries", () => {
  const instant = new Date("2026-10-09T20:00:00Z");
  assert.equal(dateInZone(instant, "Asia/Kolkata"), "2026-10-10"); assert.equal(dateInZone(instant, "America/New_York"), "2026-10-09");
});
test("missing fees and times are unavailable rather than invented", () => {
  assert.equal(feeText(null), "Fee unavailable"); assert.match(feeText({ amountMinor: 50000, currency: "INR" }), /500/);
  assert.equal(visitTime(null), "Not recorded"); assert.equal(visitTime("invalid"), "Not recorded");
});
test("online admission uses the actual configured arrival window", () => {
  assert.equal(canCheckIn(visit, Date.parse("2026-10-10T08:44:00Z")), false); assert.equal(canCheckIn(visit, Date.parse("2026-10-10T08:45:00Z")), true);
  assert.equal(canCheckIn(visit, Date.parse("2026-10-10T09:31:00Z")), false);
});
test("hospital, absent and terminal visits cannot join online", () => {
  const now = Date.parse(visit.reservation.startsAt);
  assert.equal(canCheckIn({ ...visit, session: { ...visit.session, visitMode: "in_person" } }, now), false);
  assert.equal(canCheckIn({ ...visit, doctorUnavailable: true }, now), false);
  assert.equal(canCheckIn({ ...visit, reservation: { ...visit.reservation, state: "cancelled" } }, now), false);
});
test("online OPD admission ends at its real window plus grace", () => {
  const opd = { ...visit, reservation: { ...visit.reservation, endsAt: "2026-10-10T10:00:00Z" }, session: { ...visit.session, appointmentType: "online_opd" } };
  assert.equal(canCheckIn(opd, Date.parse("2026-10-10T10:30:00Z")), true); assert.equal(canCheckIn(opd, Date.parse("2026-10-10T10:31:00Z")), false);
});
test("calendar reminders contain actual UTC instants and no medical/patient input", () => {
  const content = calendarReminder({ ...visit, patient: { name: "Private Name", complaint: "Private Complaint" } }, new Date("2026-10-09T00:00:00Z"));
  assert.match(content, /DTSTART:20261010T090000Z/); assert.match(content, /DTEND:20261010T091500Z/); assert.match(content, /TRIGGER:-PT15M/); assert.doesNotMatch(content, /Private Name|Private Complaint/);
  assert.ok(content.endsWith("\r\n"));
});
test("unconfirmed reservations do not produce confirmed calendar events", () => {
  assert.throws(() => calendarReminder({ ...visit, reservation: { ...visit.reservation, state: "held" } }));
});
